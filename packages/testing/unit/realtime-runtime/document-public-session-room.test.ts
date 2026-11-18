import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    protected readonly ctx: unknown;
    protected readonly env: unknown;

    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const ROOM_ID = `doc-v1-${'a'.repeat(64)}`;
const SNAPSHOT_SHA = 's'.repeat(43);
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const BROWSER_ORIGIN = 'https://lash.example';
const INITIAL_UPDATE =
  'AQTvjKbdDgAHAQdjb250ZW50AwlwYXJhZ3JhcGgHAO+Mpt0OAAYEAO+Mpt0OAQ1Qcm9tb3RlZCBib2R5KAEZbGFzaDpkb2N1bWVudC1tZXRhZGF0YTp2MQV0aXRsZQF3DlByb21vdGVkIHRpdGxlAA==';

type PublicTicketRow = {
  token_hash: string;
  request_id: string;
  room_id: string;
  actor_id: string;
  browser_origin: string;
  protocol_version: number;
  mode: string;
  policy_version: number;
  cutoff_generation: number;
  capabilities_json: string;
  issued_at: string;
  expires_at: string;
  consumed_at: string | null;
  invalidated_at: string | null;
};

const command = {
  version: 1,
  requestId: REQUEST_ID,
  bodySha256: 'b'.repeat(43),
  publicSession: {
    version: 1,
    roomId: ROOM_ID,
    actorId: 'public-reader',
    protocolVersion: 4,
    browserOrigin: BROWSER_ORIGIN,
    rateKey: `rate-v1-${'r'.repeat(43)}`,
  },
};

const makeHarness = async () => {
  vi.stubGlobal(
    'WebSocketRequestResponsePair',
    class {
      constructor(
        readonly request: string,
        readonly response: string,
      ) {}
    },
  );
  const statements: string[] = [];
  const requests = new Set<string>();
  const rateCounters = new Map<string, number>();
  let ticket: PublicTicketRow | null = null;

  const sql = vi.fn((statement: string, ...bindings: unknown[]) => {
    const normalized = String(statement).replace(/\s+/gu, ' ').trim();
    statements.push(normalized);
    if (
      normalized.includes('FROM document_projection_v1 AS projection') &&
      normalized.includes('JOIN document_promotion_receipt_v1 AS receipt') &&
      normalized.includes('JOIN document_public_policy_v2 AS policy')
    ) {
      return {
        toArray: () => [
          {
            room_id: ROOM_ID,
            shareable: 1,
            projection_snapshot_sha256: SNAPSHOT_SHA,
            receipt_snapshot_sha256: SNAPSHOT_SHA,
            initial_update_b64: INITIAL_UPDATE,
            mode: 'read',
            policy_version: 1,
            cutoff_generation: 0,
          },
        ],
      };
    }
    if (normalized.startsWith('SELECT COUNT(*) AS count FROM public_control_request_v1')) {
      return { toArray: () => [{ count: requests.has(String(bindings[0])) ? 1 : 0 }] };
    }
    if (normalized.startsWith('INSERT INTO public_control_request_v1')) {
      requests.add(String(bindings[0]));
      return { toArray: () => [] };
    }
    if (normalized.startsWith('INSERT INTO public_session_rate_counter_v1')) {
      const key = `${String(bindings[0])}:${String(bindings[1])}:${String(bindings[2])}`;
      const count = (rateCounters.get(key) ?? 0) + 1;
      rateCounters.set(key, count);
      return { toArray: () => [{ count }] };
    }
    if (normalized.startsWith('INSERT INTO public_socket_ticket_v1')) {
      ticket = {
        token_hash: String(bindings[0]),
        request_id: String(bindings[1]),
        room_id: String(bindings[2]),
        actor_id: String(bindings[3]),
        browser_origin: String(bindings[4]),
        protocol_version: 4,
        mode: String(bindings[5]),
        policy_version: Number(bindings[6]),
        cutoff_generation: Number(bindings[7]),
        capabilities_json: '["doc.read"]',
        issued_at: String(bindings[8]),
        expires_at: String(bindings[9]),
        consumed_at: null,
        invalidated_at: null,
      };
      return { toArray: () => [] };
    }
    if (normalized.includes('FROM public_socket_ticket_v1')) {
      return {
        toArray: () => (ticket && ticket.token_hash === String(bindings[0]) ? [ticket] : []),
      };
    }
    if (normalized.startsWith('UPDATE public_socket_ticket_v1 SET consumed_at')) {
      if (
        !ticket ||
        ticket.token_hash !== String(bindings[1]) ||
        ticket.consumed_at !== null ||
        ticket.invalidated_at !== null
      ) {
        return { toArray: () => [] };
      }
      ticket.consumed_at = String(bindings[0]);
      return { toArray: () => [{ token_hash: ticket.token_hash }] };
    }
    if (normalized === 'SELECT MAX(sequence) AS sequence FROM yjs_updates') {
      return { toArray: () => [{ sequence: null }] };
    }
    if (normalized.includes('FROM yjs_snapshots') && normalized.includes('sequence <= ?')) {
      return { toArray: () => [] };
    }
    if (
      normalized.includes('FROM yjs_updates') &&
      normalized.includes('sequence > ? AND sequence <= ?')
    ) {
      return { toArray: () => [] };
    }
    if (
      normalized.includes('SELECT initial_update_b64 FROM document_projection_v1') &&
      normalized.includes('shareable = 1')
    ) {
      return { toArray: () => [{ initial_update_b64: INITIAL_UPDATE }] };
    }
    return { toArray: () => [] };
  });

  const { LashRealtimeRoom } = await import('../../../realtime-worker/src/room');
  const createRoom = async () => {
    const blockConcurrencyWhile = vi.fn(<T>(callback: () => Promise<T> | T) =>
      Promise.resolve(callback()),
    );
    const room = new LashRealtimeRoom(
      {
        acceptWebSocket: vi.fn(),
        blockConcurrencyWhile,
        getWebSockets: vi.fn(() => []),
        setWebSocketAutoResponse: vi.fn(),
        storage: {
          sql: { exec: sql },
          transactionSync: vi.fn((callback: () => unknown) => callback()),
        },
      } as never,
      {} as never,
    );
    await Promise.all(
      blockConcurrencyWhile.mock.results
        .map((result) => result.value)
        .filter((value): value is Promise<unknown> => value instanceof Promise),
    );
    return room;
  };

  return {
    createRoom,
    statements,
    getTicket: () => ticket,
  };
};

describe('public-session room Durable Object', () => {
  it('persists a hash-only ticket and consumes it once after a room restart', async () => {
    const NativeResponse = Response;
    try {
      const { createRoom, statements, getTicket } = await makeHarness();
      const issuingRoom = await createRoom();
      expect(statements).toContainEqual(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS public_control_request_v1'),
      );
      expect(statements).toContainEqual(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS public_socket_ticket_v1'),
      );

      const issued = await issuingRoom.fetch(
        new Request('https://room.internal/__lash-room/public-session', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-lash-internal-management': 'public-session-v1',
          },
          body: JSON.stringify(command),
        }),
      );
      expect(issued.status).toBe(200);
      const success = (await issued.json()) as {
        authorization: {
          roomId: string;
          mode: string;
          policyVersion: number;
          cutoffGeneration: number;
        };
        grant: { source: string; capabilities: string[]; protocolVersion: number };
        socket: { ticketProtocol: string };
      };
      expect(success).toMatchObject({
        authorization: {
          roomId: ROOM_ID,
          mode: 'read',
          policyVersion: 1,
          cutoffGeneration: 0,
        },
        grant: {
          source: 'public',
          capabilities: ['doc.read'],
          protocolVersion: 4,
        },
      });
      expect(success.socket.ticketProtocol).toMatch(/^lash-public-ticket\.[A-Za-z0-9_-]{43}$/u);
      expect(JSON.stringify(getTicket())).not.toContain(success.socket.ticketProtocol);

      const sent: string[] = [];
      const attachments: unknown[] = [];
      const server = {
        readyState: 1,
        send: vi.fn((value: string) => sent.push(value)),
        close: vi.fn(),
        serializeAttachment: vi.fn((value: unknown) => attachments.push(value)),
      };
      const client = { readyState: 1 };
      vi.stubGlobal(
        'WebSocketPair',
        class {
          0 = client;
          1 = server;
        },
      );
      class UpgradeResponse {
        static json = NativeResponse.json.bind(NativeResponse);
        readonly body = null;
        readonly headers: Headers;
        readonly status: number;
        readonly webSocket: unknown;

        constructor(_body: BodyInit | null, init: ResponseInit & { webSocket?: unknown } = {}) {
          this.status = init.status ?? 200;
          this.headers = new Headers(init.headers);
          this.webSocket = init.webSocket;
        }
      }
      vi.stubGlobal('Response', UpgradeResponse);

      const restartedRoom = await createRoom();
      const socketUrl =
        `https://room.internal/__lash-room/socket?protocolVersion=4` +
        `&actorId=public-reader&roomId=${ROOM_ID}`;
      const socketHeaders = {
        upgrade: 'websocket',
        origin: BROWSER_ORIGIN,
        'sec-websocket-protocol': `lash-realtime-v4, ${success.socket.ticketProtocol}`,
      };
      const first = await restartedRoom.fetch(new Request(socketUrl, { headers: socketHeaders }));
      expect(first.status).toBe(101);
      expect(first.headers.get('sec-websocket-protocol')).toBe('lash-realtime-v4');
      expect(first.headers.get('sec-websocket-protocol')).not.toContain('lash-public-ticket.');
      expect(sent.map((frame) => JSON.parse(frame))).toEqual([
        {
          type: 'room-ready',
          roomId: ROOM_ID,
          protocolVersion: 4,
          mode: 'read',
          policyVersion: 1,
          cutoffGeneration: 0,
          highWaterSequence: 0,
        },
        {
          type: 'yjs-update',
          roomId: ROOM_ID,
          update: INITIAL_UPDATE,
        },
        {
          type: 'room-hydration-complete',
          roomId: ROOM_ID,
          protocolVersion: 4,
          mode: 'read',
          policyVersion: 1,
          cutoffGeneration: 0,
          highWaterSequence: 0,
          persistedUpdates: 1,
        },
      ]);
      expect(attachments.at(-1)).toMatchObject({
        protocolVersion: 4,
        hydrated: true,
        roomId: ROOM_ID,
        actorId: 'public-reader',
        capabilities: ['doc.read'],
        mode: 'read',
      });

      const second = await restartedRoom.fetch(new Request(socketUrl, { headers: socketHeaders }));
      expect(second.status).toBe(403);
      expect(getTicket()?.consumed_at).not.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
