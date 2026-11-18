import { parsePublicReadRoomAllowlist } from './publicControlAuth';

export const PUBLIC_COMMENT_ASSERTION_DOMAIN = 'lash-worker-public-comment:v1';
export const PUBLIC_COMMENT_LIST_AUDIENCE = 'public-comment-list-v1';
export const PUBLIC_COMMENT_CREATE_AUDIENCE = 'public-comment-create-v1';
export const PUBLIC_COMMENT_SERVICE = 'lash-web-bff-v1';
export const PUBLIC_COMMENT_MAX_TTL_SECONDS = 60;
export const PUBLIC_COMMENT_CLOCK_SKEW_SECONDS = 5;

const ROOM_ID = /^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u;
const ACCOUNT_PRINCIPAL = /^account:v1:[A-Za-z0-9_-]{43}$/u;
const BASE64URL_SHA256 = /^[A-Za-z0-9_-]{43}$/u;
const LOWERCASE_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface PublicCommentAuthEnvironment {
  LASH_PUBLIC_COMMENT_ACCESS_PHASE?: string;
  LASH_WORKER_PUBLIC_COMMENT_SECRET_CURRENT?: string;
  LASH_WORKER_PUBLIC_COMMENT_SECRET_PREVIOUS?: string;
  LASH_PUBLIC_COMMENT_ROOM_ALLOWLIST?: string;
  LASH_PUBLIC_READ_ROOM_ALLOWLIST?: string;
}

export type PublicCommentAssertionDecision =
  | {
      ok: true;
      requestId: string;
      principalId: string | null;
      bodySha256: string;
      expiresAt: number;
    }
  | { ok: false; error: 'public-comment-disabled' | 'unauthorized' };

const base64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
};

const sha256 = async (bytes: Uint8Array) =>
  base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))));

const sign = async (secret: string, canonical: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64Url(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical))),
  );
};

const constantTimeEqual = (left: string, right: string) => {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
};

const exactHeader = (request: Request, name: string) => {
  const value = request.headers.get(name);
  return value !== null && value.length > 0 && value.trim() === value && !value.includes(',')
    ? value
    : null;
};

const validSecret = (value: string | undefined): value is string =>
  typeof value === 'string' && new TextEncoder().encode(value).byteLength >= 32;

export const verifyPublicCommentAssertion = async (input: {
  request: Request;
  body: Uint8Array;
  environment: PublicCommentAuthEnvironment;
  expectedAction: 'list' | 'create';
  nowSeconds?: number;
}): Promise<PublicCommentAssertionDecision> => {
  const currentSecret = input.environment.LASH_WORKER_PUBLIC_COMMENT_SECRET_CURRENT;
  const previousSecret = input.environment.LASH_WORKER_PUBLIC_COMMENT_SECRET_PREVIOUS;
  const commentRooms = parsePublicReadRoomAllowlist(
    input.environment.LASH_PUBLIC_COMMENT_ROOM_ALLOWLIST,
  );
  const readRooms = parsePublicReadRoomAllowlist(input.environment.LASH_PUBLIC_READ_ROOM_ALLOWLIST);
  if (input.environment.LASH_PUBLIC_COMMENT_ACCESS_PHASE !== 'enabled') {
    return { ok: false, error: 'public-comment-disabled' };
  }
  if (
    !validSecret(currentSecret) ||
    (previousSecret !== undefined && !validSecret(previousSecret)) ||
    !commentRooms ||
    !readRooms ||
    [...commentRooms].some((roomId) => !readRooms.has(roomId))
  ) {
    return { ok: false, error: 'unauthorized' };
  }

  const url = new URL(input.request.url);
  const route =
    /^\/api\/public-comment-control\/documents\/(doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64})\/comments\/(list|create)$/u.exec(
      url.pathname,
    );
  if (
    input.request.method !== 'POST' ||
    !route ||
    route[2] !== input.expectedAction ||
    !ROOM_ID.test(route[1] ?? '') ||
    !commentRooms.has(route[1] ?? '') ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    return { ok: false, error: 'unauthorized' };
  }

  const authorization = exactHeader(input.request, 'authorization');
  const audience = exactHeader(input.request, 'x-lash-control-audience');
  const service = exactHeader(input.request, 'x-lash-control-service-id');
  const bodySha256 = exactHeader(input.request, 'x-lash-control-body-sha256');
  const requestId = exactHeader(input.request, 'x-lash-control-request-id');
  const expiresAtRaw = exactHeader(input.request, 'x-lash-control-expires-at');
  const principalOccurrence = input.request.headers.has('x-lash-control-principal-id');
  const principal = exactHeader(input.request, 'x-lash-control-principal-id');
  const expectedAudience =
    input.expectedAction === 'list' ? PUBLIC_COMMENT_LIST_AUDIENCE : PUBLIC_COMMENT_CREATE_AUDIENCE;
  const signature = authorization?.match(
    /^Lash-Public-Comment-Control v1:([A-Za-z0-9_-]{43})$/u,
  )?.[1];
  if (
    !signature ||
    audience !== expectedAudience ||
    service !== PUBLIC_COMMENT_SERVICE ||
    !bodySha256 ||
    !BASE64URL_SHA256.test(bodySha256) ||
    !requestId ||
    !LOWERCASE_UUID_V4.test(requestId) ||
    !expiresAtRaw ||
    !/^(?:0|[1-9][0-9]*)$/u.test(expiresAtRaw) ||
    (input.expectedAction === 'list'
      ? principalOccurrence
      : !principal || !ACCOUNT_PRINCIPAL.test(principal))
  ) {
    return { ok: false, error: 'unauthorized' };
  }
  const expiresAt = Number(expiresAtRaw);
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt < nowSeconds - PUBLIC_COMMENT_CLOCK_SKEW_SECONDS ||
    expiresAt > nowSeconds + PUBLIC_COMMENT_MAX_TTL_SECONDS
  ) {
    return { ok: false, error: 'unauthorized' };
  }
  const computedBodySha256 = await sha256(input.body);
  if (!constantTimeEqual(bodySha256, computedBodySha256)) {
    return { ok: false, error: 'unauthorized' };
  }
  const canonical = [
    PUBLIC_COMMENT_ASSERTION_DOMAIN,
    'POST',
    url.pathname,
    audience,
    service,
    principal ?? '-',
    computedBodySha256,
    requestId,
    expiresAtRaw,
  ].join('\n');
  const expected = await Promise.all(
    (previousSecret ? [currentSecret, previousSecret] : [currentSecret]).map((secret) =>
      sign(secret, canonical),
    ),
  );
  let verified = false;
  for (const candidate of expected) {
    verified = constantTimeEqual(signature, candidate) || verified;
  }
  return verified
    ? {
        ok: true,
        requestId,
        principalId: input.expectedAction === 'create' ? principal : null,
        bodySha256: computedBodySha256,
        expiresAt,
      }
    : { ok: false, error: 'unauthorized' };
};
