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

const PRINCIPAL = `account:v1:${'a'.repeat(43)}`;
const CLAIM_ID = 'claim-v1-9d05c49f61f58ffa69b8c098851879494c21aea1988e336055c1f646e9ad5543';
const ROOM_ID = `doc-v1-${'a'.repeat(64)}`;
const SNAPSHOT_SHA = 's'.repeat(43);
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const INITIAL_UPDATE =
  'AQTvjKbdDgAHAQdjb250ZW50AwlwYXJhZ3JhcGgHAO+Mpt0OAAYEAO+Mpt0OAQ1Qcm9tb3RlZCBib2R5KAEZbGFzaDpkb2N1bWVudC1tZXRhZGF0YTp2MQV0aXRsZQF3DlByb21vdGVkIHRpdGxlAA==';

type TicketRow = {
  token_hash: string;
  room_id: string;
  owner_principal_id: string;
  actor_id: string;
  protocol_version: number;
  acl_version: number;
  capabilities_json: string;
  promotion_snapshot_sha256: string;
  cutoff_generation: number;
  issued_at: string;
  expires_at: string;
  consumed_at: string | null;
};

const command = {
  version: 1,
  requestId: REQUEST_ID,
  bodySha256: 'b'.repeat(43),
  ownerSession: {
    version: 1,
    claimId: CLAIM_ID,
    ownerPrincipalId: PRINCIPAL,
    localDocumentId: 'doc-alpha',
    actorId: 'owner-one',
    protocolVersion: 3,
    roomId: ROOM_ID,
    promotionSnapshotSha256: SNAPSHOT_SHA,
  },
};

const makeRoom = async (options: { shareable?: boolean; frozen?: boolean } = {}) => {
  vi.stubGlobal(
    'WebSocketRequestResponsePair',
    class {
      constructor(
        readonly request: string,
        readonly response: string,
      ) {}
    },
  );
  let ticket: TicketRow | null = null;
  let authorityAclVersion = 1;
  const statements: string[] = [];
  const sql = vi.fn((statement: string, ...bindings: unknown[]) => {
    const normalized = String(statement).replace(/\s+/gu, ' ').trim();
    statements.push(normalized);
    if (normalized.includes('FROM document_owner_v1 AS owner')) {
      return {
        toArray: () => [
          {
            room_id: ROOM_ID,
            owner_principal_id: PRINCIPAL,
            acl_version: authorityAclVersion,
            projection_snapshot_sha256: SNAPSHOT_SHA,
            receipt_snapshot_sha256: SNAPSHOT_SHA,
            title: 'Promoted title',
            body_canonical_json:
              '{"content":[{"content":[{"text":"Promoted body","type":"text"}],"type":"paragraph"}],"type":"doc"}',
            initial_update_b64: INITIAL_UPDATE,
            shareable: options.shareable === false ? 0 : 1,
          },
        ],
      };
    }
    if (normalized.includes('FROM owner_session_control_v1')) {
      return {
        toArray: () =>
          options.frozen ? [{ frozen: 1, block_new_sessions: 0, cutoff_generation: 0 }] : [],
      };
    }
    if (normalized.startsWith('SELECT COUNT(*) AS count FROM management_request_replay_v1')) {
      return { toArray: () => [{ count: 0 }] };
    }
    if (normalized.startsWith('INSERT INTO owner_socket_ticket_v1')) {
      ticket = {
        token_hash: String(bindings[0]),
        room_id: String(bindings[1]),
        owner_principal_id: String(bindings[2]),
        actor_id: String(bindings[3]),
        protocol_version: Number(bindings[4]),
        acl_version: Number(bindings[5]),
        capabilities_json: String(bindings[6]),
        promotion_snapshot_sha256: String(bindings[7]),
        cutoff_generation: Number(bindings[8]),
        issued_at: String(bindings[9]),
        expires_at: String(bindings[10]),
        consumed_at: null,
      };
      return { toArray: () => [] };
    }
    if (normalized.includes('FROM owner_socket_ticket_v1')) {
      return { toArray: () => (ticket ? [ticket] : []) };
    }
    if (normalized.startsWith('UPDATE owner_socket_ticket_v1 SET consumed_at')) {
      if (!ticket || ticket.consumed_at !== null || ticket.token_hash !== bindings[1]) {
        return { toArray: () => [] };
      }
      ticket.consumed_at = String(bindings[0]);
      return { toArray: () => [{ token_hash: ticket.token_hash }] };
    }
    if (
      normalized.includes('SELECT initial_update_b64 FROM document_projection_v1') &&
      options.shareable !== false
    ) {
      return { toArray: () => [{ initial_update_b64: INITIAL_UPDATE }] };
    }
    return { toArray: () => [] };
  });
  const blockConcurrencyWhile = vi.fn(<T>(callback: () => Promise<T> | T) =>
    Promise.resolve(callback()),
  );
  const { LashRealtimeRoom } = await import('../../../realtime-worker/src/room');
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
  return {
    room,
    statements,
    getTicket: () => ticket,
    setAuthorityAclVersion: (nextAclVersion: number) => {
      authorityAclVersion = nextAclVersion;
    },
  };
};

describe('owner-session room Durable Object', () => {
  it('installs ticket/control schema and atomically issues from exact readable authority', async () => {
    try {
      const { room, statements, getTicket } = await makeRoom();
      expect(statements).toContainEqual(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS owner_session_control_v1'),
      );
      expect(statements).toContainEqual(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS owner_socket_ticket_v1'),
      );

      const response = await room.fetch(
        new Request('https://room.internal/__lash-room/owner-session', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-lash-internal-management': 'owner-session-v1',
          },
          body: JSON.stringify(command),
        }),
      );
      expect(response.status).toBe(200);
      const result = (await response.json()) as Record<string, unknown>;
      expect(result).toMatchObject({
        ok: true,
        version: 1,
        roomId: ROOM_ID,
        ownerPrincipalId: PRINCIPAL,
        grant: {
          source: 'owner',
          capabilities: ['doc.read', 'doc.edit'],
          aclVersion: 1,
          protocolVersion: 3,
        },
      });
      expect(JSON.stringify(getTicket())).not.toContain('lash-ticket.');
      expect(statements).toContainEqual(expect.stringContaining("VALUES ('owner.session-issued'"));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('consumes a ticket once on protocol-v3 upgrade and echoes only lash-realtime-v3', async () => {
    const NativeResponse = Response;
    try {
      const { room } = await makeRoom();
      const issued = await room.fetch(
        new Request('https://room.internal/__lash-room/owner-session', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-lash-internal-management': 'owner-session-v1',
          },
          body: JSON.stringify(command),
        }),
      );
      const success = (await issued.json()) as {
        socket: { ticket: string };
      };
      const sent: string[] = [];
      const server = {
        readyState: 1,
        send: vi.fn((value: string) => sent.push(value)),
        serializeAttachment: vi.fn(),
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
      const ticketHeader = `lash-realtime-v3, ${success.socket.ticket}`;
      const socketUrl =
        `https://room.internal/__lash-room/socket?protocolVersion=3` +
        `&actorId=owner-one&roomId=${ROOM_ID}`;
      const first = await room.fetch(
        new Request(socketUrl, {
          headers: {
            upgrade: 'websocket',
            'sec-websocket-protocol': ticketHeader,
          },
        }),
      );
      expect(first.status).toBe(101);
      expect(first.headers.get('sec-websocket-protocol')).toBe('lash-realtime-v3');
      expect(first.headers.get('sec-websocket-protocol')).not.toContain('lash-ticket.');
      expect(JSON.stringify(first)).not.toContain(success.socket.ticket);
      expect(sent.map((frame) => JSON.parse(frame))).toEqual([
        expect.objectContaining({
          type: 'room-ready',
          roomId: ROOM_ID,
          protocolVersion: 3,
        }),
        expect.objectContaining({
          type: 'yjs-update',
          roomId: ROOM_ID,
          source: 'hydrate',
          update: INITIAL_UPDATE,
        }),
        expect.objectContaining({
          type: 'room-hydration-complete',
          roomId: ROOM_ID,
          protocolVersion: 3,
        }),
      ]);

      const second = await room.fetch(
        new Request(socketUrl, {
          headers: {
            upgrade: 'websocket',
            'sec-websocket-protocol': ticketHeader,
          },
        }),
      );
      expect(second.status).toBe(403);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not upgrade an unconsumed ticket after the room authority ACL advances', async () => {
    const NativeResponse = Response;
    try {
      const { room, getTicket, setAuthorityAclVersion } = await makeRoom();
      const issued = await room.fetch(
        new Request('https://room.internal/__lash-room/owner-session', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-lash-internal-management': 'owner-session-v1',
          },
          body: JSON.stringify(command),
        }),
      );
      const success = (await issued.json()) as {
        socket: { ticket: string };
      };
      setAuthorityAclVersion(2);

      const pairConstructed = vi.fn();
      const server = {
        readyState: 1,
        send: vi.fn(),
        serializeAttachment: vi.fn(),
      };
      vi.stubGlobal(
        'WebSocketPair',
        class {
          0 = { readyState: 1 };
          1 = server;

          constructor() {
            pairConstructed();
          }
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

      const response = await room.fetch(
        new Request(
          `https://room.internal/__lash-room/socket?protocolVersion=3` +
            `&actorId=owner-one&roomId=${ROOM_ID}`,
          {
            headers: {
              upgrade: 'websocket',
              'sec-websocket-protocol': `lash-realtime-v3, ${success.socket.ticket}`,
            },
          },
        ),
      );

      expect(response.status).toBe(403);
      expect(pairConstructed).not.toHaveBeenCalled();
      expect(getTicket()?.consumed_at).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ['unshareable', { shareable: false }],
    ['frozen', { frozen: true }],
  ])('does not issue when authority is %s', async (_label, options) => {
    try {
      const { room, getTicket } = await makeRoom(options);
      const response = await room.fetch(
        new Request('https://room.internal/__lash-room/owner-session', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-lash-internal-management': 'owner-session-v1',
          },
          body: JSON.stringify(command),
        }),
      );
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: 'not-shareable',
        retryable: false,
      });
      expect(getTicket()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
