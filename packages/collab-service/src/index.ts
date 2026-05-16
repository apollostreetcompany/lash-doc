/**
 * @lash/collab-service — Yjs-backed CRDT broker, presence, and offline queue.
 * Status: SCAFFOLD — implement in M2/C1.
 *
 * Boundary (per proconsult-m0/B P1 #15):
 *   - Wire protocol = Yjs `Uint8Array` updates. CRDT convergence is owned
 *     entirely by Yjs and travels as raw updates over the WS transport.
 *   - Persisted history = `EditorOp[]` in `HistoryEntry` (canonical
 *     replay/diff/authorship unit).
 *   - The collab-service translates between the two: incoming Yjs updates
 *     are normalized into `EditorOp` for history; outgoing replay/restore
 *     ops are converted back to Yjs updates for broadcast.
 *
 * The CollabRoom interface deliberately exposes BOTH paths so callers can
 * pick the right one for their use case.
 */

import type { DocumentId, EditorOp, ActorRef } from '@lash/types';

export interface PresenceState {
  actor: ActorRef;
  cursor?: { from: number; to: number };
  /** ISO-8601 ts of last activity */
  lastSeen: string;
  /** Local connection state; real transports may map this to provider awareness. */
  connection?: 'online' | 'offline';
}

export interface CollabRoom {
  readonly docId: DocumentId;

  // ---- Network primitive (Yjs updates) ----

  /** Apply a Yjs update to the local replica and broadcast to peers. */
  applyYjsUpdate(update: Uint8Array, origin?: unknown): void;
  /** Subscribe to remote Yjs updates. Returns an unsubscribe fn. */
  onYjsUpdate(handler: (update: Uint8Array, origin: unknown) => void): () => void;

  // ---- Semantic op pipeline (canonical EditorOp) ----

  /** Normalize a Yjs update into EditorOps for history persistence. */
  toEditorOps(update: Uint8Array): EditorOp[];
  /** Convert EditorOps back into a Yjs update for broadcast/replay. */
  fromEditorOps(ops: EditorOp[]): Uint8Array;

  // ---- Presence ----

  onPresence(handler: (peers: PresenceState[]) => void): () => void;
  setLocalPresence(presence: Pick<PresenceState, 'cursor'>): void;

  // ---- Offline queue ----

  /** Replay queued offline updates on reconnect; resolves once flushed. */
  flushQueue(): Promise<void>;
  close(): Promise<void>;
}

export interface LocalCollabRoom extends CollabRoom {
  setOnline(online: boolean): void;
  isOnline(): boolean;
  getQueueDepth(): number;
  onQueue(handler: (depth: number) => void): () => void;
  getAppliedOps(): EditorOp[];
}

export interface CreateCollabRoomConfig {
  docId: DocumentId;
  actor: ActorRef;
  wsEndpoint: string;
}

const encodeOps = (ops: EditorOp[]) => new TextEncoder().encode(JSON.stringify(ops));

const decodeOps = (update: Uint8Array): EditorOp[] => {
  const decoded = new TextDecoder().decode(update);
  if (!decoded) return [];
  const parsed = JSON.parse(decoded) as unknown;
  return Array.isArray(parsed) ? (parsed as EditorOp[]) : [];
};

export const createLocalCollabRoom = (config: CreateCollabRoomConfig): LocalCollabRoom => {
  let online = true;
  let closed = false;
  const queued: Array<{ update: Uint8Array; origin: unknown }> = [];
  const appliedOps: EditorOp[] = [];
  const updateHandlers = new Set<(update: Uint8Array, origin: unknown) => void>();
  const presenceHandlers = new Set<(peers: PresenceState[]) => void>();
  const queueHandlers = new Set<(depth: number) => void>();
  let localPresence: PresenceState = {
    actor: config.actor,
    lastSeen: new Date().toISOString(),
    connection: 'online',
  };

  const emitQueue = () => queueHandlers.forEach((handler) => handler(queued.length));
  const emitPresence = () => presenceHandlers.forEach((handler) => handler([{ ...localPresence }]));

  const applyOnline = (update: Uint8Array, origin: unknown) => {
    appliedOps.push(...decodeOps(update));
    updateHandlers.forEach((handler) => handler(update, origin));
  };

  const room: LocalCollabRoom = {
    docId: config.docId,
    applyYjsUpdate(update, origin) {
      if (closed) return;
      if (!online) {
        queued.push({ update, origin });
        emitQueue();
        return;
      }
      applyOnline(update, origin);
    },
    onYjsUpdate(handler) {
      updateHandlers.add(handler);
      return () => updateHandlers.delete(handler);
    },
    toEditorOps: decodeOps,
    fromEditorOps: encodeOps,
    onPresence(handler) {
      presenceHandlers.add(handler);
      handler([{ ...localPresence }]);
      return () => presenceHandlers.delete(handler);
    },
    setLocalPresence(presence) {
      localPresence = {
        actor: config.actor,
        cursor: presence.cursor,
        lastSeen: new Date().toISOString(),
        connection: online ? 'online' : 'offline',
      };
      emitPresence();
    },
    async flushQueue() {
      if (closed || !online) return;
      const pending = queued.splice(0, queued.length);
      emitQueue();
      pending.forEach(({ update, origin }) => applyOnline(update, origin ?? 'offline-replay'));
    },
    async close() {
      closed = true;
      queued.splice(0, queued.length);
      updateHandlers.clear();
      presenceHandlers.clear();
      queueHandlers.clear();
    },
    setOnline(nextOnline) {
      if (closed || online === nextOnline) return;
      online = nextOnline;
      localPresence = {
        ...localPresence,
        lastSeen: new Date().toISOString(),
        connection: online ? 'online' : 'offline',
      };
      emitPresence();
      if (online) void room.flushQueue();
    },
    isOnline: () => online,
    getQueueDepth: () => queued.length,
    onQueue(handler) {
      queueHandlers.add(handler);
      handler(queued.length);
      return () => queueHandlers.delete(handler);
    },
    getAppliedOps: () => [...appliedOps],
  };

  return room;
};

export const createCollabRoom = (config: CreateCollabRoomConfig): CollabRoom => {
  return createLocalCollabRoom(config);
};
