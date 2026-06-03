import { DurableObject } from 'cloudflare:workers';

import {
  buildHydrationUpdates,
  isRealtimeUpdatePayload,
  mergeRealtimeUpdates,
  shouldCompactRealtimeUpdates,
  type PersistedRealtimeSnapshot,
  type PersistedRealtimeUpdate,
  type RealtimeUpdateSource,
} from './persistence';
import { REALTIME_RUNTIME, normalizeRoomName } from './routing';

const PROTOCOL_VERSION = 1;

type SocketAttachment = {
  actorId: string;
  roomId: string;
  connectedAt: number;
};

type ClientMessage = {
  type?: string;
  requestId?: string;
  payload?: unknown;
  update?: unknown;
};

type UpdateRow = {
  sequence: number;
  actor_id: string;
  source: RealtimeUpdateSource;
  update_b64: string;
  created_at: string;
};

type SnapshotRow = {
  sequence: number;
  update_b64: string;
  created_at: string;
};

const json = (body: unknown, init: ResponseInit = {}) =>
  Response.json(body, {
    ...init,
    headers: {
      'cache-control': 'no-store',
      ...init.headers,
    },
  });

const readAttachment = (ws: WebSocket): SocketAttachment => {
  const value = ws.deserializeAttachment() as unknown;
  if (value && typeof value === 'object') {
    const attachment = value as Partial<SocketAttachment>;
    if (
      typeof attachment.actorId === 'string' &&
      typeof attachment.roomId === 'string' &&
      typeof attachment.connectedAt === 'number'
    ) {
      return {
        actorId: attachment.actorId,
        roomId: attachment.roomId,
        connectedAt: attachment.connectedAt,
      };
    }
  }

  return { actorId: 'unknown-actor', roomId: 'unknown-room', connectedAt: Date.now() };
};

const parseClientMessage = (message: string | ArrayBuffer): ClientMessage | null => {
  if (typeof message !== 'string') {
    return { type: 'binary', payload: message.byteLength };
  }

  try {
    const parsed = JSON.parse(message) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as ClientMessage;
  } catch {
    return null;
  }
};

const isValidYjsUpdate = (update: string) => {
  return isRealtimeUpdatePayload(update);
};

const updateFromRow = (row: UpdateRow): PersistedRealtimeUpdate => ({
  sequence: row.sequence,
  actorId: row.actor_id,
  source: row.source,
  update: row.update_b64,
  createdAt: row.created_at,
});

const snapshotFromRow = (row: SnapshotRow | undefined): PersistedRealtimeSnapshot | null =>
  row
    ? {
        sequence: row.sequence,
        update: row.update_b64,
        createdAt: row.created_at,
      }
    : null;

export class LashRealtimeRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS yjs_updates (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_id TEXT NOT NULL,
          source TEXT NOT NULL CHECK (source IN ('client', 'restore')),
          update_b64 TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS yjs_snapshots (
          sequence INTEGER PRIMARY KEY,
          update_b64 TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(
        'CREATE INDEX IF NOT EXISTS yjs_updates_sequence_idx ON yjs_updates(sequence)',
      );
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const actorId = normalizeRoomName(url.searchParams.get('actorId')) ?? null;
    const roomId = normalizeRoomName(url.searchParams.get('roomId')) ?? 'unknown-room';
    if (!actorId) {
      return json({ ok: false, error: 'forbidden', reason: 'missing-actor' }, { status: 403 });
    }

    if (url.pathname === '/__lash-room/health') {
      const snapshot = this.latestSnapshot();
      return json({
        ok: true,
        actorId,
        roomId,
        runtime: REALTIME_RUNTIME,
        protocolVersion: PROTOCOL_VERSION,
        connections: this.ctx.getWebSockets().length,
        persistence: {
          updates: this.updateCount(),
          snapshotSequence: snapshot?.sequence ?? null,
          hydrationUpdates: buildHydrationUpdates(
            snapshot,
            this.updatesAfter(snapshot?.sequence ?? 0),
          ).length,
        },
      });
    }

    if (url.pathname === '/__lash-room/socket') {
      return this.acceptSocket(request, roomId, actorId);
    }

    if (url.pathname === '/__lash-room/restore') {
      return this.restore(request, roomId, actorId);
    }

    return json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = readAttachment(ws);
    const parsed = parseClientMessage(message);
    if (!parsed) {
      ws.send(
        JSON.stringify({
          type: 'error',
          roomId: attachment.roomId,
          code: 'invalid_json',
        }),
      );
      return;
    }

    if (parsed.type === 'ping') {
      ws.send(
        JSON.stringify({
          type: 'pong',
          requestId: parsed.requestId ?? null,
          actorId: attachment.actorId,
          roomId: attachment.roomId,
          protocolVersion: PROTOCOL_VERSION,
          connections: this.ctx.getWebSockets().length,
        }),
      );
      return;
    }

    if (parsed.type === 'broadcast') {
      const payload = JSON.stringify({
        type: 'broadcast',
        actorId: attachment.actorId,
        requestId: parsed.requestId ?? null,
        roomId: attachment.roomId,
        payload: parsed.payload ?? null,
      });
      for (const peer of this.ctx.getWebSockets()) {
        peer.send(payload);
      }
      return;
    }

    if (parsed.type === 'yjs-update') {
      if (typeof parsed.update !== 'string') {
        ws.send(
          JSON.stringify({
            type: 'error',
            roomId: attachment.roomId,
            code: 'invalid_yjs_update',
          }),
        );
        return;
      }
      if (!isValidYjsUpdate(parsed.update)) {
        ws.send(
          JSON.stringify({
            type: 'error',
            roomId: attachment.roomId,
            code: 'invalid_yjs_update',
          }),
        );
        return;
      }
      const persisted = this.appendUpdate(attachment.actorId, 'client', parsed.update);
      const payload = JSON.stringify({
        type: 'yjs-update',
        actorId: attachment.actorId,
        roomId: attachment.roomId,
        sequence: persisted.sequence,
        source: persisted.source,
        update: parsed.update,
      });
      for (const peer of this.ctx.getWebSockets()) {
        if (peer !== ws) {
          peer.send(payload);
        }
      }
      return;
    }

    ws.send(
      JSON.stringify({
        type: 'error',
        roomId: attachment.roomId,
        code: 'unknown_message_type',
      }),
    );
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    ws.close(code, reason);
  }

  private acceptSocket(request: Request, roomId: string, actorId: string): Response {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return json({ ok: false, error: 'expected_websocket' }, { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      actorId,
      roomId,
      connectedAt: Date.now(),
    } satisfies SocketAttachment);
    const hydrationUpdates = this.hydrationUpdates();
    server.send(
      JSON.stringify({
        type: 'room-ready',
        actorId,
        roomId,
        runtime: REALTIME_RUNTIME,
        protocolVersion: PROTOCOL_VERSION,
        connections: this.ctx.getWebSockets().length,
        persistedUpdates: hydrationUpdates.length,
      }),
    );
    for (const update of hydrationUpdates) {
      server.send(
        JSON.stringify({
          type: 'yjs-update',
          actorId: 'system',
          roomId,
          source: 'hydrate',
          update,
        }),
      );
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private latestSnapshot(): PersistedRealtimeSnapshot | null {
    return snapshotFromRow(
      this.ctx.storage.sql
        .exec<SnapshotRow>(
          'SELECT sequence, update_b64, created_at FROM yjs_snapshots ORDER BY sequence DESC LIMIT 1',
        )
        .toArray()[0],
    );
  }

  private updatesAfter(sequence: number): PersistedRealtimeUpdate[] {
    return this.ctx.storage.sql
      .exec<UpdateRow>(
        `SELECT sequence, actor_id, source, update_b64, created_at
         FROM yjs_updates
         WHERE sequence > ?
         ORDER BY sequence ASC`,
        sequence,
      )
      .toArray()
      .map(updateFromRow);
  }

  private updateCount() {
    const row = this.ctx.storage.sql
      .exec<{ count: number }>('SELECT COUNT(*) AS count FROM yjs_updates')
      .toArray()[0];
    return row.count;
  }

  private hydrationUpdates() {
    const snapshot = this.latestSnapshot();
    return buildHydrationUpdates(snapshot, this.updatesAfter(snapshot?.sequence ?? 0));
  }

  private appendUpdate(
    actorId: string,
    source: RealtimeUpdateSource,
    update: string,
  ): PersistedRealtimeUpdate {
    const createdAt = new Date().toISOString();
    const row = this.ctx.storage.sql
      .exec<{ sequence: number }>(
        `INSERT INTO yjs_updates (actor_id, source, update_b64, created_at)
         VALUES (?, ?, ?, ?)
         RETURNING sequence`,
        actorId,
        source,
        update,
        createdAt,
      )
      .toArray()[0];
    const persisted = {
      sequence: row.sequence,
      actorId,
      source,
      update,
      createdAt,
    };
    this.compactIfNeeded();
    return persisted;
  }

  private compactIfNeeded() {
    const snapshot = this.latestSnapshot();
    const snapshotSequence = snapshot?.sequence ?? 0;
    const updates = this.updatesAfter(snapshotSequence);
    if (!shouldCompactRealtimeUpdates(updates.length)) return;

    const merged = mergeRealtimeUpdates([
      ...(snapshot ? [snapshot.update] : []),
      ...updates.map((update) => update.update),
    ]);
    const latest = updates.at(-1);
    if (!merged || !latest) return;

    const createdAt = new Date().toISOString();
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO yjs_snapshots (sequence, update_b64, created_at)
       VALUES (?, ?, ?)`,
      latest.sequence,
      merged,
      createdAt,
    );
    this.ctx.storage.sql.exec('DELETE FROM yjs_snapshots WHERE sequence < ?', latest.sequence);
  }

  private async restore(request: Request, roomId: string, actorId: string): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: 'invalid_json' }, { status: 400 });
    }
    const update = (body as { update?: unknown }).update;
    if (typeof update !== 'string' || !isValidYjsUpdate(update)) {
      return json({ ok: false, error: 'invalid_yjs_update' }, { status: 400 });
    }

    const persisted = this.appendUpdate(actorId, 'restore', update);
    const payload = JSON.stringify({
      type: 'yjs-update',
      actorId,
      roomId,
      sequence: persisted.sequence,
      source: persisted.source,
      update,
    });
    for (const peer of this.ctx.getWebSockets()) {
      peer.send(payload);
    }

    return json({
      ok: true,
      roomId,
      sequence: persisted.sequence,
      source: persisted.source,
    });
  }
}
