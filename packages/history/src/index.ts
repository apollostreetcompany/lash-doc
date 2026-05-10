/**
 * @lash/history — append-only edit log, deterministic diff engine, restore API.
 * Status: SCAFFOLD — implement in M2/C2 (history log), M2/C3 (diff), M2/C4 (restore).
 */

import type { DocumentId, HistoryEntry, DiffJSON, EditorOp, ActorRef } from '@lash/types';

export interface HistoryFilter {
  authorId?: string;
  authorType?: ActorRef['type'];
  since?: string;
  until?: string;
  intent?: HistoryEntry['intent'];
}

export interface HistoryStore {
  append(entry: HistoryEntry): Promise<void>;
  list(docId: DocumentId, filter?: HistoryFilter): Promise<HistoryEntry[]>;
  /** load doc state at a specific resultSha (uses snapshot if available) */
  loadAt(docId: DocumentId, sha: string): Promise<unknown>;
  /** restore creates a NEW head entry whose ops reproduce the target state — never destructive */
  restore(docId: DocumentId, targetSha: string, actor: ActorRef): Promise<HistoryEntry>;
}

export interface CreateHistoryStoreConfig {
  /** must be deterministic across environments (CI/dev/prod) */
  hash: (data: unknown) => string;
  /** snapshot every N entries; bigger = slower restore, smaller = more storage */
  snapshotInterval?: number;
}

export const createHistoryStore = (_config: CreateHistoryStoreConfig): HistoryStore => {
  throw new Error('createHistoryStore: not implemented (M2/C2)');
};

/** Deterministic diff between two history-rooted states. */
export const computeDiff = (_fromSha: string, _toSha: string, _entries: HistoryEntry[]): DiffJSON => {
  throw new Error('computeDiff: not implemented (M2/C3)');
};

/** Replay a sequence of ops against a base doc to reproduce a later state. */
export const replayOps = (_baseDoc: unknown, _ops: EditorOp[]): unknown => {
  throw new Error('replayOps: not implemented (M2/C2)');
};
