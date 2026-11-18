import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

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
const INITIAL_UPDATE =
  'AQTvjKbdDgAHAQdjb250ZW50AwlwYXJhZ3JhcGgHAO+Mpt0OAAYEAO+Mpt0OAQ1Qcm9tb3RlZCBib2R5KAEZbGFzaDpkb2N1bWVudC1tZXRhZGF0YTp2MQV0aXRsZQF3DlByb21vdGVkIHRpdGxlAA==';

const appendPrivateThread = () => {
  const doc = new Y.Doc();
  doc.getMap('lash:chat-threads').set('thread-1', 'Private collaborator note');
  const update = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
  doc.destroy();
  return update;
};

const attachment = {
  protocolVersion: 4,
  hydrated: true,
  actorId: 'public-reader',
  roomId: ROOM_ID,
  capabilities: ['doc.read'],
  mode: 'read',
  policyVersion: 2,
  cutoffGeneration: 1,
  browserOrigin: 'https://lash.example',
  connectedAt: Date.parse('2026-07-30T00:00:00.000Z'),
};

const socket = (value: unknown = attachment) => ({
  readyState: 1,
  deserializeAttachment: vi.fn(() => structuredClone(value)),
  serializeAttachment: vi.fn(),
  send: vi.fn(),
  close: vi.fn(),
});

const makeRoom = async (
  options: {
    sockets?: ReturnType<typeof socket>[];
    policy?: { mode: string; policyVersion: number; cutoffGeneration: number };
    legacyThread?: boolean;
  } = {},
) => {
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
  const sql = vi.fn((statement: string) => {
    const normalized = statement.replace(/\s+/gu, ' ').trim();
    statements.push(normalized);
    if (normalized.startsWith('SELECT mode, policy_version, cutoff_generation')) {
      return {
        toArray: () => [
          {
            mode: options.policy?.mode ?? 'read',
            policy_version: options.policy?.policyVersion ?? 2,
            cutoff_generation: options.policy?.cutoffGeneration ?? 1,
          },
        ],
      };
    }
    if (normalized.startsWith('INSERT INTO yjs_updates')) {
      return { toArray: () => [{ sequence: 1 }] };
    }
    if (normalized.startsWith('SELECT initial_update_b64 FROM document_projection_v1')) {
      return { toArray: () => [{ initial_update_b64: INITIAL_UPDATE }] };
    }
    if (normalized.includes('FROM yjs_updates') && normalized.includes('WHERE sequence > ?')) {
      return {
        toArray: () =>
          options.legacyThread
            ? [
                {
                  sequence: 1,
                  actor_id: 'owner',
                  source: 'client',
                  update_b64: appendPrivateThread(),
                  created_at: '2026-11-18T00:00:00.000Z',
                },
              ]
            : [],
      };
    }
    if (
      normalized.startsWith(
        'SELECT sequence, update_b64, created_at FROM yjs_snapshots ORDER BY sequence DESC',
      ) ||
      (normalized.includes('FROM yjs_updates') && normalized.includes('WHERE sequence > ?'))
    ) {
      return { toArray: () => [] };
    }
    return { toArray: () => [] };
  });
  const sockets = options.sockets ?? [];
  const blockConcurrencyWhile = vi.fn(<T>(callback: () => Promise<T> | T) =>
    Promise.resolve(callback()),
  );
  const { LashRealtimeRoom } = await import('../../../realtime-worker/src/room');
  const room = new LashRealtimeRoom(
    {
      blockConcurrencyWhile,
      getWebSockets: vi.fn(() => sockets),
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
  return { room, statements, sockets };
};

describe('public protocol-v4 socket boundary', () => {
  it('keeps the legacy fixture protocol out of canonical account room attachments', async () => {
    const { isCurrentSocketAttachment } = await import('../../../realtime-worker/src/room');
    const legacyAttachment = {
      protocolVersion: 2,
      hydrated: true,
      actorId: 'local-actor',
      capabilities: ['doc.read', 'doc.edit'],
      connectedAt: 1,
    };
    expect(isCurrentSocketAttachment({ ...legacyAttachment, roomId: 'local-document' })).toBe(true);
    expect(isCurrentSocketAttachment({ ...legacyAttachment, roomId: ROOM_ID })).toBe(false);
  });

  it('builds exact policy/high-water hydration fences around ordered Yjs inventory', async () => {
    const { buildPublicRoomHydrationFrames } = await import('../../../realtime-worker/src/room');
    expect(
      buildPublicRoomHydrationFrames({
        roomId: ROOM_ID,
        mode: 'comment',
        policyVersion: 7,
        cutoffGeneration: 3,
        highWaterSequence: 11,
        updates: [INITIAL_UPDATE, 'tail-update'],
      }),
    ).toEqual([
      {
        type: 'room-ready',
        roomId: ROOM_ID,
        protocolVersion: 4,
        mode: 'comment',
        policyVersion: 7,
        cutoffGeneration: 3,
        highWaterSequence: 11,
      },
      {
        type: 'yjs-update',
        roomId: ROOM_ID,
        update: INITIAL_UPDATE,
      },
      {
        type: 'yjs-update',
        roomId: ROOM_ID,
        update: 'tail-update',
      },
      {
        type: 'room-hydration-complete',
        roomId: ROOM_ID,
        protocolVersion: 4,
        mode: 'comment',
        policyVersion: 7,
        cutoffGeneration: 3,
        highWaterSequence: 11,
        persistedUpdates: 2,
      },
    ]);
  });

  it('accepts one bounded ping but closes every public write/capability/unknown frame without SQL mutation', async () => {
    const { room, statements } = await makeRoom();
    const writeStart = statements.length;
    const ping = socket();
    await room.webSocketMessage(
      ping as never,
      JSON.stringify({ type: 'ping', requestId: 'ping-1' }),
    );
    expect(ping.close).not.toHaveBeenCalled();
    expect(ping.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'pong',
        requestId: 'ping-1',
        roomId: ROOM_ID,
        protocolVersion: 4,
      }),
    );

    for (const message of [
      { type: 'yjs-update', update: INITIAL_UPDATE },
      { type: 'awareness-update', awareness: {} },
      { type: 'broadcast', payload: 'x' },
      { type: 'restore', update: INITIAL_UPDATE },
      { type: 'comment', text: 'x' },
      { type: 'suggest', text: 'x' },
      { type: 'capability', capabilities: ['doc.edit'] },
      { type: 'unknown' },
    ]) {
      const peer = socket();
      await room.webSocketMessage(peer as never, JSON.stringify(message));
      expect(peer.close).toHaveBeenCalledWith(4403, 'public-read-only');
      expect(peer.send).not.toHaveBeenCalled();
    }
    const writes = statements
      .slice(writeStart)
      .filter((statement) => /^(?:INSERT|UPDATE|DELETE|REPLACE)\b/u.test(statement));
    expect(writes).toEqual([]);
  });

  it('rejects binary, malformed, oversized, and over-specified ping frames read-only', async () => {
    const { room } = await makeRoom();
    for (const message of [
      new Uint8Array([1, 2, 3]).buffer,
      '{',
      JSON.stringify({ type: 'ping', requestId: 'x', extra: true }),
      JSON.stringify({ type: 'ping', requestId: 'x'.repeat(129) }),
      JSON.stringify({ type: 'ping', padding: 'x'.repeat(1024) }),
    ]) {
      const peer = socket();
      await room.webSocketMessage(peer as never, message);
      expect(peer.close).toHaveBeenCalledWith(4403, 'public-read-only');
    }
  });

  it('delivers owner updates to current public readers with the exact minimal v4 frame', async () => {
    const reader = socket();
    const owner = socket({
      protocolVersion: 3,
      hydrated: true,
      actorId: 'owner',
      roomId: ROOM_ID,
      capabilities: ['doc.read', 'doc.edit'],
      connectedAt: 1,
    });
    const { room } = await makeRoom({ sockets: [reader, owner] });
    const document = new Y.Doc();
    Y.applyUpdate(document, Buffer.from(INITIAL_UPDATE, 'base64'));
    const before = Y.encodeStateVector(document);
    document.getMap('lash:document-metadata:v1').set('title', 'New public title');
    const update = Buffer.from(Y.encodeStateAsUpdate(document, before)).toString('base64');

    await room.webSocketMessage(owner as never, JSON.stringify({ type: 'yjs-update', update }));

    const [frame] = reader.send.mock.calls[0] ?? [];
    const publicFrame = JSON.parse(frame);
    expect(Object.keys(publicFrame).sort()).toEqual(['roomId', 'type', 'update']);
    expect(publicFrame).toMatchObject({ type: 'yjs-update', roomId: ROOM_ID });
    const viewer = new Y.Doc();
    Y.applyUpdate(viewer, Buffer.from(INITIAL_UPDATE, 'base64'));
    Y.applyUpdate(viewer, Buffer.from(publicFrame.update, 'base64'));
    expect(viewer.getMap('lash:document-metadata:v1').get('title')).toBe('New public title');
    document.destroy();
    viewer.destroy();
  });

  it('withholds legacy private review state from public sockets on resume and live delivery', async () => {
    const owner = socket({
      protocolVersion: 3,
      hydrated: true,
      actorId: 'owner',
      roomId: ROOM_ID,
      capabilities: ['doc.read', 'doc.edit'],
      connectedAt: 1,
    });
    const historicalReader = socket();
    await makeRoom({ sockets: [historicalReader, owner], legacyThread: true });
    expect(historicalReader.close).toHaveBeenCalledWith(4403, 'public-policy-changed');
    expect(historicalReader.send).not.toHaveBeenCalled();

    const liveReader = socket();
    const { room } = await makeRoom({ sockets: [liveReader, owner] });
    expect(liveReader.close).not.toHaveBeenCalled();
    await room.webSocketMessage(
      owner as never,
      JSON.stringify({ type: 'yjs-update', update: appendPrivateThread() }),
    );
    expect(liveReader.close).toHaveBeenCalledWith(4403, 'public-policy-changed');
    expect(liveReader.send).not.toHaveBeenCalled();
  });

  it.each(['mention', 'chip'])(
    'excludes live public recipients before forwarding a private %s',
    async (kind) => {
      const owner = socket({
        protocolVersion: 3,
        hydrated: true,
        actorId: 'owner',
        roomId: ROOM_ID,
        capabilities: ['doc.read', 'doc.edit'],
        connectedAt: 1,
      });
      const reader = socket();
      const { room } = await makeRoom({ sockets: [reader, owner] });
      const document = new Y.Doc();
      Y.applyUpdate(document, Buffer.from(INITIAL_UPDATE, 'base64'));
      const before = Y.encodeStateVector(document);
      const paragraph = document.getXmlFragment('content').get(0) as Y.XmlElement;
      const reference = new Y.XmlElement(kind);
      reference.setAttribute('kind', kind === 'mention' ? 'user' : 'doc');
      reference.setAttribute('refId', 'private-reference');
      paragraph.push([reference]);
      const update = Buffer.from(Y.encodeStateAsUpdate(document, before)).toString('base64');
      document.destroy();

      expect(reader.close).not.toHaveBeenCalled();
      await room.webSocketMessage(owner as never, JSON.stringify({ type: 'yjs-update', update }));
      expect(reader.close).toHaveBeenCalledWith(4403, 'public-policy-changed');
      expect(reader.send).not.toHaveBeenCalled();
    },
  );

  it('closes and excludes a stale hydrated public attachment after restart before delivery', async () => {
    const staleReader = socket();
    const owner = socket({
      protocolVersion: 3,
      hydrated: true,
      actorId: 'owner',
      roomId: ROOM_ID,
      capabilities: ['doc.read', 'doc.edit'],
      connectedAt: 1,
    });
    const { room } = await makeRoom({
      sockets: [staleReader, owner],
      policy: { mode: 'comment', policyVersion: 3, cutoffGeneration: 2 },
    });

    await room.webSocketMessage(
      owner as never,
      JSON.stringify({ type: 'yjs-update', update: INITIAL_UPDATE }),
    );

    expect(staleReader.close).toHaveBeenCalledWith(4403, 'public-policy-changed');
    expect(staleReader.send).not.toHaveBeenCalled();
  });
});
