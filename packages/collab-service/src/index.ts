/**
 * @lash/collab-service — Yjs-backed CRDT broker, presence, and offline queue.
 * Status: SCAFFOLD — implement in M2/C1.
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
  /** broadcast a local op to peers */
  broadcast(op: EditorOp): void;
  /** subscribe to remote ops */
  onRemoteOps(handler: (ops: EditorOp[], from: ActorRef) => void): () => void;
  /** subscribe to presence changes */
  onPresence(handler: (peers: PresenceState[]) => void): () => void;
  /** flush queued offline ops on reconnect */
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
