import { createLashEditorExtensions, normalizeYProsemirrorProjectionJson } from '@lash/editor-core';
import { canonicalize } from '@lash/types';
import { getSchema } from '@tiptap/core';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';

import { base64ToBytes, bytesToBase64, isRealtimeUpdatePayload } from './persistence';
import { normalizeRoomName } from './routing';

declare global {
  interface Element {
    // The generated Workers HTMLRewriter Element and DOM Element declarations
    // merge during this cross-runtime schema typecheck. Preserve the browser
    // append overload used by editor-core; this has no Worker runtime effect.
    append(...nodes: (Node | string)[]): void;
  }
}

export const PROMOTION_LIMITS = {
  requestBytes: 2 * 1024 * 1024,
  titleBytes: 4 * 1024,
  bodyCanonicalBytes: 1024 * 1024,
  initialUpdateBytes: 1024 * 1024,
  roomCharacters: 128,
} as const;

const BASE64URL_SHA256 = /^[A-Za-z0-9_-]{43}$/u;
const ACCOUNT_PRINCIPAL = /^account:v1:[A-Za-z0-9_-]{43}$/u;
const STANDARD_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const textEncoder = new TextEncoder();
const lashEditorSchema = getSchema(createLashEditorExtensions());

export interface ValidatedDocumentPromotionRequestV1 {
  version: 1;
  roomId: string;
  ownerPrincipalId: string;
  idempotencyHash: string;
  createIfMissing: boolean;
  snapshot: {
    version: 1;
    title: string;
    body: unknown;
    bodySha256: string;
    initialUpdate: string;
    initialUpdateSha256: string;
    adjuncts: { comments: 0; suggestions: 0 };
    snapshotSha256: string;
  };
}

const exactKeys = (value: Record<string, unknown>, expected: string[]) => {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const canonicalizePromotionJson = canonicalize;

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
};

export const sha256Base64Url = async (bytes: Uint8Array) =>
  bytesToBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))));

const validProseMirrorRoot = (body: unknown) =>
  isPlainObject(body) &&
  body.type === 'doc' &&
  (body.content === undefined || Array.isArray(body.content));

export const matchesLashEditorSchema = (body: unknown, canonicalBody: string) => {
  try {
    const document = lashEditorSchema.nodeFromJSON(body);
    document.check();
    return canonicalize(document.toJSON()) === canonicalBody;
  } catch {
    return false;
  }
};

const parseJsonWithoutDuplicateKeys = (raw: string): unknown => {
  let offset = 0;
  const whitespace = () => {
    while (/[\t\n\r ]/u.test(raw[offset] ?? '')) offset += 1;
  };
  const parseString = () => {
    const start = offset;
    if (raw[offset] !== '"') throw new Error('string expected');
    offset += 1;
    while (offset < raw.length) {
      const character = raw[offset];
      if (character === '"') {
        offset += 1;
        return JSON.parse(raw.slice(start, offset)) as string;
      }
      offset += character === '\\' ? 2 : 1;
    }
    throw new Error('unterminated string');
  };
  const parseValue = (): void => {
    whitespace();
    const character = raw[offset];
    if (character === '{') {
      offset += 1;
      whitespace();
      const keys = new Set<string>();
      if (raw[offset] === '}') {
        offset += 1;
        return;
      }
      while (offset < raw.length) {
        whitespace();
        const key = parseString();
        if (keys.has(key)) throw new Error('duplicate key');
        keys.add(key);
        whitespace();
        if (raw[offset] !== ':') throw new Error('colon expected');
        offset += 1;
        parseValue();
        whitespace();
        if (raw[offset] === '}') {
          offset += 1;
          return;
        }
        if (raw[offset] !== ',') throw new Error('comma expected');
        offset += 1;
      }
      throw new Error('unterminated object');
    }
    if (character === '[') {
      offset += 1;
      whitespace();
      if (raw[offset] === ']') {
        offset += 1;
        return;
      }
      while (offset < raw.length) {
        parseValue();
        whitespace();
        if (raw[offset] === ']') {
          offset += 1;
          return;
        }
        if (raw[offset] !== ',') throw new Error('comma expected');
        offset += 1;
      }
      throw new Error('unterminated array');
    }
    if (character === '"') {
      parseString();
      return;
    }
    const token = raw
      .slice(offset)
      .match(/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/u)?.[0];
    if (!token) throw new Error('value expected');
    offset += token.length;
  };

  parseValue();
  whitespace();
  if (offset !== raw.length) throw new Error('trailing input');
  return JSON.parse(raw) as unknown;
};

const decodeStrictBase64 = (value: string) => {
  if (value.length === 0 || !STANDARD_BASE64.test(value)) return null;
  try {
    const decoded = base64ToBytes(value);
    if (bytesToBase64(decoded) !== value) return null;
    return decoded;
  } catch {
    return null;
  }
};

export const projectionMatchesInitialUpdate = (
  update: Uint8Array,
  title: string,
  bodyCanonical: string,
) => {
  try {
    const document = new Y.Doc();
    Y.applyUpdate(document, update);
    const sharedNames = [...document.share.keys()];
    if (
      !sharedNames.includes('lash:document-metadata:v1') ||
      sharedNames.some((name) => name !== 'content' && name !== 'lash:document-metadata:v1')
    ) {
      return false;
    }
    // Applied updates initially expose top-level roots as untyped AbstractType
    // placeholders. The typed getters bind and validate the expected Yjs kinds.
    const content = document.getXmlFragment('content');
    const metadata = document.getMap<unknown>('lash:document-metadata:v1');
    if (
      metadata.size !== 1 ||
      metadata.get('title') !== title ||
      [...metadata.keys()].some((key) => key !== 'title')
    ) {
      return false;
    }
    const decodedBody = yXmlFragmentToProsemirrorJSON(content);
    return canonicalize(normalizeYProsemirrorProjectionJson(decodedBody)) === bodyCanonical;
  } catch {
    return false;
  }
};

export type PromotionRequestDecision =
  | { ok: true; request: ValidatedDocumentPromotionRequestV1 }
  | { ok: false; error: 'invalid-request' };

export type PromotionBodyDecision =
  | { ok: true; body: Uint8Array; value: unknown }
  | { ok: false; status: 400 | 413 | 415 };

export const readPromotionBody = async (
  request: Request,
  byteLimit = PROMOTION_LIMITS.requestBytes,
): Promise<PromotionBodyDecision> => {
  const contentEncoding = request.headers.get('content-encoding');
  if (
    contentEncoding !== null &&
    (contentEncoding.trim() !== contentEncoding ||
      contentEncoding.includes(',') ||
      contentEncoding.toLowerCase() !== 'identity')
  ) {
    return { ok: false, status: 415 };
  }

  const contentType = request.headers.get('content-type');
  if (contentType === null || contentType.includes(',')) {
    return { ok: false, status: 415 };
  }
  const [mediaType, ...parameters] = contentType.split(';').map((part) => part.trim());
  if (
    mediaType.toLowerCase() !== 'application/json' ||
    parameters.length > 1 ||
    parameters.some((parameter) => !/^charset=utf-8$/iu.test(parameter.replace(/\s+/gu, '')))
  ) {
    return { ok: false, status: 415 };
  }

  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength)) {
      return { ok: false, status: 400 };
    }
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length)) return { ok: false, status: 400 };
    if (length > byteLimit) return { ok: false, status: 413 };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, status: 400 };
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > byteLimit) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413 };
      }
      chunks.push(chunk.value);
    }
  } catch {
    return { ok: false, status: 400 };
  }
  if (length === 0) return { ok: false, status: 400 };

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) {
    return { ok: false, status: 400 };
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(body);
    return { ok: true, body, value: parseJsonWithoutDuplicateKeys(text) };
  } catch {
    return { ok: false, status: 400 };
  }
};

export const parseDocumentPromotionRequest = async (
  value: unknown,
  expectedRoomId: string,
): Promise<PromotionRequestDecision> => {
  if (!isPlainObject(value)) return { ok: false, error: 'invalid-request' };
  if (
    !exactKeys(value, [
      'version',
      'roomId',
      'ownerPrincipalId',
      'idempotencyHash',
      'createIfMissing',
      'snapshot',
    ]) ||
    value.version !== 1 ||
    typeof value.roomId !== 'string' ||
    value.roomId.length > PROMOTION_LIMITS.roomCharacters ||
    normalizeRoomName(value.roomId) !== value.roomId ||
    value.roomId !== expectedRoomId ||
    typeof value.ownerPrincipalId !== 'string' ||
    !ACCOUNT_PRINCIPAL.test(value.ownerPrincipalId) ||
    typeof value.idempotencyHash !== 'string' ||
    !BASE64URL_SHA256.test(value.idempotencyHash) ||
    typeof value.createIfMissing !== 'boolean' ||
    !isPlainObject(value.snapshot)
  ) {
    return { ok: false, error: 'invalid-request' };
  }

  const snapshot = value.snapshot;
  if (
    !exactKeys(snapshot, [
      'version',
      'title',
      'body',
      'bodySha256',
      'initialUpdate',
      'initialUpdateSha256',
      'adjuncts',
      'snapshotSha256',
    ]) ||
    snapshot.version !== 1 ||
    typeof snapshot.title !== 'string' ||
    snapshot.title.normalize('NFC') !== snapshot.title ||
    textEncoder.encode(snapshot.title).byteLength > PROMOTION_LIMITS.titleBytes ||
    !validProseMirrorRoot(snapshot.body) ||
    typeof snapshot.bodySha256 !== 'string' ||
    !BASE64URL_SHA256.test(snapshot.bodySha256) ||
    typeof snapshot.initialUpdate !== 'string' ||
    typeof snapshot.initialUpdateSha256 !== 'string' ||
    !BASE64URL_SHA256.test(snapshot.initialUpdateSha256) ||
    !isPlainObject(snapshot.adjuncts) ||
    !exactKeys(snapshot.adjuncts, ['comments', 'suggestions']) ||
    snapshot.adjuncts.comments !== 0 ||
    snapshot.adjuncts.suggestions !== 0 ||
    typeof snapshot.snapshotSha256 !== 'string' ||
    !BASE64URL_SHA256.test(snapshot.snapshotSha256)
  ) {
    return { ok: false, error: 'invalid-request' };
  }

  let bodyCanonical: string;
  try {
    bodyCanonical = canonicalizePromotionJson(snapshot.body);
  } catch {
    return { ok: false, error: 'invalid-request' };
  }
  if (textEncoder.encode(bodyCanonical).byteLength > PROMOTION_LIMITS.bodyCanonicalBytes) {
    return { ok: false, error: 'invalid-request' };
  }
  if (!matchesLashEditorSchema(snapshot.body, bodyCanonical)) {
    return { ok: false, error: 'invalid-request' };
  }

  const initialUpdateBytes = decodeStrictBase64(snapshot.initialUpdate);
  if (
    !initialUpdateBytes ||
    initialUpdateBytes.byteLength > PROMOTION_LIMITS.initialUpdateBytes ||
    !isRealtimeUpdatePayload(snapshot.initialUpdate) ||
    !projectionMatchesInitialUpdate(initialUpdateBytes, snapshot.title, bodyCanonical)
  ) {
    return { ok: false, error: 'invalid-request' };
  }

  const bodySha256 = await sha256Base64Url(textEncoder.encode(bodyCanonical));
  const initialUpdateSha256 = await sha256Base64Url(initialUpdateBytes);
  const snapshotSha256 = await sha256Base64Url(
    textEncoder.encode(
      canonicalizePromotionJson({
        version: 1,
        title: snapshot.title,
        bodySha256,
        initialUpdateSha256,
        adjuncts: { comments: 0, suggestions: 0 },
      }),
    ),
  );
  if (
    bodySha256 !== snapshot.bodySha256 ||
    initialUpdateSha256 !== snapshot.initialUpdateSha256 ||
    snapshotSha256 !== snapshot.snapshotSha256
  ) {
    return { ok: false, error: 'invalid-request' };
  }

  const request: ValidatedDocumentPromotionRequestV1 = {
    version: 1,
    roomId: value.roomId,
    ownerPrincipalId: value.ownerPrincipalId,
    idempotencyHash: value.idempotencyHash,
    createIfMissing: value.createIfMissing,
    snapshot: {
      version: 1,
      title: snapshot.title,
      body: JSON.parse(bodyCanonical) as unknown,
      bodySha256,
      initialUpdate: snapshot.initialUpdate,
      initialUpdateSha256,
      adjuncts: { comments: 0, suggestions: 0 },
      snapshotSha256,
    },
  };
  if (
    textEncoder.encode(canonicalizePromotionJson(request)).byteLength >
    PROMOTION_LIMITS.requestBytes
  ) {
    return { ok: false, error: 'invalid-request' };
  }
  return { ok: true, request };
};

export interface ExistingDocumentPromotion {
  ownerPrincipalId: string;
  idempotencyHash: string;
  snapshotSha256: string;
}

export type DocumentPromotionDecision =
  | { kind: 'create' }
  | { kind: 'existing' }
  | {
      kind: 'error';
      error: 'promotion-not-found' | 'replay-detected' | 'owner-mismatch' | 'promotion-conflict';
    };

export const decideDocumentPromotion = (
  input: {
    ownerPrincipalId: string;
    idempotencyHash: string;
    snapshotSha256: string;
    requestId: string;
    createIfMissing: boolean;
  },
  existing: ExistingDocumentPromotion | null,
  requestIdExists: boolean,
): DocumentPromotionDecision => {
  if (requestIdExists) return { kind: 'error', error: 'replay-detected' };
  if (!existing) {
    return input.createIfMissing
      ? { kind: 'create' }
      : { kind: 'error', error: 'promotion-not-found' };
  }
  if (existing.ownerPrincipalId !== input.ownerPrincipalId) {
    return { kind: 'error', error: 'owner-mismatch' };
  }
  if (
    existing.idempotencyHash !== input.idempotencyHash ||
    existing.snapshotSha256 !== input.snapshotSha256
  ) {
    return { kind: 'error', error: 'promotion-conflict' };
  }
  return { kind: 'existing' };
};

export interface StoredDocumentPromotionV1 extends ExistingDocumentPromotion {
  roomId: string;
  title: string;
  bodyCanonicalJson: string;
  bodySha256: string;
  initialUpdate: string;
  initialUpdateSha256: string;
  aclVersion: 1;
  publicPolicy: 'restricted';
  publicPolicyVersion: 1;
  adjunctComments: 0;
  adjunctSuggestions: 0;
  shareable: boolean;
}

export interface DocumentPromotionStore {
  transaction<T>(callback: () => T): T;
  readPromotion(): StoredDocumentPromotionV1 | null;
  hasPromotionState(): boolean;
  hasManagementRequest(requestId: string): boolean;
  createPromotion(record: StoredDocumentPromotionV1, createdAt: string): void;
  markPromotionShareable(): void;
  recordSuccessfulRequest(input: {
    requestId: string;
    bodySha256: string;
    ownerPrincipalId: string;
    createdAt: string;
  }): void;
}

export type ExecuteDocumentPromotionResult =
  | {
      ok: true;
      version: 1;
      roomId: string;
      ownerPrincipalId: string;
      aclVersion: 1;
      publicPolicy: 'restricted';
      publicPolicyVersion: 1;
      snapshotSha256: string;
      created: boolean;
    }
  | {
      ok: false;
      version: 1;
      error:
        | 'promotion-disabled'
        | 'invalid-request'
        | 'unauthorized'
        | 'promotion-not-found'
        | 'replay-detected'
        | 'owner-mismatch'
        | 'promotion-conflict';
      retryable: false;
    }
  | {
      ok: false;
      version: 1;
      error: 'readback-failed' | 'internal-error';
      retryable: true;
    };

class PromotionReadbackError extends Error {}

const exactStoredPromotion = (
  actual: StoredDocumentPromotionV1 | null,
  expected: StoredDocumentPromotionV1,
  shareable: boolean,
) =>
  actual !== null &&
  actual.roomId === expected.roomId &&
  actual.ownerPrincipalId === expected.ownerPrincipalId &&
  actual.idempotencyHash === expected.idempotencyHash &&
  actual.title === expected.title &&
  actual.bodyCanonicalJson === expected.bodyCanonicalJson &&
  actual.bodySha256 === expected.bodySha256 &&
  actual.initialUpdate === expected.initialUpdate &&
  actual.initialUpdateSha256 === expected.initialUpdateSha256 &&
  actual.snapshotSha256 === expected.snapshotSha256 &&
  actual.aclVersion === 1 &&
  actual.publicPolicy === 'restricted' &&
  actual.publicPolicyVersion === 1 &&
  actual.adjunctComments === 0 &&
  actual.adjunctSuggestions === 0 &&
  actual.shareable === shareable;

export const executeDocumentPromotion = (
  store: DocumentPromotionStore,
  input: {
    request: ValidatedDocumentPromotionRequestV1;
    requestId: string;
    bodySha256: string;
    createdAt: string;
  },
): ExecuteDocumentPromotionResult => {
  try {
    return store.transaction(() => {
      const existing = store.readPromotion();
      if (!existing && store.hasPromotionState()) {
        return {
          ok: false,
          version: 1,
          error: 'promotion-conflict',
          retryable: false,
        };
      }
      const decision = decideDocumentPromotion(
        {
          ownerPrincipalId: input.request.ownerPrincipalId,
          idempotencyHash: input.request.idempotencyHash,
          snapshotSha256: input.request.snapshot.snapshotSha256,
          requestId: input.requestId,
          createIfMissing: input.request.createIfMissing,
        },
        existing,
        store.hasManagementRequest(input.requestId),
      );
      if (decision.kind === 'error') {
        return { ok: false, version: 1, error: decision.error, retryable: false };
      }

      const expected: StoredDocumentPromotionV1 = {
        roomId: input.request.roomId,
        ownerPrincipalId: input.request.ownerPrincipalId,
        idempotencyHash: input.request.idempotencyHash,
        title: input.request.snapshot.title,
        bodyCanonicalJson: canonicalizePromotionJson(input.request.snapshot.body),
        bodySha256: input.request.snapshot.bodySha256,
        initialUpdate: input.request.snapshot.initialUpdate,
        initialUpdateSha256: input.request.snapshot.initialUpdateSha256,
        snapshotSha256: input.request.snapshot.snapshotSha256,
        aclVersion: 1,
        publicPolicy: 'restricted',
        publicPolicyVersion: 1,
        adjunctComments: 0,
        adjunctSuggestions: 0,
        shareable: true,
      };
      if (decision.kind === 'create') {
        store.createPromotion(expected, input.createdAt);
        if (!exactStoredPromotion(store.readPromotion(), expected, false)) {
          throw new PromotionReadbackError('promotion projection readback mismatch');
        }
        store.markPromotionShareable();
      }
      store.recordSuccessfulRequest({
        requestId: input.requestId,
        bodySha256: input.bodySha256,
        ownerPrincipalId: input.request.ownerPrincipalId,
        createdAt: input.createdAt,
      });
      if (!exactStoredPromotion(store.readPromotion(), expected, true)) {
        throw new PromotionReadbackError('promotion readback mismatch');
      }
      return {
        ok: true,
        version: 1,
        roomId: input.request.roomId,
        ownerPrincipalId: input.request.ownerPrincipalId,
        aclVersion: 1,
        publicPolicy: 'restricted',
        publicPolicyVersion: 1,
        snapshotSha256: input.request.snapshot.snapshotSha256,
        created: decision.kind === 'create',
      };
    });
  } catch (error) {
    return error instanceof PromotionReadbackError
      ? { ok: false, version: 1, error: 'readback-failed', retryable: true }
      : { ok: false, version: 1, error: 'internal-error', retryable: true };
  }
};
