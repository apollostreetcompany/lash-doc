/**
 * @lash/history — append-only edit log, deterministic diff engine, restore API.
 * Status: SCAFFOLD — implement in M2/C2 (history log), M2/C3 (diff), M2/C4 (restore).
 *
 * Determinism: history MUST NOT inject its own hash function. parentSha,
 * resultSha, EditPatch.baseVersion, and DiffJSON.from/to are all computed via
 * `hashCanonical` from `@lash/types`. (proconsult-m0/B P0 #5.)
 *
 * Append concurrency: every `append` carries `expectedParentSha` and is
 * rejected with `parent-mismatch` when the head has moved. Callers MUST
 * either rebase their ops onto the new head or surface a conflict UI.
 */

import type { DocumentId, HistoryEntry, DiffJSON, EditorOp, ActorRef, Intent, HistoryAudit } from '@lash/types';

export interface HistoryFilter {
  authorId?: string;
  authorType?: ActorRef['type'];
  /** ISO-8601 inclusive bounds */
  since?: string;
  until?: string;
  intent?: Intent;
}

/** Caller-provided fields for a new entry. The history layer fills in
 *  `id`, `seq`, `resultSha`, and `ts`. */
export interface AppendInput {
  docId: DocumentId;
  actor: ActorRef;
  /** sha256 the caller believes is the current head. Server enforces match. */
  expectedParentSha: string;
  ops: EditorOp[];
  intent: Intent;
  audit: HistoryAudit;
  /** When the entry restores a prior version. */
  restoredFromVersion?: string;
}

export type AppendResult =
  | { ok: true; entry: HistoryEntry }
  | { ok: false; reason: 'parent-mismatch'; currentHead: string }
  | { ok: false; reason: 'schema-invalid'; details: string }
  | { ok: false; reason: 'rate-limited' };

export interface HistoryStore {
  /** Transactionally append; rejects when expectedParentSha != current head. */
  append(input: AppendInput): Promise<AppendResult>;
  list(docId: DocumentId, filter?: HistoryFilter): Promise<HistoryEntry[]>;
  /** Load doc state at a specific resultSha (uses snapshot if available). */
  loadAt(docId: DocumentId, sha: string): Promise<unknown>;
  /** Restore creates a NEW head entry whose ops reproduce the target state.
   *  Never destructive — older history is preserved. */
  restore(docId: DocumentId, targetSha: string, actor: ActorRef, audit: HistoryAudit): Promise<AppendResult>;
}

export interface CreateHistoryStoreConfig {
  /** Snapshot every N entries; bigger = slower restore, smaller = more storage. */
  snapshotInterval?: number;
}

export const createHistoryStore = (_config: CreateHistoryStoreConfig): HistoryStore => {
  throw new Error('createHistoryStore: not implemented (M2/C2)');
};

/** Deterministic diff between two history-rooted states. Implementation
 *  MUST be byte-identical across CI, dev, and prod (D.4 diff-deterministic). */
export const computeDiff = (_fromSha: string, _toSha: string, _entries: HistoryEntry[]): DiffJSON => {
  throw new Error('computeDiff: not implemented (M2/C3)');
};

/** Replay a sequence of ops against a base doc to reproduce a later state. */
export const replayOps = (_baseDoc: unknown, _ops: EditorOp[]): unknown => {
  throw new Error('replayOps: not implemented (M2/C2)');
};
