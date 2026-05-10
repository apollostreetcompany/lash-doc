/**
 * @lash/storage — Postgres bindings, object-store adapters, search index hydration.
 * Status: SCAFFOLD — implement in M2/C2 alongside the history log.
 *
 * Hashing for `parentSha`/`resultSha` MUST go through `@lash/types/hashCanonical`.
 * Storage layer never invents its own hash function.
 */

import type { DocumentId, HistoryEntry } from '@lash/types';

export interface DocStore {
  load(docId: DocumentId): Promise<{ doc: unknown; resultSha: string } | null>;
  save(docId: DocumentId, doc: unknown, resultSha: string): Promise<void>;
}

export interface HistoryLogStore {
  /** Append-only — implementations enforce the parent-sha precondition. */
  append(entry: HistoryEntry, expectedParentSha: string): Promise<{ ok: true } | { ok: false; reason: 'parent-mismatch'; currentHead: string }>;
  list(
    docId: DocumentId,
    filter?: { since?: string; until?: string; authorId?: string },
  ): Promise<HistoryEntry[]>;
  /** Current head sha for a doc, used by appenders to refresh on conflict. */
  headSha(docId: DocumentId): Promise<string | null>;
}

export interface ObjectStore {
  put(key: string, body: Uint8Array, contentType?: string): Promise<{ url: string }>;
  get(key: string): Promise<Uint8Array | null>;
  signUrl(key: string, ttlSeconds: number): Promise<string>;
}

export interface SearchIndex {
  hydrate(docId: DocumentId, doc: unknown): Promise<void>;
  search(
    query: string,
    scope?: { docIds?: DocumentId[] },
  ): Promise<{ docId: DocumentId; rangeFrom: number; rangeTo: number; snippet: string }[]>;
}

export const createPostgresDocStore = (_config: { connectionString: string }): DocStore => {
  throw new Error('createPostgresDocStore: not implemented (M2/C2)');
};

export const createPostgresHistoryStore = (_config: { connectionString: string }): HistoryLogStore => {
  throw new Error('createPostgresHistoryStore: not implemented (M2/C2)');
};

export const createS3ObjectStore = (_config: { bucket: string; region: string }): ObjectStore => {
  throw new Error('createS3ObjectStore: not implemented (M5)');
};
