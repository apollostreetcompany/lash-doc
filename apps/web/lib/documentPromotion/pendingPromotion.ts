import { createLashEditorExtensions } from '@lash/editor-core';
import { createHistoryStore } from '@lash/history';
import { canonicalize, createDocumentId } from '@lash/types';
import { getSchema } from '@tiptap/core';

import { documentTitleStorageKey, readDocumentTitle } from '../documentRegistry';
import {
  assertStrictLocalBodySchemaJson,
  loadLocalDocumentBody,
  localDocumentBodyKey,
} from '../localDocumentBodyPersistence';
import { createLocalDocumentHistoryPersistence } from '../localDocumentHistoryPersistence';
import { hashPromotionBytes, type BrowserPromotionSnapshotProof } from './browserClient';

const PROMOTION_SHA256 = /^[A-Za-z0-9_-]{43}$/u;
const MAX_PENDING_PROMOTION_LENGTH = 32 * 1024;
const documentPromotionKey = (documentId: string) => `lash:pending-promotion:v1:${documentId}`;

type VerifiedPromotionSource = Readonly<{
  revision: number;
  writeId: string;
  title: string;
  bodySha256: string;
}>;

type PendingPromotion = Readonly<
  VerifiedPromotionSource & {
    version: 1;
    documentId: string;
    snapshotSha256: string;
  }
>;

export type PendingPromotionRead =
  | { state: 'absent' | 'unverified' }
  | { state: 'pending'; marker: PendingPromotion; raw: string };

type ReadSource = (
  documentId: string,
) => Promise<(VerifiedPromotionSource & { isCurrent(): boolean }) | null>;

const parseMarker = (raw: string, documentId: string): PendingPromotion | null => {
  if (raw.length > MAX_PENDING_PROMOTION_LENGTH) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const marker = value as Partial<PendingPromotion>;
  if (
    Object.keys(marker).length !== 7 ||
    marker.version !== 1 ||
    marker.documentId !== documentId ||
    typeof marker.revision !== 'number' ||
    !Number.isSafeInteger(marker.revision) ||
    marker.revision < 1 ||
    typeof marker.writeId !== 'string' ||
    !marker.writeId ||
    marker.writeId.length > 128 ||
    typeof marker.title !== 'string' ||
    !marker.title ||
    marker.title !== marker.title.trim() ||
    typeof marker.bodySha256 !== 'string' ||
    !PROMOTION_SHA256.test(marker.bodySha256) ||
    typeof marker.snapshotSha256 !== 'string' ||
    !PROMOTION_SHA256.test(marker.snapshotSha256)
  )
    return null;
  return marker as PendingPromotion;
};

export const createPendingPromotionStore = (
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  readSource: ReadSource,
) => {
  const read = (documentId: string): PendingPromotionRead => {
    try {
      const raw = storage.getItem(documentPromotionKey(documentId));
      if (raw === null) return { state: 'absent' };
      const marker = parseMarker(raw, documentId);
      return marker ? { state: 'pending', marker, raw } : { state: 'unverified' };
    } catch {
      return { state: 'unverified' };
    }
  };
  const isCurrent = (pending: Extract<PendingPromotionRead, { state: 'pending' }>) => {
    const current = read(pending.marker.documentId);
    return current.state === 'pending' && current.raw === pending.raw;
  };

  return {
    read,
    isCurrent,
    async record(proof: BrowserPromotionSnapshotProof, signal: AbortSignal) {
      const { localDocumentId, snapshotSha256, title, bodySha256 } = proof;
      try {
        const source = await readSource(localDocumentId);
        if (
          signal.aborted ||
          !source ||
          !source.isCurrent() ||
          source.title !== title ||
          source.bodySha256 !== bodySha256
        ) {
          return false;
        }
        const marker = {
          version: 1,
          documentId: localDocumentId,
          snapshotSha256,
          revision: source.revision,
          writeId: source.writeId,
          title,
          bodySha256,
        };
        const raw = JSON.stringify(marker);
        const prior = read(localDocumentId);
        // A request may already have reached a different signed-in account.
        if (prior.state !== 'absent' || !parseMarker(raw, localDocumentId)) return false;

        storage.setItem(documentPromotionKey(localDocumentId), raw);
        return storage.getItem(documentPromotionKey(localDocumentId)) === raw;
      } catch {
        return false;
      }
    },
    async verifyUnchanged(pending: Extract<PendingPromotionRead, { state: 'pending' }>) {
      const { marker } = pending;
      const source = await readSource(marker.documentId);
      if (
        !source ||
        source.revision !== marker.revision ||
        source.writeId !== marker.writeId ||
        source.title !== marker.title ||
        source.bodySha256 !== marker.bodySha256
      )
        return null;
      const stillUnchanged = () => isCurrent(pending) && source.isCurrent();
      return stillUnchanged() ? stillUnchanged : null;
    },
    clear(pending: Extract<PendingPromotionRead, { state: 'pending' }>) {
      if (!isCurrent(pending)) return;
      try {
        storage.removeItem(documentPromotionKey(pending.marker.documentId));
      } catch {
        // Retaining the marker keeps the same local safeguard after reload.
      }
    },
  };
};

export type PendingPromotionStore = ReturnType<typeof createPendingPromotionStore>;

const noLocalComments = (raw: string | null) => {
  if (raw === null) return true;
  const value: unknown = JSON.parse(raw);
  return Array.isArray(value) && value.length === 0;
};

const readResolvedSuggestionIds = (raw: string | null) => {
  if (raw === null) return new Set<string>();
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) return null;
  const resolved = new Set<string>();
  for (const record of value) {
    if (
      typeof record?.entryId !== 'string' ||
      typeof record.id !== 'string' ||
      typeof record.ts !== 'string' ||
      typeof record.actorId !== 'string' ||
      (record.action !== 'accepted' && record.action !== 'rejected')
    )
      return null;
    resolved.add(record.entryId);
  }
  return resolved;
};

export const createBrowserPendingPromotionStore = (
  storage: Storage,
  historyPersistence = createLocalDocumentHistoryPersistence(),
) =>
  createPendingPromotionStore(storage, async (documentId) => {
    try {
      const bodyKey = localDocumentBodyKey(documentId);
      const bodyRaw = storage.getItem(bodyKey);
      const titleKey = documentTitleStorageKey(documentId);
      const rawTitle = storage.getItem(titleKey);
      const title = readDocumentTitle(storage, documentId);
      const commentKey = `lash:chat-threads:${documentId}`;
      const comments = storage.getItem(commentKey);
      const resolutionKey = `lash:suggestion-resolutions:${documentId}`;
      const resolutions = storage.getItem(resolutionKey);
      const resolved = readResolvedSuggestionIds(resolutions);
      if (!noLocalComments(comments) || !resolved) return null;

      const schema = getSchema(createLashEditorExtensions());
      const source = loadLocalDocumentBody({
        storage,
        documentId,
        validateSchema: (doc) => assertStrictLocalBodySchemaJson(doc, schema),
      });
      if (source.state !== 'ready' || source.envelope.suggestions?.some((item) => !item.decision)) {
        return null;
      }

      const bodySha256 = await hashPromotionBytes(
        canonicalize(source.envelope.doc),
        globalThis.crypto,
      );
      const history = createHistoryStore({ persistence: historyPersistence });
      const historyId = createDocumentId(documentId);
      const hydrated = await history.hydrate(historyId);
      if (hydrated.state !== 'ready' && hydrated.state !== 'empty-baseline') return null;
      const suggestions = await history.list(historyId, { intent: 'suggest' });
      if (suggestions.some((entry) => !resolved.has(entry.id))) return null;
      const isCurrent = () => {
        try {
          return (
            storage.getItem(bodyKey) === bodyRaw &&
            storage.getItem(titleKey) === rawTitle &&
            readDocumentTitle(storage, documentId) === title &&
            storage.getItem(commentKey) === comments &&
            storage.getItem(resolutionKey) === resolutions
          );
        } catch {
          return false;
        }
      };
      return isCurrent() ? { ...source.expected, title, bodySha256, isCurrent } : null;
    } catch {
      return null;
    }
  });
