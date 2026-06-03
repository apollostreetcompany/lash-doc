import { DurableObject } from 'cloudflare:workers';

import type { RealtimeCapability, RealtimeInviteScope } from './access';
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

type AwarenessSelection = {
  from: number;
  to: number;
};

type AwarenessState = {
  actorId: string;
  label: string;
  color: string;
  selection: AwarenessSelection | null;
  updatedAt: number;
  connection: 'online';
};

type SocketAttachment = {
  actorId: string;
  roomId: string;
  capabilities: RealtimeCapability[];
  scope?: RealtimeInviteScope;
  connectedAt: number;
  awareness?: AwarenessState;
};

type ClientMessage = {
  type?: string;
  requestId?: string;
  payload?: unknown;
  update?: unknown;
  updateId?: unknown;
  awareness?: unknown;
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
      Array.isArray(attachment.capabilities) &&
      typeof attachment.connectedAt === 'number'
    ) {
      const awareness = isAwarenessState(attachment.awareness) ? attachment.awareness : undefined;
      return {
        actorId: attachment.actorId,
        roomId: attachment.roomId,
        capabilities: attachment.capabilities.filter(
          (capability): capability is RealtimeCapability =>
            capability === 'doc.read' || capability === 'doc.edit',
        ),
        scope:
          attachment.scope === 'view' ||
          attachment.scope === 'comment' ||
          attachment.scope === 'suggest' ||
          attachment.scope === 'edit'
            ? attachment.scope
            : undefined,
        connectedAt: attachment.connectedAt,
        ...(awareness ? { awareness } : {}),
      };
    }
  }

  return {
    actorId: 'unknown-actor',
    roomId: 'unknown-room',
    capabilities: [],
    connectedAt: Date.now(),
  };
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

const capabilitiesFromQuery = (value: string | null): RealtimeCapability[] =>
  (value ?? '')
    .split(',')
    .filter(
      (capability): capability is RealtimeCapability =>
        capability === 'doc.read' || capability === 'doc.edit',
    );

const scopeFromQuery = (value: string | null): RealtimeInviteScope | undefined =>
  value === 'view' || value === 'comment' || value === 'suggest' || value === 'edit'
    ? value
    : undefined;

const isAwarenessSelection = (value: unknown): value is AwarenessSelection => {
  if (!value || typeof value !== 'object') return false;
  const selection = value as Partial<AwarenessSelection>;
  return (
    typeof selection.from === 'number' &&
    Number.isFinite(selection.from) &&
    typeof selection.to === 'number' &&
    Number.isFinite(selection.to)
  );
};

const isAwarenessState = (value: unknown): value is AwarenessState => {
  if (!value || typeof value !== 'object') return false;
  const awareness = value as Partial<AwarenessState>;
  return (
    typeof awareness.actorId === 'string' &&
    typeof awareness.label === 'string' &&
    typeof awareness.color === 'string' &&
    typeof awareness.updatedAt === 'number' &&
    awareness.connection === 'online' &&
    (awareness.selection === null || isAwarenessSelection(awareness.selection))
  );
};

const awarenessFromMessage = (
  raw: unknown,
  attachment: SocketAttachment,
): AwarenessState | null => {
  if (!raw || typeof raw !== 'object') return null;
  const awareness = raw as {
    label?: unknown;
    color?: unknown;
    selection?: unknown;
  };
  const label =
    typeof awareness.label === 'string' && awareness.label.trim()
      ? awareness.label.trim().slice(0, 80)
      : attachment.actorId;
  const color =
    typeof awareness.color === 'string' && /^#[0-9a-f]{6}$/iu.test(awareness.color)
      ? awareness.color
      : '#64748b';
  const selection =
    awareness.selection === null
      ? null
      : isAwarenessSelection(awareness.selection)
        ? {
            from: Math.max(0, Math.floor(awareness.selection.from)),
            to: Math.max(0, Math.floor(awareness.selection.to)),
          }
        : null;
  return {
    actorId: attachment.actorId,
    label,
    color,
    selection,
    updatedAt: Date.now(),
    connection: 'online',
  };
};

const defaultAwareness = (attachment: SocketAttachment): AwarenessState => ({
  actorId: attachment.actorId,
  label: attachment.actorId,
  color: '#64748b',
  selection: null,
  updatedAt: attachment.connectedAt,
  connection: 'online',
});

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

    if (parsed.type === 'awareness-update') {
      const awareness = awarenessFromMessage(parsed.awareness, attachment);
      if (!awareness) {
        ws.send(
          JSON.stringify({
            type: 'error',
            roomId: attachment.roomId,
            code: 'invalid_awareness_update',
          }),
        );
        return;
      }
      ws.serializeAttachment({
        ...attachment,
        awareness,
      } satisfies SocketAttachment);
      this.broadcastAwareness(attachment.roomId);
      return;
    }

    if (parsed.type === 'yjs-update') {
      if (!attachment.capabilities.includes('doc.edit')) {
        ws.send(
          JSON.stringify({
            type: 'error',
            roomId: attachment.roomId,
            code: 'scope_mismatch',
          }),
        );
        return;
      }
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
      if (typeof parsed.updateId === 'string') {
        ws.send(
          JSON.stringify({
            type: 'sync-ack',
            actorId: attachment.actorId,
            roomId: attachment.roomId,
            updateId: parsed.updateId,
            sequence: persisted.sequence,
          }),
        );
      }
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
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    const attachment = readAttachment(ws);
    this.broadcastAwareness(attachment.roomId, ws);
  }

  private acceptSocket(request: Request, roomId: string, actorId: string): Response {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return json({ ok: false, error: 'expected_websocket' }, { status: 426 });
    }
    const url = new URL(request.url);
    const capabilities = capabilitiesFromQuery(url.searchParams.get('capabilities'));
    const scope = scopeFromQuery(url.searchParams.get('scope'));

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      actorId,
      roomId,
      capabilities,
      ...(scope ? { scope } : {}),
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
    this.broadcastAwareness(roomId);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private broadcastAwareness(roomId: string, exclude?: WebSocket) {
    const roomSockets = this.ctx
      .getWebSockets()
      .filter((peer) => peer !== exclude)
      .filter((peer) => readAttachment(peer).roomId === roomId);
    const peers = roomSockets
      .map(readAttachment)
      .map((attachment) => attachment.awareness ?? defaultAwareness(attachment));
    const payload = JSON.stringify({
      type: 'awareness-state',
      roomId,
      peers,
    });
    for (const peer of roomSockets) {
      peer.send(payload);
    }
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
