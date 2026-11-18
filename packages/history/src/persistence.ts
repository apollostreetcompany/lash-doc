import type { HistoryEntry } from '@lash/types';

import type { HistoryDocumentState } from './index';

export const HISTORY_DATABASE_NAME = 'lash-history';
export const HISTORY_DATABASE_VERSION = 1;
export const HISTORY_ENVELOPE_KIND = 'lash-history';
export const HISTORY_ENVELOPE_VERSION = 1;
export const HISTORY_SCHEMA_VERSION = 'lash-history-v1';
export const HISTORY_EDITOR_SCHEMA_VERSION = 'lash-schema-v1';
export const HISTORY_CANONICAL_VERSION = 'lash-canonical-json-v1';
export const HISTORY_MAX_ENVELOPE_BYTES = 32 * 1024 * 1024;
export const HISTORY_MAX_ENTRIES = 10_000;
export const HISTORY_MAX_TOTAL_OPS = 100_000;

export type PersistedHistorySnapshotV1 = Readonly<{
  sha: string;
  doc: HistoryDocumentState;
}>;

export type PersistedHistoryPayloadV1 = Readonly<{
  kind: typeof HISTORY_ENVELOPE_KIND;
  version: typeof HISTORY_ENVELOPE_VERSION;
  historySchema: typeof HISTORY_SCHEMA_VERSION;
  editorSchema: typeof HISTORY_EDITOR_SCHEMA_VERSION;
  documentId: string;
  revision: number;
  writeId: string;
  savedAt: string;
  previousPayloadSha: string | null;
  snapshotInterval: number;
  baseSha: string;
  head: string;
  entries: HistoryEntry[];
  snapshots: PersistedHistorySnapshotV1[];
}>;

export type PersistedHistoryEnvelopeV1 = Readonly<{
  payload: PersistedHistoryPayloadV1;
  integrity: Readonly<{
    algorithm: 'SHA-256';
    canonical: typeof HISTORY_CANONICAL_VERSION;
    payloadSha: string;
  }>;
}>;

export type HistoryPersistenceReadResult = Readonly<{
  primaryRaw: string | null;
  backupRaw: string | null;
}>;

export type HistoryPersistenceCommitInput = Readonly<{
  documentId: string;
  expectedPrimaryRaw: string | null;
  nextPrimaryRaw: string;
  commitGuard: () => boolean;
}>;

export type HistoryPersistenceCommitResult =
  | Readonly<{ ok: true; primaryRaw: string }>
  | Readonly<{ ok: false; reason: 'cas-mismatch'; currentRaw: string | null }>
  | Readonly<{ ok: false; reason: 'guard-denied' | 'guard-threw' }>
  | Readonly<{ ok: false; reason: 'history-capacity' }>
  | Readonly<{
      ok: false;
      reason: 'unavailable' | 'commit-uncertain';
      details: string;
    }>;

export interface HistoryPersistenceAdapter {
  read(documentId: string): Promise<HistoryPersistenceReadResult>;
  commit(input: HistoryPersistenceCommitInput): Promise<HistoryPersistenceCommitResult>;
}
