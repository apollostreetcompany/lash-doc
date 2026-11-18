export const PUBLIC_CONTROL_ASSERTION_DOMAIN = 'lash-worker-public-session:v1';
export const PUBLIC_CONTROL_ASSERTION_AUDIENCE = 'public-read-session-v1';
export const PUBLIC_CONTROL_ASSERTION_SERVICE = 'lash-web-bff-v1';
export const PUBLIC_CONTROL_MAX_TTL_SECONDS = 60;
export const PUBLIC_CONTROL_CLOCK_SKEW_SECONDS = 5;
export const PUBLIC_READ_ROOM_ALLOWLIST_MAX_ROOMS = 100;
export const PUBLIC_READ_ROOM_ALLOWLIST_MAX_BYTES = 16_384;

const ROOM_ID = /^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u;
const BASE64URL_SHA256 = /^[A-Za-z0-9_-]{43}$/u;
const LOWERCASE_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface PublicControlAuthEnvironment {
  LASH_PUBLIC_DOCUMENT_ACCESS_PHASE?: string;
  LASH_WORKER_PUBLIC_CONTROL_SECRET_CURRENT?: string;
  LASH_WORKER_PUBLIC_CONTROL_SECRET_PREVIOUS?: string;
  LASH_PUBLIC_READ_ROOM_ALLOWLIST?: string;
}

export type PublicControlAuthDecision =
  | {
      ok: true;
      requestId: string;
      expiresAt: number;
      bodySha256: string;
    }
  | { ok: false; error: 'unauthorized' };

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
};

const sha256 = async (bytes: Uint8Array) =>
  bytesToBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))));

const sign = async (secret: string, message: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return bytesToBase64Url(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))),
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

export const parsePublicReadRoomAllowlist = (value: unknown): ReadonlySet<string> | null => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    new TextEncoder().encode(value).byteLength > PUBLIC_READ_ROOM_ALLOWLIST_MAX_BYTES
  ) {
    return null;
  }
  const rooms = value.split(',');
  const unique = new Set(rooms);
  return rooms.length <= PUBLIC_READ_ROOM_ALLOWLIST_MAX_ROOMS &&
    unique.size === rooms.length &&
    rooms.every((roomId) => ROOM_ID.test(roomId))
    ? unique
    : null;
};

export const verifyPublicControlAssertion = async (input: {
  request: Request;
  body: Uint8Array;
  environment: PublicControlAuthEnvironment;
  nowSeconds?: number;
}): Promise<PublicControlAuthDecision> => {
  const currentSecret = input.environment.LASH_WORKER_PUBLIC_CONTROL_SECRET_CURRENT;
  const previousSecret = input.environment.LASH_WORKER_PUBLIC_CONTROL_SECRET_PREVIOUS;
  const allowedRooms = parsePublicReadRoomAllowlist(
    input.environment.LASH_PUBLIC_READ_ROOM_ALLOWLIST,
  );
  if (
    input.environment.LASH_PUBLIC_DOCUMENT_ACCESS_PHASE !== 'enabled' ||
    !validSecret(currentSecret) ||
    (previousSecret !== undefined && !validSecret(previousSecret)) ||
    !allowedRooms
  ) {
    return { ok: false, error: 'unauthorized' };
  }

  const url = new URL(input.request.url);
  const route =
    /^\/api\/public-control\/documents\/(doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64})\/session$/u.exec(
      url.pathname,
    );
  if (
    input.request.method !== 'POST' ||
    !route ||
    !ROOM_ID.test(route[1] ?? '') ||
    !allowedRooms.has(route[1] ?? '') ||
    url.search !== '' ||
    url.hash !== '' ||
    input.request.headers.has('x-lash-control-principal-id')
  ) {
    return { ok: false, error: 'unauthorized' };
  }

  const authorization = exactHeader(input.request, 'authorization');
  const audience = exactHeader(input.request, 'x-lash-control-audience');
  const service = exactHeader(input.request, 'x-lash-control-service-id');
  const bodySha256 = exactHeader(input.request, 'x-lash-control-body-sha256');
  const requestId = exactHeader(input.request, 'x-lash-control-request-id');
  const expiresAtRaw = exactHeader(input.request, 'x-lash-control-expires-at');
  const signature = authorization?.match(/^Lash-Public-Control v1:([A-Za-z0-9_-]{43})$/u)?.[1];
  if (
    !signature ||
    audience !== PUBLIC_CONTROL_ASSERTION_AUDIENCE ||
    service !== PUBLIC_CONTROL_ASSERTION_SERVICE ||
    !bodySha256 ||
    !BASE64URL_SHA256.test(bodySha256) ||
    !requestId ||
    !LOWERCASE_UUID_V4.test(requestId) ||
    !expiresAtRaw ||
    !/^(?:0|[1-9][0-9]*)$/u.test(expiresAtRaw)
  ) {
    return { ok: false, error: 'unauthorized' };
  }

  const expiresAt = Number(expiresAtRaw);
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt < nowSeconds - PUBLIC_CONTROL_CLOCK_SKEW_SECONDS ||
    expiresAt > nowSeconds + PUBLIC_CONTROL_MAX_TTL_SECONDS
  ) {
    return { ok: false, error: 'unauthorized' };
  }
  const computedBodySha256 = await sha256(input.body);
  if (!constantTimeEqual(bodySha256, computedBodySha256)) {
    return { ok: false, error: 'unauthorized' };
  }

  const canonical = [
    PUBLIC_CONTROL_ASSERTION_DOMAIN,
    'POST',
    url.pathname,
    audience,
    service,
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
    ? { ok: true, requestId, expiresAt, bodySha256: computedBodySha256 }
    : { ok: false, error: 'unauthorized' };
};
