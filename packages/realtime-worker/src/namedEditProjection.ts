import { normalizeYProsemirrorProjectionJson } from '@lash/editor-core';
import { canonicalize } from '@lash/types';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';

import {
  REALTIME_UPDATE_BASE64_LIMIT,
  base64ToBytes,
  bytesToBase64,
  hasPendingYjsData,
  loadRealtimeProjection,
} from './persistence';
import { PROMOTION_LIMITS, matchesLashEditorSchema } from './promotion';

const CONTENT = 'content';
const METADATA = 'lash:document-metadata:v1';
const encoder = new TextEncoder();

const isDocumentRoot = (name: string) => name === CONTENT || name === METADATA;

const hasPrivateReference = (root: Y.XmlFragment) => {
  const parents: Array<Y.XmlFragment | Y.XmlElement> = [root];
  for (const parent of parents) {
    for (const node of parent.toArray()) {
      if (node instanceof Y.XmlText) continue;
      if (!(node instanceof Y.XmlElement)) return true;
      if (node.nodeName === 'chip') return true;
      if (node.nodeName === 'mention') {
        const { kind, refId, iso } = node.getAttributes();
        if (
          kind !== 'date' ||
          typeof iso !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/u.test(iso) ||
          refId !== `date:${iso}`
        ) {
          return true;
        }
      }
      parents.push(node);
    }
  }
  return false;
};

const readProjectionTitle = (doc: Y.Doc): string | null => {
  if (!doc.share.has(CONTENT) || !doc.share.has(METADATA)) return null;
  const content = doc.getXmlFragment(CONTENT);
  const metadata = doc.getMap<unknown>(METADATA);
  const title = metadata.get('title');
  return content._map.size === 0 &&
    metadata._start === null &&
    metadata.size === 1 &&
    typeof title === 'string' &&
    title.trim().length > 0 &&
    encoder.encode(title).byteLength <= PROMOTION_LIMITS.titleBytes
    ? title
    : null;
};

export const readRoomYjsTitle = (doc: Y.Doc): string | null => {
  try {
    return hasPendingYjsData(doc) ? null : readProjectionTitle(doc);
  } catch {
    return null;
  }
};

export const loadRoomYjsProjection = loadRealtimeProjection;

export const applyRoomYjsUpdate = (doc: Y.Doc, update: string) => {
  try {
    Y.applyUpdate(doc, base64ToBytes(update));
    return !hasPendingYjsData(doc);
  } catch {
    return false;
  }
};

export const isSafePublicYjsProjection = (doc: Y.Doc) => {
  // Public v4 sends the actual CRDT history. A deleted adjunct is still
  // represented by its Yjs root, so current visible text alone cannot certify it.
  try {
    return (
      [...doc.share.keys()].every(isDocumentRoot) &&
      readProjectionTitle(doc) !== null &&
      !hasPrivateReference(doc.getXmlFragment(CONTENT))
    );
  } catch {
    return false;
  }
};

export const encodeRoomYjsStateVector = (doc: Y.Doc) => Y.encodeStateVector(doc);

export const encodePublicYjsProjection = (doc: Y.Doc, previousStateVector?: Uint8Array) => {
  // Serialize current GC'd Yjs state rather than returning raw historic updates.
  // Client clocks remain intact for a continuing read-only v4 socket.
  if (!isSafePublicYjsProjection(doc)) return null;
  try {
    return bytesToBase64(Y.encodeStateAsUpdate(doc, previousStateVector));
  } catch {
    return null;
  }
};

export const readCanonicalRoomYjsBody = (doc: Y.Doc): string | null => {
  try {
    const projection = normalizeYProsemirrorProjectionJson(
      yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(CONTENT)),
    );
    const canonical = canonicalize(projection);
    return encoder.encode(canonical).byteLength <= PROMOTION_LIMITS.bodyCanonicalBytes &&
      matchesLashEditorSchema(projection, canonical)
      ? canonical
      : null;
  } catch {
    return null;
  }
};

export const canShareNamedCommentProjection = (
  doc: Y.Doc,
  canonicalBody = readCanonicalRoomYjsBody(doc),
) => canonicalBody !== null && doc.gc && !hasPendingYjsData(doc) && isSafePublicYjsProjection(doc);

export const encodeNamedCommentYjsProjection = (
  doc: Y.Doc,
  previousStateVector?: Uint8Array,
  canonicalBody = readCanonicalRoomYjsBody(doc),
) => {
  if (!canShareNamedCommentProjection(doc, canonicalBody)) return null;
  const update = encodePublicYjsProjection(doc, previousStateVector);
  return update && update.length <= REALTIME_UPDATE_BASE64_LIMIT ? update : null;
};

/**
 * Mutates the validation copy only. The caller discards that copy on failure
 * and never persists/broadcasts the candidate. Private review has its own
 * typed operation store and cannot be changed through a document update.
 */
export const applyNamedEditYjsUpdate = (doc: Y.Doc, update: string) => {
  if (update.length > REALTIME_UPDATE_BASE64_LIMIT) return null;
  try {
    if (readProjectionTitle(doc) === null) return null;
    const privateRoots = [...doc.share].filter(([name]) => !isDocumentRoot(name));
    const privateTypes = new Set(privateRoots.map(([, type]) => type));
    let adjunctChanged = false;
    const inspect = (transaction: Y.Transaction) => {
      adjunctChanged =
        [...transaction.changed.keys(), ...transaction.changedParentTypes.keys()].some((type) =>
          privateTypes.has(type),
        ) ||
        [...doc.share.keys()].some(
          (name) => !isDocumentRoot(name) && !privateRoots.some(([previous]) => previous === name),
        );
    };
    doc.on('afterTransaction', inspect);
    const applied = applyRoomYjsUpdate(doc, update);
    doc.off('afterTransaction', inspect);
    if (!applied || adjunctChanged || readProjectionTitle(doc) === null) return null;
    return readCanonicalRoomYjsBody(doc);
  } catch {
    return null;
  }
};
