import { describe, expect, it } from 'vitest';

import { sha256Base64Url } from '../../../realtime-worker/src/promotion';
import {
  PUBLIC_CONTROL_ASSERTION_AUDIENCE,
  PUBLIC_CONTROL_ASSERTION_DOMAIN,
  PUBLIC_CONTROL_ASSERTION_SERVICE,
  verifyPublicControlAssertion,
} from '../../../realtime-worker/src/publicControlAuth';

const SECRET = 'dedicated-public-control-secret-current-32-bytes';
const PREVIOUS_SECRET = 'dedicated-public-control-secret-previous-32-bytes';
const ROOM_ID = `doc-v1-${'a'.repeat(64)}`;
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const PATH = `/api/public-control/documents/${ROOM_ID}/session`;
const BODY = JSON.stringify({
  version: 1,
  roomId: ROOM_ID,
  actorId: 'public-reader',
  protocolVersion: 4,
  browserOrigin: 'https://lash.example',
  rateKey: `rate-v1-${'r'.repeat(43)}`,
});

const base64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
};

const sign = async (secret: string, value: string) => {
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

const signedRequest = async (
  secret = SECRET,
  changes: {
    authorizationPrefix?: string;
    path?: string;
    audience?: string;
    service?: string;
    principal?: string;
    expiresAt?: number;
  } = {},
) => {
  const body = new TextEncoder().encode(BODY);
  const bodySha256 = await sha256Base64Url(body);
  const expiresAt = changes.expiresAt ?? Math.floor(Date.now() / 1000) + 30;
  const path = changes.path ?? PATH;
  const audience = changes.audience ?? PUBLIC_CONTROL_ASSERTION_AUDIENCE;
  const service = changes.service ?? PUBLIC_CONTROL_ASSERTION_SERVICE;
  const signature = await sign(
    secret,
    [
      PUBLIC_CONTROL_ASSERTION_DOMAIN,
      'POST',
      path,
      audience,
      service,
      bodySha256,
      REQUEST_ID,
      String(expiresAt),
    ].join('\n'),
  );
  return {
    body,
    request: new Request(`https://worker.test${path}`, {
      method: 'POST',
      headers: {
        authorization: `${changes.authorizationPrefix ?? 'Lash-Public-Control v1'}:${signature}`,
        'content-type': 'application/json; charset=utf-8',
        'x-lash-control-audience': audience,
        'x-lash-control-service-id': service,
        'x-lash-control-body-sha256': bodySha256,
        'x-lash-control-request-id': REQUEST_ID,
        'x-lash-control-expires-at': String(expiresAt),
        ...(changes.principal ? { 'x-lash-control-principal-id': changes.principal } : {}),
      },
      body,
    }),
  };
};

describe('dedicated public-control authentication', () => {
  it('accepts only the exact public assertion and returns signed request bindings', async () => {
    const input = await signedRequest();
    await expect(
      verifyPublicControlAssertion({
        ...input,
        environment: {
          LASH_SHARE_PHASE: 'disabled',
          LASH_PUBLIC_DOCUMENT_ACCESS_PHASE: 'enabled',
          LASH_WORKER_PUBLIC_CONTROL_SECRET_CURRENT: SECRET,
          LASH_PUBLIC_READ_ROOM_ALLOWLIST: ROOM_ID,
        },
      }),
    ).resolves.toEqual({
      ok: true,
      requestId: REQUEST_ID,
      bodySha256: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      expiresAt: expect.any(Number),
    });
  });

  it('supports current/previous rotation without accepting unrelated secrets', async () => {
    const previous = await signedRequest(PREVIOUS_SECRET);
    await expect(
      verifyPublicControlAssertion({
        ...previous,
        environment: {
          LASH_PUBLIC_DOCUMENT_ACCESS_PHASE: 'enabled',
          LASH_WORKER_PUBLIC_CONTROL_SECRET_CURRENT: SECRET,
          LASH_WORKER_PUBLIC_CONTROL_SECRET_PREVIOUS: PREVIOUS_SECRET,
          LASH_PUBLIC_READ_ROOM_ALLOWLIST: ROOM_ID,
        },
      }),
    ).resolves.toMatchObject({ ok: true });

    const unrelated = await signedRequest('unrelated-public-control-secret-over-32-bytes');
    await expect(
      verifyPublicControlAssertion({
        ...unrelated,
        environment: {
          LASH_PUBLIC_DOCUMENT_ACCESS_PHASE: 'enabled',
          LASH_WORKER_PUBLIC_CONTROL_SECRET_CURRENT: SECRET,
          LASH_WORKER_PUBLIC_CONTROL_SECRET_PREVIOUS: PREVIOUS_SECRET,
          LASH_PUBLIC_READ_ROOM_ALLOWLIST: ROOM_ID,
        },
      }),
    ).resolves.toEqual({ ok: false, error: 'unauthorized' });
  });

  it('rejects account-control signatures, principal headers, wrong audience/service/path, and queries', async () => {
    for (const changes of [
      { authorizationPrefix: 'Lash-Control v2' },
      { principal: `account:v1:${'a'.repeat(43)}` },
      { audience: 'owner-session-v1' },
      { service: 'other-bff-v1' },
      { path: `${PATH}/` },
      { path: `${PATH}?redirect=https://evil.example` },
    ]) {
      const input = await signedRequest(SECRET, changes);
      await expect(
        verifyPublicControlAssertion({
          ...input,
          environment: {
            LASH_PUBLIC_DOCUMENT_ACCESS_PHASE: 'enabled',
            LASH_WORKER_PUBLIC_CONTROL_SECRET_CURRENT: SECRET,
            LASH_PUBLIC_READ_ROOM_ALLOWLIST: ROOM_ID,
          },
        }),
      ).resolves.toEqual({ ok: false, error: 'unauthorized' });
    }
  });

  it('fails closed for missing phase/secrets, stale assertions, or body mismatch', async () => {
    const input = await signedRequest();
    for (const environment of [
      {},
      { LASH_PUBLIC_DOCUMENT_ACCESS_PHASE: 'enabled' },
      {
        LASH_PUBLIC_DOCUMENT_ACCESS_PHASE: 'disabled',
        LASH_WORKER_PUBLIC_CONTROL_SECRET_CURRENT: SECRET,
        LASH_PUBLIC_READ_ROOM_ALLOWLIST: ROOM_ID,
      },
      {
        LASH_PUBLIC_DOCUMENT_ACCESS_PHASE: 'enabled',
        LASH_WORKER_PUBLIC_CONTROL_SECRET_CURRENT: SECRET,
      },
      {
        LASH_PUBLIC_DOCUMENT_ACCESS_PHASE: 'enabled',
        LASH_WORKER_PUBLIC_CONTROL_SECRET_CURRENT: SECRET,
        LASH_PUBLIC_READ_ROOM_ALLOWLIST: `${ROOM_ID},`,
      },
      {
        LASH_PUBLIC_DOCUMENT_ACCESS_PHASE: 'enabled',
        LASH_WORKER_PUBLIC_CONTROL_SECRET_CURRENT: SECRET,
        LASH_PUBLIC_READ_ROOM_ALLOWLIST: `${ROOM_ID},${ROOM_ID}`,
      },
      {
        LASH_PUBLIC_DOCUMENT_ACCESS_PHASE: 'enabled',
        LASH_WORKER_PUBLIC_CONTROL_SECRET_CURRENT: SECRET,
        LASH_PUBLIC_READ_ROOM_ALLOWLIST: `doc-v1-${'b'.repeat(64)}`,
      },
    ]) {
      await expect(verifyPublicControlAssertion({ ...input, environment })).resolves.toEqual({
        ok: false,
        error: 'unauthorized',
      });
    }

    const stale = await signedRequest(SECRET, {
      expiresAt: Math.floor(Date.now() / 1000) - 10,
    });
    await expect(
      verifyPublicControlAssertion({
        ...stale,
        environment: {
          LASH_PUBLIC_DOCUMENT_ACCESS_PHASE: 'enabled',
          LASH_WORKER_PUBLIC_CONTROL_SECRET_CURRENT: SECRET,
          LASH_PUBLIC_READ_ROOM_ALLOWLIST: ROOM_ID,
        },
      }),
    ).resolves.toEqual({ ok: false, error: 'unauthorized' });

    await expect(
      verifyPublicControlAssertion({
        request: input.request,
        body: new TextEncoder().encode(`${BODY} `),
        environment: {
          LASH_PUBLIC_DOCUMENT_ACCESS_PHASE: 'enabled',
          LASH_WORKER_PUBLIC_CONTROL_SECRET_CURRENT: SECRET,
          LASH_PUBLIC_READ_ROOM_ALLOWLIST: ROOM_ID,
        },
      }),
    ).resolves.toEqual({ ok: false, error: 'unauthorized' });
  });
});
