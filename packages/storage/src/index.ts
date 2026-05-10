/**
 * @lash/storage — Postgres bindings, object-store adapters, search index hydration.
 * Status: SCAFFOLD — implement in M2/C2 alongside the history log.
 */

import type { DocumentId, HistoryEntry } from '@lash/types';

export interface DocStore {
  load(docId: DocumentId): Promise<{ doc: unknown; resultSha: string } | null>;
  save(docId: DocumentId, doc: unknown, resultSha: string): Promise<void>;
}

export interface HistoryLogStore {
  append(entry: HistoryEntry): Promise<void>;
  list(docId: DocumentId, filter?: { since?: string; until?: string; authorId?: string }): Promise<HistoryEntry[]>;
}

export interface ObjectStore {
  put(key: string, body: Uint8Array, contentType?: string): Promise<{ url: string }>;
  get(key: string): Promise<Uint8Array | null>;
  signUrl(key: string, ttlSeconds: number): Promise<string>;
}

export interface SearchIndex {
  hydrate(docId: DocumentId, doc: unknown): Promise<void>;
  search(query: string, scope?: { docIds?: DocumentId[] }): Promise<{ docId: DocumentId; rangeFrom: number; rangeTo: number; snippet: string }[]>;
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
