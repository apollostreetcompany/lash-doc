import { canonicalize, type DocumentPromotionSnapshotV1 } from '@lash/types';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';

export const PROMOTION_LIMITS = {
  requestBytes: 2 * 1024 * 1024,
  titleBytes: 4 * 1024,
  bodyCanonicalBytes: 1024 * 1024,
  initialUpdateBytes: 1024 * 1024,
} as const;

const LOCAL_DOCUMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const BASE64URL_SHA256 = /^[A-Za-z0-9_-]{43}$/u;
const STANDARD_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

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

const sha256Base64Url = (bytes: string | Uint8Array) =>
  createHash('sha256').update(bytes).digest('base64url');

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
      if (character === '\\') {
        offset += 2;
      } else {
        offset += 1;
      }
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
    const remainder = raw.slice(offset);
    const token = remainder.match(
      /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/u,
    )?.[0];
    if (!token) throw new Error('value expected');
    offset += token.length;
  };

  parseValue();
  whitespace();
  if (offset !== raw.length) throw new Error('trailing input');
  return JSON.parse(raw) as unknown;
};

const decodeCanonicalBase64Url = (value: string, minimum: number, maximum: number) => {
  if (!BASE64URL.test(value)) return null;
  const decoded = Buffer.from(value, 'base64url');
  if (
    decoded.toString('base64url') !== value ||
    decoded.byteLength < minimum ||
    decoded.byteLength > maximum
  ) {
    return null;
  }
  return decoded;
};

const decodeCanonicalStandardBase64 = (value: string) => {
  if (!value || !STANDARD_BASE64.test(value)) return null;
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) return null;
  return decoded;
};

const isProseMirrorDocument = (body: unknown) =>
  isPlainObject(body) &&
  body.type === 'doc' &&
  (body.content === undefined || Array.isArray(body.content));

export const parseCanonicalLocalDocumentId = (value: string) => {
  if (value.normalize('NFC') !== value || !LOCAL_DOCUMENT_ID.test(value)) {
    throw new Error('invalid local document id');
  }
  return value;
};

export type BrowserPromotionRequestDecision =
  | {
      ok: true;
      idempotencyKey: Buffer;
      snapshot: DocumentPromotionSnapshotV1;
    }
  | { ok: false; error: 'invalid-request' };

export const parseBrowserPromotionRequest = async (
  raw: string,
): Promise<BrowserPromotionRequestDecision> => {
  if (Buffer.byteLength(raw, 'utf8') > PROMOTION_LIMITS.requestBytes) {
    return { ok: false, error: 'invalid-request' };
  }

  let value: unknown;
  try {
    value = parseJsonWithoutDuplicateKeys(raw);
  } catch {
    return { ok: false, error: 'invalid-request' };
  }
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ['version', 'idempotencyKey', 'snapshot']) ||
    value.version !== 1 ||
    typeof value.idempotencyKey !== 'string' ||
    !isPlainObject(value.snapshot)
  ) {
    return { ok: false, error: 'invalid-request' };
  }

  const idempotencyKey = decodeCanonicalBase64Url(value.idempotencyKey, 16, 64);
  const snapshot = value.snapshot;
  if (
    !idempotencyKey ||
    !hasExactKeys(snapshot, [
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
    Buffer.byteLength(snapshot.title, 'utf8') > PROMOTION_LIMITS.titleBytes ||
    !isProseMirrorDocument(snapshot.body) ||
    typeof snapshot.bodySha256 !== 'string' ||
    !BASE64URL_SHA256.test(snapshot.bodySha256) ||
    typeof snapshot.initialUpdate !== 'string' ||
    typeof snapshot.initialUpdateSha256 !== 'string' ||
    !BASE64URL_SHA256.test(snapshot.initialUpdateSha256) ||
    !isPlainObject(snapshot.adjuncts) ||
    !hasExactKeys(snapshot.adjuncts, ['comments', 'suggestions']) ||
    snapshot.adjuncts.comments !== 0 ||
    snapshot.adjuncts.suggestions !== 0 ||
    typeof snapshot.snapshotSha256 !== 'string' ||
    !BASE64URL_SHA256.test(snapshot.snapshotSha256)
  ) {
    return { ok: false, error: 'invalid-request' };
  }

  let canonicalBody: string;
  try {
    canonicalBody = canonicalize(snapshot.body);
  } catch {
    return { ok: false, error: 'invalid-request' };
  }
  if (Buffer.byteLength(canonicalBody, 'utf8') > PROMOTION_LIMITS.bodyCanonicalBytes) {
    return { ok: false, error: 'invalid-request' };
  }

  const initialUpdate = decodeCanonicalStandardBase64(snapshot.initialUpdate);
  if (!initialUpdate || initialUpdate.byteLength > PROMOTION_LIMITS.initialUpdateBytes) {
    return { ok: false, error: 'invalid-request' };
  }
  try {
    Y.decodeUpdate(initialUpdate);
  } catch {
    return { ok: false, error: 'invalid-request' };
  }

  const bodySha256 = sha256Base64Url(canonicalBody);
  const initialUpdateSha256 = sha256Base64Url(initialUpdate);
  const snapshotSha256 = sha256Base64Url(
    canonicalize({
      version: 1,
      title: snapshot.title,
      bodySha256,
      initialUpdateSha256,
      adjuncts: { comments: 0, suggestions: 0 },
    }),
  );
  if (
    snapshot.bodySha256 !== bodySha256 ||
    snapshot.initialUpdateSha256 !== initialUpdateSha256 ||
    snapshot.snapshotSha256 !== snapshotSha256
  ) {
    return { ok: false, error: 'invalid-request' };
  }

  return {
    ok: true,
    idempotencyKey,
    snapshot: {
      version: 1,
      title: snapshot.title,
      body: JSON.parse(canonicalBody) as unknown,
      bodySha256,
      initialUpdate: snapshot.initialUpdate,
      initialUpdateSha256,
      adjuncts: { comments: 0, suggestions: 0 },
      snapshotSha256,
    },
  };
};
