export const MANAGEMENT_ASSERTION_DOMAIN_V1 = 'lash-worker-control:v1';
export const MANAGEMENT_ASSERTION_DOMAIN_V2 = 'lash-worker-control:v2';
export const MANAGEMENT_ASSERTION_DOMAIN = MANAGEMENT_ASSERTION_DOMAIN_V1;
export const MANAGEMENT_MAX_TTL_SECONDS = 60;
export const MANAGEMENT_CLOCK_SKEW_SECONDS = 5;

const BASE64URL_SHA256 = /^[A-Za-z0-9_-]{43}$/u;
const ACCOUNT_PRINCIPAL = /^account:v1:[A-Za-z0-9_-]{43}$/u;
const LOWERCASE_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface ManagementAuthEnvironment {
  LASH_SHARE_PHASE?: string;
  LASH_WORKER_CONTROL_SECRET_CURRENT?: string;
  LASH_WORKER_CONTROL_SECRET_PREVIOUS?: string;
}

export type ManagementAuthDecision =
  | {
      ok: true;
      requestId: string;
      principalId: string;
      expiresAt: number;
      bodySha256: string;
    }
  | {
      ok: false;
      error: 'promotion-disabled' | 'unauthorized';
    };

const base64Url = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
};

const sha256 = async (bytes: Uint8Array) =>
  base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))));

const signHmac = async (secret: string, message: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64Url(
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
  if (value === null || value.length === 0 || value.trim() !== value || value.includes(',')) {
    return null;
  }
  return value;
};

const validSecret = (secret: string | undefined): secret is string =>
  typeof secret === 'string' && new TextEncoder().encode(secret).byteLength >= 32;

export const verifyManagementAssertion = async (input: {
  request: Request;
  body: Uint8Array;
  environment: ManagementAuthEnvironment;
  nowSeconds?: number;
}): Promise<ManagementAuthDecision> => {
  if (input.environment.LASH_SHARE_PHASE !== 'enabled') {
    return { ok: false, error: 'promotion-disabled' };
  }

  const currentSecret = input.environment.LASH_WORKER_CONTROL_SECRET_CURRENT;
  const previousSecret = input.environment.LASH_WORKER_CONTROL_SECRET_PREVIOUS;
  if (
    !validSecret(currentSecret) ||
    (previousSecret !== undefined && !validSecret(previousSecret))
  ) {
    return { ok: false, error: 'unauthorized' };
  }

  const url = new URL(input.request.url);
  const isV1Route = /^\/api\/management\/documents\/[^/]+\/promote$/u.test(url.pathname);
  const isV2Route =
    /^\/api\/management\/document-claims\/claim-v1-[0-9a-f]{64}\/(?:promote|owner-session|public-policy\/(?:read|update)|public-comments\/moderate)$/u.test(
      url.pathname,
    ) ||
    /^\/api\/management\/documents\/doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}\/named-edit\/(?:issue|list|revoke|session|recent)$/u.test(
      url.pathname,
    );
  if (input.request.method !== 'POST' || url.search.length !== 0 || (!isV1Route && !isV2Route)) {
    return { ok: false, error: 'unauthorized' };
  }

  const authorization = exactHeader(input.request, 'authorization');
  const requestId = exactHeader(input.request, 'x-lash-control-request-id');
  const principalId = exactHeader(input.request, 'x-lash-control-principal-id');
  const expiresAtRaw = exactHeader(input.request, 'x-lash-control-expires-at');
  const assertedBodySha256 = exactHeader(input.request, 'x-lash-control-body-sha256');
  const assertionVersion = isV2Route ? 2 : 1;
  const signatureMatch = authorization?.match(
    assertionVersion === 2
      ? /^Lash-Control v2:([A-Za-z0-9_-]{43})$/u
      : /^Lash-Control v1:([A-Za-z0-9_-]{43})$/u,
  );
  if (
    !signatureMatch ||
    !requestId ||
    !LOWERCASE_UUID_V4.test(requestId) ||
    !principalId ||
    !ACCOUNT_PRINCIPAL.test(principalId) ||
    !expiresAtRaw ||
    !/^(?:0|[1-9][0-9]*)$/u.test(expiresAtRaw) ||
    !assertedBodySha256 ||
    !BASE64URL_SHA256.test(assertedBodySha256)
  ) {
    return { ok: false, error: 'unauthorized' };
  }

  const expiresAt = Number(expiresAtRaw);
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt < nowSeconds - MANAGEMENT_CLOCK_SKEW_SECONDS ||
    expiresAt > nowSeconds + MANAGEMENT_MAX_TTL_SECONDS
  ) {
    return { ok: false, error: 'unauthorized' };
  }

  const computedBodySha256 = await sha256(input.body);
  if (!constantTimeEqual(assertedBodySha256, computedBodySha256)) {
    return { ok: false, error: 'unauthorized' };
  }

  const canonical = [
    assertionVersion === 2 ? MANAGEMENT_ASSERTION_DOMAIN_V2 : MANAGEMENT_ASSERTION_DOMAIN_V1,
    'POST',
    url.pathname,
    computedBodySha256,
    requestId,
    principalId,
    expiresAtRaw,
  ].join('\n');
  const secrets = previousSecret ? [currentSecret, previousSecret] : [currentSecret];
  const expectedSignatures = await Promise.all(
    secrets.map((secret) => signHmac(secret, canonical)),
  );
  let verified = false;
  for (const expectedSignature of expectedSignatures) {
    verified = constantTimeEqual(signatureMatch[1], expectedSignature) || verified;
  }
  if (!verified) {
    return { ok: false, error: 'unauthorized' };
  }

  return {
    ok: true,
    requestId,
    principalId,
    expiresAt,
    bodySha256: computedBodySha256,
  };
};
