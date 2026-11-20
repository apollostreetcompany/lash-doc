import { createLashEditorExtensions, normalizeYProsemirrorProjectionJson } from '@lash/editor-core';
import {
  canonicalize,
  type DocumentClaimPromotionFailureV2,
  type DocumentPromotionSnapshotV1,
} from '@lash/types';
import { getSchema } from '@tiptap/core';
import { prosemirrorJSONToYDoc, yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';

import { writeRealtimeDocumentTitle } from '../realtimeCollaboration';

const LOCAL_DOCUMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;
const DOCUMENT_ROOM_ID = /^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u;
const BASE64URL_SHA256 = /^[A-Za-z0-9_-]{43}$/u;
const RESPONSE_BYTES_LIMIT = 16 * 1024;
const TITLE_BYTES_LIMIT = 4 * 1024;
const BODY_CANONICAL_BYTES_LIMIT = 1024 * 1024;
const INITIAL_UPDATE_BYTES_LIMIT = 1024 * 1024;
const REQUEST_BYTES_LIMIT = 2 * 1024 * 1024;
const IDEMPOTENCY_BYTES = 32;

export interface BrowserPromotionInput {
  localDocumentId: string;
  title: string;
  body: unknown;
  adjuncts: {
    comments: number;
    suggestions: number;
  };
}

export interface BrowserPromotionSubmitOptions {
  fetcher: typeof fetch;
  signal?: AbortSignal;
  beforeSend?: (snapshot: BrowserPromotionSnapshotProof) => Promise<boolean>;
}

export type BrowserPromotionSnapshotProof = Readonly<{
  localDocumentId: string;
  title: string;
  bodySha256: string;
  snapshotSha256: string;
}>;

export interface BrowserDocumentPromotionAttempt {
  submit(options: BrowserPromotionSubmitOptions): Promise<BrowserPromotionResult>;
}

export type BrowserPromotionRoom = Readonly<{
  roomId: string;
  aclVersion: 1;
  publicPolicy: 'restricted';
  publicPolicyVersion: 1;
  created: boolean;
}>;

export type BrowserPromotionReceipt = Readonly<{
  version: 1;
  title: string;
  body: unknown;
  snapshotSha256: string;
  room: BrowserPromotionRoom;
}>;

export type BrowserPromotionResult =
  | { ok: true; receipt: BrowserPromotionReceipt }
  | {
      ok: false;
      reason: 'adjuncts-present';
      retryable: false;
      adjuncts: Readonly<{ comments: number; suggestions: number }>;
    }
  | {
      ok: false;
      reason:
        | 'invalid-input'
        | 'aborted'
        | 'invalid-response'
        | 'snapshot-mismatch'
        | 'device-draft-unverified'
        | 'cryptography-unavailable';
      retryable: false;
    }
  | {
      ok: false;
      reason: 'network-error';
      retryable: true;
    }
  | ({
      ok: false;
      reason: 'server-rejected';
      status: number;
    } & (
      | {
          error: Extract<DocumentClaimPromotionFailureV2, { retryable: false }>['error'];
          retryable: false;
        }
      | {
          error: Extract<DocumentClaimPromotionFailureV2, { retryable: true }>['error'];
          retryable: true;
        }
    ));

type SanitizedPromotionSuccess = {
  ok: true;
  version: 2;
  roomId: string;
  aclVersion: 1;
  publicPolicy: 'restricted';
  publicPolicyVersion: 1;
  snapshotSha256: string;
  created: boolean;
};

type SanitizedPromotionFailure = DocumentClaimPromotionFailureV2;
type SanitizedPromotionResponse = SanitizedPromotionSuccess | SanitizedPromotionFailure;

const textEncoder = new TextEncoder();

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
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

const encodeStandardBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    const chunk = bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const encodeBase64Url = (bytes: Uint8Array) =>
  encodeStandardBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');

export const hashPromotionBytes = async (
  value: string | Uint8Array,
  cryptoImpl: Pick<Crypto, 'getRandomValues' | 'subtle'>,
) => {
  const bytes = typeof value === 'string' ? textEncoder.encode(value) : Uint8Array.from(value);
  const digest = await cryptoImpl.subtle.digest('SHA-256', bytes);
  return encodeBase64Url(new Uint8Array(digest));
};

const deepFreezeJson = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    for (const child of value) deepFreezeJson(child);
    return Object.freeze(value);
  }
  if (isPlainObject(value)) {
    for (const child of Object.values(value)) deepFreezeJson(child);
    return Object.freeze(value);
  }
  return value;
};

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isAbortError = (error: unknown) =>
  error instanceof DOMException
    ? error.name === 'AbortError'
    : isPlainObject(error) && error.name === 'AbortError';

const terminalStatuses: Record<
  Extract<DocumentClaimPromotionFailureV2, { retryable: false }>['error'],
  readonly number[]
> = {
  'promotion-disabled': [503],
  'invalid-request': [400, 403],
  unauthorized: [401],
  'upgrade-required': [400],
  'replay-detected': [409],
  'promotion-not-found': [404],
  'owner-mismatch': [409],
  'promotion-conflict': [409],
  'claim-conflict': [409],
};

const retryableErrors = new Set<DocumentClaimPromotionFailureV2['error']>([
  'readback-failed',
  'internal-error',
]);

const parseSanitizedResponse = (
  value: unknown,
  status: number,
): SanitizedPromotionResponse | null => {
  if (!isPlainObject(value) || value.version !== 2 || typeof value.ok !== 'boolean') return null;
  if (value.ok) {
    if (
      status !== 200 ||
      !hasExactKeys(value, [
        'ok',
        'version',
        'roomId',
        'aclVersion',
        'publicPolicy',
        'publicPolicyVersion',
        'snapshotSha256',
        'created',
      ]) ||
      typeof value.roomId !== 'string' ||
      !DOCUMENT_ROOM_ID.test(value.roomId) ||
      value.aclVersion !== 1 ||
      value.publicPolicy !== 'restricted' ||
      value.publicPolicyVersion !== 1 ||
      typeof value.snapshotSha256 !== 'string' ||
      !BASE64URL_SHA256.test(value.snapshotSha256) ||
      typeof value.created !== 'boolean'
    ) {
      return null;
    }
    return value as SanitizedPromotionSuccess;
  }
  if (
    !hasExactKeys(value, ['ok', 'version', 'error', 'retryable']) ||
    typeof value.error !== 'string' ||
    typeof value.retryable !== 'boolean'
  ) {
    return null;
  }
  if (value.retryable) {
    if (status !== 503 || !retryableErrors.has(value.error as never)) return null;
  } else {
    const statuses =
      terminalStatuses[
        value.error as Extract<DocumentClaimPromotionFailureV2, { retryable: false }>['error']
      ];
    if (!statuses?.includes(status)) return null;
  }
  return value as SanitizedPromotionFailure;
};

const invalidInput = (): BrowserPromotionResult => ({
  ok: false,
  reason: 'invalid-input',
  retryable: false,
});

const readBoundedResponseBody = async (response: Response) => {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > RESPONSE_BYTES_LIMIT) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
};

type PreparedBrowserPromotion = BrowserPromotionSnapshotProof & {
  canonicalBody: string;
  requestBody: string;
};

type BrowserPromotionFailure = Exclude<BrowserPromotionResult, { ok: true }>;

const preparationFailure = (result: BrowserPromotionFailure) => ({
  ok: false as const,
  result,
});

const prepareBrowserDocumentPromotion = async (
  input: BrowserPromotionInput,
  cryptoImpl: Pick<Crypto, 'getRandomValues' | 'subtle'>,
): Promise<
  { ok: true; prepared: PreparedBrowserPromotion } | { ok: false; result: BrowserPromotionFailure }
> => {
  const localDocumentId = input.localDocumentId;
  const title = input.title;
  const body = input.body;
  const comments = input.adjuncts?.comments;
  const suggestions = input.adjuncts?.suggestions;

  if (!isNonNegativeInteger(comments) || !isNonNegativeInteger(suggestions)) {
    return preparationFailure(invalidInput() as BrowserPromotionFailure);
  }
  if (comments !== 0 || suggestions !== 0) {
    return preparationFailure({
      ok: false,
      reason: 'adjuncts-present',
      retryable: false,
      adjuncts: Object.freeze({ comments, suggestions }),
    });
  }
  if (
    typeof localDocumentId !== 'string' ||
    localDocumentId.normalize('NFC') !== localDocumentId ||
    !LOCAL_DOCUMENT_ID.test(localDocumentId) ||
    typeof title !== 'string' ||
    title.normalize('NFC') !== title ||
    textEncoder.encode(title).byteLength > TITLE_BYTES_LIMIT
  ) {
    return preparationFailure(invalidInput() as BrowserPromotionFailure);
  }

  let canonicalBody: string;
  let canonicalBodyValue: unknown;
  let promotionDoc: Y.Doc;
  try {
    canonicalBody = canonicalize(body);
    if (textEncoder.encode(canonicalBody).byteLength > BODY_CANONICAL_BYTES_LIMIT) {
      return preparationFailure(invalidInput() as BrowserPromotionFailure);
    }
    canonicalBodyValue = JSON.parse(canonicalBody) as unknown;
    const schema = getSchema(createLashEditorExtensions());
    const projectedBody = schema.nodeFromJSON(canonicalBodyValue).toJSON();
    if (canonicalize(projectedBody) !== canonicalBody) {
      return preparationFailure(invalidInput() as BrowserPromotionFailure);
    }
    promotionDoc = prosemirrorJSONToYDoc(schema, canonicalBodyValue, 'content');
    writeRealtimeDocumentTitle(promotionDoc, title);
    if (
      canonicalize(
        normalizeYProsemirrorProjectionJson(
          yXmlFragmentToProsemirrorJSON(promotionDoc.getXmlFragment('content')),
        ),
      ) !== canonicalBody
    ) {
      promotionDoc.destroy();
      return preparationFailure(invalidInput() as BrowserPromotionFailure);
    }
  } catch {
    return preparationFailure(invalidInput() as BrowserPromotionFailure);
  }

  const initialUpdateBytes = Y.encodeStateAsUpdate(promotionDoc);
  promotionDoc.destroy();
  if (initialUpdateBytes.byteLength > INITIAL_UPDATE_BYTES_LIMIT) {
    return preparationFailure(invalidInput() as BrowserPromotionFailure);
  }
  const initialUpdate = encodeStandardBase64(initialUpdateBytes);

  let idempotencyKey: string;
  let bodySha256: string;
  let initialUpdateSha256: string;
  let snapshotSha256: string;
  try {
    const idempotencyBytes = new Uint8Array(IDEMPOTENCY_BYTES);
    cryptoImpl.getRandomValues(idempotencyBytes);
    idempotencyKey = encodeBase64Url(idempotencyBytes);
    bodySha256 = await hashPromotionBytes(canonicalBody, cryptoImpl);
    initialUpdateSha256 = await hashPromotionBytes(initialUpdateBytes, cryptoImpl);
    snapshotSha256 = await hashPromotionBytes(
      canonicalize({
        version: 1,
        title,
        bodySha256,
        initialUpdateSha256,
        adjuncts: { comments: 0, suggestions: 0 },
      }),
      cryptoImpl,
    );
  } catch {
    return preparationFailure({
      ok: false,
      reason: 'cryptography-unavailable',
      retryable: false,
    });
  }

  const snapshot: DocumentPromotionSnapshotV1 = {
    version: 1,
    title,
    body: canonicalBodyValue,
    bodySha256,
    initialUpdate,
    initialUpdateSha256,
    adjuncts: { comments: 0, suggestions: 0 },
    snapshotSha256,
  };
  const requestBody = JSON.stringify({
    version: 1,
    idempotencyKey,
    snapshot,
  });
  if (textEncoder.encode(requestBody).byteLength > REQUEST_BYTES_LIMIT) {
    return preparationFailure(invalidInput() as BrowserPromotionFailure);
  }

  return {
    ok: true,
    prepared: {
      localDocumentId,
      title,
      canonicalBody,
      requestBody,
      bodySha256,
      snapshotSha256,
    },
  };
};

const submitPreparedBrowserPromotion = async (
  prepared: PreparedBrowserPromotion,
  options: BrowserPromotionSubmitOptions,
): Promise<BrowserPromotionResult> => {
  const { signal } = options;
  if (signal?.aborted) return { ok: false, reason: 'aborted', retryable: false };
  if (options.beforeSend) {
    const { localDocumentId, title, bodySha256, snapshotSha256 } = prepared;
    let recorded = false;
    try {
      recorded = await options.beforeSend({ localDocumentId, title, bodySha256, snapshotSha256 });
    } catch {
      // An unverifiable recovery record stops the request before account storage changes.
    }
    if (signal?.aborted) return { ok: false, reason: 'aborted', retryable: false };
    if (!recorded) return { ok: false, reason: 'device-draft-unverified', retryable: false };
  }

  let response: Response;
  let rawResponse: string;
  try {
    const { fetcher } = options;
    response = await fetcher(`/api/documents/${prepared.localDocumentId}/promote`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: prepared.requestBody,
      signal,
    });
    if (signal?.aborted) return { ok: false, reason: 'aborted', retryable: false };
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
    const declaredLength = response.headers.get('content-length');
    if (
      contentType !== 'application/json' ||
      (declaredLength !== null &&
        (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) ||
          Number(declaredLength) > RESPONSE_BYTES_LIMIT))
    ) {
      return { ok: false, reason: 'invalid-response', retryable: false };
    }
    const boundedBody = await readBoundedResponseBody(response);
    if (boundedBody === null) {
      return { ok: false, reason: 'invalid-response', retryable: false };
    }
    rawResponse = boundedBody;
  } catch (error) {
    return signal?.aborted || isAbortError(error)
      ? { ok: false, reason: 'aborted', retryable: false }
      : { ok: false, reason: 'network-error', retryable: true };
  }
  if (signal?.aborted) return { ok: false, reason: 'aborted', retryable: false };

  let parsedValue: unknown;
  try {
    parsedValue = parseJsonWithoutDuplicateKeys(rawResponse);
  } catch {
    return { ok: false, reason: 'invalid-response', retryable: false };
  }
  const parsed = parseSanitizedResponse(parsedValue, response.status);
  if (!parsed) return { ok: false, reason: 'invalid-response', retryable: false };
  if (!parsed.ok) {
    return parsed.retryable
      ? {
          ok: false,
          reason: 'server-rejected',
          error: parsed.error,
          status: response.status,
          retryable: true,
        }
      : {
          ok: false,
          reason: 'server-rejected',
          error: parsed.error,
          status: response.status,
          retryable: false,
        };
  }
  if (parsed.snapshotSha256 !== prepared.snapshotSha256) {
    return { ok: false, reason: 'snapshot-mismatch', retryable: false };
  }

  const receiptBody = deepFreezeJson(JSON.parse(prepared.canonicalBody) as unknown);
  const room = Object.freeze({
    roomId: parsed.roomId,
    aclVersion: parsed.aclVersion,
    publicPolicy: parsed.publicPolicy,
    publicPolicyVersion: parsed.publicPolicyVersion,
    created: parsed.created,
  });
  const receipt = Object.freeze({
    version: 1 as const,
    title: prepared.title,
    body: receiptBody,
    snapshotSha256: prepared.snapshotSha256,
    room,
  });
  return { ok: true, receipt };
};

/**
 * Freezes one exact local snapshot and a closure-private idempotency key.
 * The browser controller records the verified source before dispatch. After
 * dispatch it reconciles account access through the owner-session route.
 */
export const createBrowserDocumentPromotionAttempt = (
  input: BrowserPromotionInput,
  cryptoImpl: Pick<Crypto, 'getRandomValues' | 'subtle'>,
): BrowserDocumentPromotionAttempt => {
  const prepared = prepareBrowserDocumentPromotion(input, cryptoImpl);
  const submit = async (
    options: BrowserPromotionSubmitOptions,
  ): Promise<BrowserPromotionResult> => {
    if (options.signal?.aborted) {
      return { ok: false, reason: 'aborted', retryable: false };
    }
    const decision = await prepared;
    if (options.signal?.aborted) {
      return { ok: false, reason: 'aborted', retryable: false };
    }
    return decision.ok
      ? submitPreparedBrowserPromotion(decision.prepared, options)
      : decision.result;
  };
  return Object.freeze({ submit });
};
