import { createHmac, randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto';

import { safeDocumentReturnPath } from './returnUrl';

export const AUTH_REQUEST_COOKIE_NAME = 'lash-auth-request';
export const AUTH_REQUEST_MAX_AGE_SECONDS = 10 * 60;

interface AuthRequestPayload {
  expiresAt: number;
  next: string;
  state: string;
  version: 1;
}

interface RequestStateDependencies {
  now?: Date;
  randomBytes?: (size: number) => Uint8Array;
}

interface CookieWriter {
  set(options: {
    expires?: Date;
    httpOnly: boolean;
    maxAge: number;
    name: string;
    path: string;
    sameSite: 'lax';
    secure: boolean;
    value: string;
  }): void;
}

const constantTimeTextEqual = (left: string, right: string) =>
  timingSafeEqual(
    createHmac('sha256', 'lash-auth-request-state-compare').update(left, 'utf8').digest(),
    createHmac('sha256', 'lash-auth-request-state-compare').update(right, 'utf8').digest(),
  );

const requirePrincipalKey = (principalKey: string) => {
  if (Buffer.byteLength(principalKey, 'utf8') < 32) {
    throw new TypeError('Auth request state requires the server principal key.');
  }
  return principalKey;
};

const deriveStateSigningKey = (principalKey: string) =>
  createHmac('sha256', requirePrincipalKey(principalKey))
    .update('lash-auth-request-state-subkey:v1\u0000', 'utf8')
    .digest();

const signPayload = (versionAndPayload: string, principalKey: string) =>
  createHmac('sha256', deriveStateSigningKey(principalKey))
    .update('lash-auth-request-state-cookie:v1\u0000', 'utf8')
    .update(versionAndPayload, 'utf8')
    .digest('base64url');

export function authRequestCookieOptions(siteOrigin: string) {
  const origin = new URL(siteOrigin);
  return {
    httpOnly: true as const,
    maxAge: AUTH_REQUEST_MAX_AGE_SECONDS,
    path: '/auth/confirm',
    sameSite: 'lax' as const,
    secure: origin.protocol === 'https:',
  };
}

export function createAuthRequestState(
  next: string,
  siteOrigin: string,
  principalKey: string,
  dependencies: RequestStateDependencies = {},
) {
  const documentPath = safeDocumentReturnPath(next, siteOrigin);
  if (!documentPath) throw new TypeError('Auth request state requires a safe document path.');
  const now = dependencies.now ?? new Date();
  const random = dependencies.randomBytes ?? nodeRandomBytes;
  const randomState = Buffer.from(random(32));
  if (randomState.byteLength !== 32) {
    throw new TypeError('Auth request state requires exactly 32 random bytes.');
  }
  const state = randomState.toString('base64url');
  const payload: AuthRequestPayload = {
    expiresAt: now.getTime() + AUTH_REQUEST_MAX_AGE_SECONDS * 1_000,
    next: documentPath,
    state,
    version: 1,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const versionAndPayload = `v1.${encodedPayload}`;
  return {
    cookieValue: `${versionAndPayload}.${signPayload(versionAndPayload, principalKey)}`,
    state,
  };
}

export function validateAuthRequestState(input: {
  cookieValue: string | null | undefined;
  next: string | null | undefined;
  now?: Date;
  principalKey: string;
  siteOrigin: string;
  state: string | null | undefined;
}): { status: 'valid'; documentPath: string } | { status: 'invalid'; documentPath: null } {
  if (!input.cookieValue || input.cookieValue.length > 4_096 || !input.next || !input.state) {
    return { status: 'invalid', documentPath: null };
  }

  const segments = input.cookieValue.split('.');
  if (segments.length !== 3) {
    return { status: 'invalid', documentPath: null };
  }
  const [version, encodedPayload, signature] = segments;
  if (!version || version !== 'v1' || !encodedPayload || !signature) {
    return { status: 'invalid', documentPath: null };
  }
  let expectedSignature: string;
  try {
    expectedSignature = signPayload(`${version}.${encodedPayload}`, input.principalKey);
  } catch {
    return { status: 'invalid', documentPath: null };
  }
  if (!constantTimeTextEqual(signature, expectedSignature)) {
    return { status: 'invalid', documentPath: null };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return { status: 'invalid', documentPath: null };
  }
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('version' in payload) ||
    payload.version !== 1 ||
    !('expiresAt' in payload) ||
    typeof payload.expiresAt !== 'number' ||
    !Number.isSafeInteger(payload.expiresAt) ||
    !('next' in payload) ||
    typeof payload.next !== 'string' ||
    !('state' in payload) ||
    typeof payload.state !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/u.test(payload.state)
  ) {
    return { status: 'invalid', documentPath: null };
  }
  const canonicalPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  if (!constantTimeTextEqual(encodedPayload, canonicalPayload)) {
    return { status: 'invalid', documentPath: null };
  }

  const now = (input.now ?? new Date()).getTime();
  const documentPath = safeDocumentReturnPath(input.next, input.siteOrigin);
  const storedPath = safeDocumentReturnPath(payload.next, input.siteOrigin);
  if (
    !documentPath ||
    !storedPath ||
    now > payload.expiresAt ||
    payload.expiresAt - now > AUTH_REQUEST_MAX_AGE_SECONDS * 1_000 ||
    !constantTimeTextEqual(payload.state, input.state) ||
    !constantTimeTextEqual(storedPath, documentPath)
  ) {
    return { status: 'invalid', documentPath: null };
  }
  return { status: 'valid', documentPath };
}

export function setAuthRequestCookie(
  cookies: CookieWriter,
  cookieValue: string,
  siteOrigin: string,
) {
  cookies.set({
    ...authRequestCookieOptions(siteOrigin),
    name: AUTH_REQUEST_COOKIE_NAME,
    value: cookieValue,
  });
}

export function clearAuthRequestCookie(cookies: CookieWriter, siteOrigin: string) {
  cookies.set({
    ...authRequestCookieOptions(siteOrigin),
    expires: new Date(0),
    maxAge: 0,
    name: AUTH_REQUEST_COOKIE_NAME,
    value: '',
  });
}
