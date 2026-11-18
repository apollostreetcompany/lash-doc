import { createHmac, randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto';

export const PUBLIC_COMMENT_CSRF_COOKIE_NAME = 'lash-public-comment-csrf-session';
export const PUBLIC_COMMENT_CSRF_MAX_AGE_SECONDS = 600;

const ACCOUNT_PRINCIPAL = /^account:v1:[A-Za-z0-9_-]{43}$/u;
const ROOM_ID = /^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u;
const BASE64URL_SHA256 = /^[A-Za-z0-9_-]{43}$/u;
const DECIMAL_SECONDS = /^(?:0|[1-9][0-9]*)$/u;
const CREATE_SCOPE = 'public-comment-create-v1';

interface CookieWriter {
  set(options: {
    expires?: Date;
    httpOnly: boolean;
    maxAge: number;
    name: string;
    path: string;
    sameSite: 'strict';
    secure: boolean;
    value: string;
  }): void;
}

const requirePrincipalKey = (principalKey: string) => {
  if (new TextEncoder().encode(principalKey).byteLength < 32) {
    throw new TypeError('Public comment CSRF requires the account principal key.');
  }
  return principalKey;
};

const csrfKey = (principalKey: string) =>
  createHmac('sha256', requirePrincipalKey(principalKey))
    .update('lash-public-comment-csrf-key:v1', 'utf8')
    .digest();

const aliasKey = (principalKey: string) =>
  createHmac('sha256', requirePrincipalKey(principalKey))
    .update('lash-public-comment-alias-key:v1', 'utf8')
    .digest();

const sign = (key: Uint8Array, canonical: string) =>
  createHmac('sha256', key).update(canonical, 'utf8').digest('base64url');

const safeEqual = (left: string, right: string) => {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
};

const requireNonce = (value: Uint8Array) => {
  const nonce = Buffer.from(value);
  if (nonce.byteLength !== 32) {
    throw new TypeError('Public comment CSRF requires exactly 32 random bytes per nonce.');
  }
  return nonce.toString('base64url');
};

const parseToken = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const segments = value.split('.');
  if (
    segments.length !== 4 ||
    segments[0] !== 'v1' ||
    !segments[1] ||
    !BASE64URL_SHA256.test(segments[1]) ||
    !segments[2] ||
    !DECIMAL_SECONDS.test(segments[2]) ||
    !segments[3] ||
    !BASE64URL_SHA256.test(segments[3])
  ) {
    return null;
  }
  const expiresAt = Number(segments[2]);
  return Number.isSafeInteger(expiresAt)
    ? { nonce: segments[1], expiresAt, mac: segments[3] }
    : null;
};

const requireBindings = (roomId: string, principalId: string) => {
  if (!ROOM_ID.test(roomId) || !ACCOUNT_PRINCIPAL.test(principalId)) {
    throw new TypeError('Public comment CSRF requires canonical room and account bindings.');
  }
};

export const createPublicCommentCsrfSession = (input: {
  principalId: string;
  roomId: string;
  principalKey: string;
  nowSeconds?: number;
  randomBytes?: (size: number) => Uint8Array;
}) => {
  requireBindings(input.roomId, input.principalId);
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1_000);
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw new TypeError('Public comment CSRF requires canonical time.');
  }
  const randomBytes = input.randomBytes ?? nodeRandomBytes;
  const sessionNonce = requireNonce(randomBytes(32));
  const proofNonce = requireNonce(randomBytes(32));
  if (safeEqual(sessionNonce, proofNonce)) {
    throw new TypeError('Public comment CSRF nonces must be independent.');
  }
  const expiresAt = nowSeconds + PUBLIC_COMMENT_CSRF_MAX_AGE_SECONDS;
  const key = csrfKey(input.principalKey);
  const cookieMac = sign(
    key,
    `lash-public-comment-csrf-session:v1\n${input.principalId}\n${sessionNonce}\n${expiresAt}`,
  );
  const proofMac = sign(
    key,
    `lash-public-comment-csrf-proof:v1\n${CREATE_SCOPE}\n${input.roomId}\n${input.principalId}\n${sessionNonce}\n${proofNonce}\n${expiresAt}`,
  );
  return Object.freeze({
    cookieValue: `v1.${sessionNonce}.${expiresAt}.${cookieMac}`,
    csrfProof: `v1.${proofNonce}.${expiresAt}.${proofMac}`,
    expiresAt: new Date(expiresAt * 1_000).toISOString(),
  });
};

export const verifyPublicCommentCsrf = (input: {
  cookieValue: unknown;
  csrfProof: unknown;
  principalId: string;
  roomId: string;
  principalKey: string;
  nowSeconds?: number;
  scope?: unknown;
}) => {
  if (input.scope !== undefined && input.scope !== CREATE_SCOPE) return false;
  try {
    requireBindings(input.roomId, input.principalId);
  } catch {
    return false;
  }
  const cookie = parseToken(input.cookieValue);
  const proof = parseToken(input.csrfProof);
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1_000);
  if (
    !cookie ||
    !proof ||
    cookie.expiresAt !== proof.expiresAt ||
    !Number.isSafeInteger(nowSeconds) ||
    nowSeconds < 0 ||
    nowSeconds > cookie.expiresAt ||
    cookie.expiresAt > nowSeconds + PUBLIC_COMMENT_CSRF_MAX_AGE_SECONDS
  ) {
    return false;
  }
  let key: Buffer;
  try {
    key = csrfKey(input.principalKey);
  } catch {
    return false;
  }
  const expectedCookieMac = sign(
    key,
    `lash-public-comment-csrf-session:v1\n${input.principalId}\n${cookie.nonce}\n${cookie.expiresAt}`,
  );
  const expectedProofMac = sign(
    key,
    `lash-public-comment-csrf-proof:v1\n${CREATE_SCOPE}\n${input.roomId}\n${input.principalId}\n${cookie.nonce}\n${proof.nonce}\n${proof.expiresAt}`,
  );
  return safeEqual(cookie.mac, expectedCookieMac) && safeEqual(proof.mac, expectedProofMac);
};

export const derivePublicCommentAlias = (
  principalKey: string,
  roomId: string,
  principalId: string,
) => {
  requireBindings(roomId, principalId);
  const digest = sign(
    aliasKey(principalKey),
    `lash-public-comment-alias:v1\n${roomId}\n${principalId}`,
  );
  return `Commenter ${digest.slice(0, 6)}`;
};

export const publicCommentCsrfCookieOptions = (siteOrigin: string) => {
  const origin = new URL(siteOrigin);
  return {
    httpOnly: true as const,
    maxAge: PUBLIC_COMMENT_CSRF_MAX_AGE_SECONDS,
    path: '/api/public/documents',
    sameSite: 'strict' as const,
    secure: origin.protocol === 'https:',
  };
};

export const setPublicCommentCsrfCookie = (
  cookies: CookieWriter,
  cookieValue: string,
  siteOrigin: string,
) => {
  cookies.set({
    ...publicCommentCsrfCookieOptions(siteOrigin),
    name: PUBLIC_COMMENT_CSRF_COOKIE_NAME,
    value: cookieValue,
  });
};

export const clearPublicCommentCsrfCookie = (cookies: CookieWriter, siteOrigin: string) => {
  cookies.set({
    ...publicCommentCsrfCookieOptions(siteOrigin),
    expires: new Date(0),
    maxAge: 0,
    name: PUBLIC_COMMENT_CSRF_COOKIE_NAME,
    value: '',
  });
};
