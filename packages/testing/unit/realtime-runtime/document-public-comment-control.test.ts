import { describe, expect, it } from 'vitest';

import {
  PUBLIC_COMMENT_ASSERTION_DOMAIN,
  PUBLIC_COMMENT_CREATE_AUDIENCE,
  PUBLIC_COMMENT_LIST_AUDIENCE,
  verifyPublicCommentAssertion,
} from '../../../realtime-worker/src/publicCommentAuth';

const ROOM_ID = `doc-v1-${'a'.repeat(64)}`;
const PRINCIPAL = `account:v1:${'p'.repeat(43)}`;
const SECRET = 'public-comment-current-secret-at-least-32-bytes';
const PREVIOUS = 'public-comment-previous-secret-at-least-32-bytes';
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';

const base64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
};

const signed = async (input: {
  action: 'list' | 'create';
  secret?: string;
  principal?: string | null;
  expiresAt?: number;
  body?: string;
}) => {
  const audience =
    input.action === 'list' ? PUBLIC_COMMENT_LIST_AUDIENCE : PUBLIC_COMMENT_CREATE_AUDIENCE;
  const path = `/api/public-comment-control/documents/${ROOM_ID}/comments/${input.action}`;
  const body = input.body ?? '{}';
  const bodySha256 = base64Url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))),
  );
  const expiresAt = input.expiresAt ?? 1_800_000_030;
  const canonical = [
    PUBLIC_COMMENT_ASSERTION_DOMAIN,
    'POST',
    path,
    audience,
    'lash-web-bff-v1',
    input.principal ?? '-',
    bodySha256,
    REQUEST_ID,
    String(expiresAt),
  ].join('\n');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(input.secret ?? SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = base64Url(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical))),
  );
  return {
    request: new Request(`https://worker.test${path}`, {
      method: 'POST',
      headers: {
        authorization: `Lash-Public-Comment-Control v1:${signature}`,
        'content-type': 'application/json',
        'x-lash-control-audience': audience,
        'x-lash-control-service-id': 'lash-web-bff-v1',
        'x-lash-control-body-sha256': bodySha256,
        'x-lash-control-request-id': REQUEST_ID,
        'x-lash-control-expires-at': String(expiresAt),
        ...(input.principal ? { 'x-lash-control-principal-id': input.principal } : {}),
      },
      body,
    }),
    body: new TextEncoder().encode(body),
  };
};

const environment = {
  LASH_PUBLIC_COMMENT_ACCESS_PHASE: 'enabled',
  LASH_WORKER_PUBLIC_COMMENT_SECRET_CURRENT: SECRET,
  LASH_WORKER_PUBLIC_COMMENT_SECRET_PREVIOUS: PREVIOUS,
  LASH_PUBLIC_COMMENT_ROOM_ALLOWLIST: ROOM_ID,
  LASH_PUBLIC_READ_ROOM_ALLOWLIST: ROOM_ID,
};

describe('public comment service assertion', () => {
  it('separates accountless list from principal-bound create and accepts rotation', async () => {
    for (const action of ['list', 'create'] as const) {
      const principal = action === 'create' ? PRINCIPAL : null;
      const request = await signed({ action, principal });
      await expect(
        verifyPublicCommentAssertion({
          ...request,
          environment,
          nowSeconds: 1_800_000_000,
          expectedAction: action,
        }),
      ).resolves.toMatchObject({ ok: true, principalId: principal });
    }
    const previous = await signed({ action: 'create', principal: PRINCIPAL, secret: PREVIOUS });
    await expect(
      verifyPublicCommentAssertion({
        ...previous,
        environment,
        nowSeconds: 1_800_000_000,
        expectedAction: 'create',
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it('rejects audience confusion, principal confusion, expiry, body/path changes, and phase coupling', async () => {
    const list = await signed({ action: 'list', principal: PRINCIPAL });
    const create = await signed({ action: 'create', principal: null });
    const expired = await signed({
      action: 'create',
      principal: PRINCIPAL,
      expiresAt: 1_799_999_990,
    });
    for (const [value, action] of [
      [list, 'list'],
      [create, 'create'],
      [expired, 'create'],
    ] as const) {
      await expect(
        verifyPublicCommentAssertion({
          ...value,
          environment,
          nowSeconds: 1_800_000_000,
          expectedAction: action,
        }),
      ).resolves.toEqual({ ok: false, error: 'unauthorized' });
    }
    const valid = await signed({ action: 'create', principal: PRINCIPAL });
    await expect(
      verifyPublicCommentAssertion({
        request: new Request(`${valid.request.url}?redirect=x`, valid.request),
        body: valid.body,
        environment,
        nowSeconds: 1_800_000_000,
        expectedAction: 'create',
      }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      verifyPublicCommentAssertion({
        ...valid,
        body: new TextEncoder().encode('{"changed":true}'),
        environment: { ...environment, LASH_PUBLIC_COMMENT_ACCESS_PHASE: 'disabled' },
        nowSeconds: 1_800_000_000,
        expectedAction: 'create',
      }),
    ).resolves.toMatchObject({ ok: false });
  });
});
