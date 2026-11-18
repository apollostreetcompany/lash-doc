import { describe, expect, it } from 'vitest';

import {
  MANAGEMENT_ASSERTION_DOMAIN,
  MANAGEMENT_ASSERTION_DOMAIN_V2,
  verifyManagementAssertion,
  type ManagementAuthEnvironment,
} from '../../../realtime-worker/src/managementAuth';

const CURRENT_SECRET = 'current-control-secret-with-at-least-32-bytes';
const PREVIOUS_SECRET = 'previous-control-secret-with-at-least-32-bytes';
const NOW = 1_800_000_000;
const PATH = '/api/management/documents/room-alpha/promote';
const PRINCIPAL = `account:v1:${'a'.repeat(43)}`;
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const CLAIM_PATH =
  '/api/management/document-claims/claim-v1-9d05c49f61f58ffa69b8c098851879494c21aea1988e336055c1f646e9ad5543/promote';
const OWNER_SESSION_PATH =
  '/api/management/document-claims/claim-v1-9d05c49f61f58ffa69b8c098851879494c21aea1988e336055c1f646e9ad5543/owner-session';

const base64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
};

const sha256 = async (bytes: Uint8Array) =>
  base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))));

const hmac = async (secret: string, value: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64Url(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))),
  );
};

const signedRequest = async ({
  body = new TextEncoder().encode('{"version":1}'),
  secret = CURRENT_SECRET,
  expiresAt = NOW + 30,
  principal = PRINCIPAL,
  path = PATH,
  requestId = REQUEST_ID,
  url = `https://worker.test${PATH}`,
  method = 'POST',
}: {
  body?: Uint8Array;
  secret?: string;
  expiresAt?: number;
  principal?: string;
  path?: string;
  requestId?: string;
  url?: string;
  method?: string;
} = {}) => {
  const bodySha256 = await sha256(body);
  const canonical = [
    MANAGEMENT_ASSERTION_DOMAIN,
    'POST',
    path,
    bodySha256,
    requestId,
    principal,
    String(expiresAt),
  ].join('\n');
  const signature = await hmac(secret, canonical);
  return {
    body,
    request: new Request(url, {
      method,
      headers: {
        authorization: `Lash-Control v1:${signature}`,
        'x-lash-control-request-id': requestId,
        'x-lash-control-principal-id': principal,
        'x-lash-control-expires-at': String(expiresAt),
        'x-lash-control-body-sha256': bodySha256,
      },
    }),
  };
};

const environment = (
  overrides: Partial<ManagementAuthEnvironment> = {},
): ManagementAuthEnvironment => ({
  LASH_SHARE_PHASE: 'enabled',
  LASH_WORKER_CONTROL_SECRET_CURRENT: CURRENT_SECRET,
  LASH_WORKER_CONTROL_SECRET_PREVIOUS: PREVIOUS_SECRET,
  ...overrides,
});

describe('Worker management assertion', () => {
  it('binds Lash-Control v2 to the exact owner-session claim pathname', async () => {
    const body = new TextEncoder().encode('{"version":1}');
    const bodySha256 = await sha256(body);
    const expiresAt = NOW + 30;
    const canonical = [
      MANAGEMENT_ASSERTION_DOMAIN_V2,
      'POST',
      OWNER_SESSION_PATH,
      bodySha256,
      REQUEST_ID,
      PRINCIPAL,
      String(expiresAt),
    ].join('\n');
    const signature = await hmac(CURRENT_SECRET, canonical);
    await expect(
      verifyManagementAssertion({
        body,
        request: new Request(`https://worker.test${OWNER_SESSION_PATH}`, {
          method: 'POST',
          headers: {
            authorization: `Lash-Control v2:${signature}`,
            'x-lash-control-request-id': REQUEST_ID,
            'x-lash-control-principal-id': PRINCIPAL,
            'x-lash-control-expires-at': String(expiresAt),
            'x-lash-control-body-sha256': bodySha256,
          },
        }),
        environment: environment(),
        nowSeconds: NOW,
      }),
    ).resolves.toMatchObject({
      ok: true,
      principalId: PRINCIPAL,
      requestId: REQUEST_ID,
    });
  });

  it('accepts only Lash-Control v2 with the v2 domain on the exact claim route', async () => {
    const body = new TextEncoder().encode('{"version":2}');
    const bodySha256 = await sha256(body);
    const expiresAt = NOW + 30;
    const canonical = [
      MANAGEMENT_ASSERTION_DOMAIN_V2,
      'POST',
      CLAIM_PATH,
      bodySha256,
      REQUEST_ID,
      PRINCIPAL,
      String(expiresAt),
    ].join('\n');
    const signature = await hmac(CURRENT_SECRET, canonical);
    const headers = {
      authorization: `Lash-Control v2:${signature}`,
      'x-lash-control-request-id': REQUEST_ID,
      'x-lash-control-principal-id': PRINCIPAL,
      'x-lash-control-expires-at': String(expiresAt),
      'x-lash-control-body-sha256': bodySha256,
    };
    await expect(
      verifyManagementAssertion({
        body,
        request: new Request(`https://worker.test${CLAIM_PATH}`, {
          method: 'POST',
          headers,
        }),
        environment: environment(),
        nowSeconds: NOW,
      }),
    ).resolves.toMatchObject({
      ok: true,
      principalId: PRINCIPAL,
      requestId: REQUEST_ID,
    });

    await expect(
      verifyManagementAssertion({
        body,
        request: new Request(`https://worker.test${CLAIM_PATH}`, {
          method: 'POST',
          headers: { ...headers, authorization: `Lash-Control v1:${signature}` },
        }),
        environment: environment(),
        nowSeconds: NOW,
      }),
    ).resolves.toEqual({ ok: false, error: 'unauthorized' });
  });

  it('accepts the exact current or previous HMAC assertion and binds the raw body', async () => {
    for (const secret of [CURRENT_SECRET, PREVIOUS_SECRET]) {
      const input = await signedRequest({ secret });
      await expect(
        verifyManagementAssertion({
          ...input,
          environment: environment(),
          nowSeconds: NOW,
        }),
      ).resolves.toEqual({
        ok: true,
        bodySha256: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
        expiresAt: NOW + 30,
        principalId: PRINCIPAL,
        requestId: REQUEST_ID,
      });
    }

    const changed = await signedRequest();
    changed.body[0] ^= 1;
    await expect(
      verifyManagementAssertion({
        ...changed,
        environment: environment(),
        nowSeconds: NOW,
      }),
    ).resolves.toEqual({ ok: false, error: 'unauthorized' });
  });

  it('fails closed unless phase and control-secret configuration are exact', async () => {
    const input = await signedRequest();
    for (const [overrides, error] of [
      [{ LASH_SHARE_PHASE: undefined }, 'promotion-disabled'],
      [{ LASH_SHARE_PHASE: 'ENABLED' }, 'promotion-disabled'],
      [{ LASH_WORKER_CONTROL_SECRET_CURRENT: undefined }, 'unauthorized'],
      [{ LASH_WORKER_CONTROL_SECRET_CURRENT: 'short' }, 'unauthorized'],
      [{ LASH_WORKER_CONTROL_SECRET_PREVIOUS: 'short' }, 'unauthorized'],
    ] satisfies Array<
      [Partial<ManagementAuthEnvironment>, 'promotion-disabled' | 'unauthorized']
    >) {
      await expect(
        verifyManagementAssertion({
          ...input,
          environment: environment(overrides),
          nowSeconds: NOW,
        }),
      ).resolves.toEqual({ ok: false, error });
    }
  });

  it('binds exact POST, encoded pathname, no query, principal, request id, and expiry', async () => {
    const cases = [
      await signedRequest({ method: 'GET' }),
      await signedRequest({ url: `https://worker.test${PATH}?probe=1` }),
      await signedRequest({ path: `${PATH}/`, url: `https://worker.test${PATH}` }),
      await signedRequest({ principal: `account:v1:${'b'.repeat(42)}` }),
      await signedRequest({ requestId: '123E4567-E89B-42D3-A456-426614174000' }),
      await signedRequest({ expiresAt: NOW - 6 }),
      await signedRequest({ expiresAt: NOW + 61 }),
    ];
    for (const input of cases) {
      await expect(
        verifyManagementAssertion({
          ...input,
          environment: environment(),
          nowSeconds: NOW,
        }),
      ).resolves.toEqual({ ok: false, error: 'unauthorized' });
    }
  });

  it('rejects malformed, comma-joined, missing, and mismatched assertion headers', async () => {
    const signed = await signedRequest();
    for (const [name, value] of [
      ['authorization', 'Bearer nope'],
      ['authorization', `${signed.request.headers.get('authorization')}, other`],
      ['x-lash-control-request-id', `${REQUEST_ID}, ${REQUEST_ID}`],
      ['x-lash-control-principal-id', `${PRINCIPAL}, ${PRINCIPAL}`],
      ['x-lash-control-expires-at', `${NOW + 30}, ${NOW + 30}`],
      ['x-lash-control-body-sha256', 'x'.repeat(43)],
    ] as const) {
      const headers = new Headers(signed.request.headers);
      headers.set(name, value);
      const request = new Request(signed.request, { headers });
      await expect(
        verifyManagementAssertion({
          body: signed.body,
          request,
          environment: environment(),
          nowSeconds: NOW,
        }),
      ).resolves.toEqual({ ok: false, error: 'unauthorized' });
    }
  });
});
