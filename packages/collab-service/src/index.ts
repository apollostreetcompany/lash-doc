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

export interface CreateCollabRoomConfig {
  docId: DocumentId;
  actor: ActorRef;
  wsEndpoint: string;
}

export const createCollabRoom = (_config: CreateCollabRoomConfig): CollabRoom => {
  throw new Error('createCollabRoom: not implemented (M2/C1)');
};
