/**
 * @lash/collab-service — local scaffold for the future Yjs-backed CRDT
 * broker, presence, and offline queue.
 * Status: LOCAL SCAFFOLD. It encodes EditorOp arrays into Uint8Array values
 * and emits them inside the current JS process only. It does not import Yjs,
 * open a websocket, persist updates, or synchronize separate browsers yet.
 *
 * Boundary (per proconsult-m0/B P1 #15):
 *   - Future wire protocol = Yjs `Uint8Array` updates. CRDT convergence will
 *     be owned by Yjs and travel as raw updates over the websocket transport.
 *   - Persisted history = `EditorOp[]` in `HistoryEntry` (canonical
 *     replay/diff/authorship unit).
 *   - The production collab-service will translate between the two: incoming
 *     Yjs updates are normalized into `EditorOp` for history; outgoing
 *     replay/restore ops are converted back to Yjs updates for broadcast.
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

  // ---- Future network primitive (Yjs-shaped updates) ----

  /** Apply a binary update to the local scaffold and emit to local subscribers. */
  applyYjsUpdate(update: Uint8Array, origin?: unknown): void;
  /** Subscribe to local binary updates. Returns an unsubscribe fn. */
  onYjsUpdate(handler: (update: Uint8Array, origin: unknown) => void): () => void;

  // ---- Semantic op pipeline (canonical EditorOp) ----

  /** Decode a scaffold update into EditorOps for history persistence tests. */
  toEditorOps(update: Uint8Array): EditorOp[];
  /** Encode EditorOps back into a scaffold update for replay tests. */
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
