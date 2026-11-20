import { afterEach, expect, it, vi } from 'vitest';

import { GET as inspectAccount } from '../../../../apps/web/app/api/account/session/route';
import { POST as postRecent } from '../../../../apps/web/app/api/documents/recent/route';
import { stableAccountPrincipalId } from '../../../../apps/web/lib/auth/principal';
import { encryptNamedEditValue } from '../../../../apps/web/lib/namedEdit/serverCrypto';
import { NextRequest } from '../../../../apps/web/node_modules/next/server.js';

vi.mock('../../../../apps/web/node_modules/server-only/index.js', () => ({}));

const origin = 'https://lash.test';
const issuer = 'https://auth.test/auth/v1';
const cookieName = 'sb-auth-auth-token';
const workerOrigin = 'https://worker.test';
const key = Buffer.alloc(32, 44);
const principalKey = 'synthetic account principal secret for a passive auth test';
const roomId = `doc-v1-${'a'.repeat(64)}`;
const providerUser = {
  id: 'verified-provider-subject',
  email: 'member@example.test',
  email_confirmed_at: '2026-01-01T00:00:00.000Z',
};
const principalId = stableAccountPrincipalId(issuer, providerUser.id, principalKey);

const configure = () => {
  vi.stubEnv('LASH_NAMED_EDIT_PHASE', 'enabled');
  vi.stubEnv('LASH_NAMED_EDIT_KEY', key.toString('base64url'));
  vi.stubEnv('LASH_REALTIME_WORKER_HTTP_URL', workerOrigin);
  vi.stubEnv('LASH_WORKER_CONTROL_SECRET_CURRENT', 'synthetic worker control secret for testing');
  vi.stubEnv('LASH_DOCUMENT_ID_DERIVATION_KEYS', `v1:${key.toString('base64url')}`);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://auth.test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'synthetic-publishable-key');
  vi.stubEnv('LASH_ACCOUNT_PRINCIPAL_HMAC_KEY', principalKey);
  vi.stubEnv('LASH_SITE_ORIGIN', origin);
};

const namedRecents = (cookie?: string) =>
  postRecent(
    new NextRequest(origin + '/api/documents/recent', {
      method: 'POST',
      headers: {
        host: 'lash.test',
        origin,
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({
        version: 1,
        bookmarks: [encryptNamedEditValue(key, 'recent', roomId, principalId, origin)],
      }),
    }),
  );

const sessionCookie = (expiresAt: number) => {
  const session = {
    access_token: 'stored-access-token',
    refresh_token: 'stored-refresh-token',
    expires_at: expiresAt,
    user: { ...providerUser, id: 'untrusted-cookie-user' },
  };
  return `${cookieName}=base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('requires an explicit refresh for a stored expired session and verifies the renewed identity online', async () => {
  configure();
  const network = vi.fn(async (input: string, init: RequestInit) => {
    if (input === `${issuer}/token?grant_type=refresh_token`) {
      expect(init.method).toBe('POST');
      expect(JSON.parse(String(init.body))).toEqual({ refresh_token: 'stored-refresh-token' });
      return Response.json({
        access_token: 'fresh-access-token',
        refresh_token: 'fresh-refresh-token',
        expires_in: 3600,
        token_type: 'bearer',
        user: providerUser,
      });
    }
    if (input === `${issuer}/user`) {
      expect(init.method).toBe('GET');
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer fresh-access-token');
      return Response.json(providerUser);
    }
    expect(input).toBe(`${workerOrigin}/api/management/documents/${roomId}/named-edit/recent`);
    expect(new Headers(init.headers).get('x-lash-control-principal-id')).toBe(principalId);
    return Response.json({ ok: true, version: 1, title: 'A verified recent draft' });
  });
  vi.stubGlobal('fetch', network);

  const expiredCookie = sessionCookie(Math.floor(Date.now() / 1000) - 60);
  const locked = await namedRecents(expiredCookie);
  expect(locked.status).toBe(409);
  expect(await locked.json()).toEqual({
    ok: false,
    version: 1,
    error: 'session-refresh-required',
  });
  expect(locked.headers.has('set-cookie')).toBe(false);
  expect(locked.headers.get('cache-control')).toContain('no-store');
  expect(network).not.toHaveBeenCalled();

  const refresh = await inspectAccount(
    new NextRequest(origin + '/api/account/session', {
      headers: { host: 'lash.test', cookie: expiredCookie },
    }),
  );
  expect(refresh.status).toBe(204);
  expect(refresh.headers.get('x-lash-account-status')).toBe('authenticated');
  const updated = refresh.cookies.get(cookieName)?.value || '';
  expect(updated).toMatch(/^base64-/u);

  const recent = await namedRecents(`${cookieName}=${updated}`);
  expect(recent.status).toBe(200);
  expect(await recent.json()).toEqual({
    ok: true,
    version: 1,
    documents: [{ id: roomId, title: 'A verified recent draft' }],
  });
  expect(recent.headers.has('set-cookie')).toBe(false);
  const tokenCalls = network.mock.calls.filter(([url]) => url.includes('/token?'));
  expect(tokenCalls).toHaveLength(1);
  const userCalls = network.mock.calls.filter(([url]) => url === `${issuer}/user`);
  expect(userCalls).toHaveLength(2);
  expect(userCalls.at(-1)?.[1]).toMatchObject({
    redirect: 'error',
    credentials: 'omit',
    cache: 'no-store',
    signal: expect.any(AbortSignal),
  });
});

it('distinguishes signed out and invalid sessions from an unavailable provider', async () => {
  configure();
  const network = vi.fn(async () => {
    return Response.json({ message: 'Provider error' }, { status: 503 });
  });
  vi.stubGlobal('fetch', network);
  expect((await namedRecents()).status).toBe(401);
  expect(network).not.toHaveBeenCalled();

  const cookie = sessionCookie(Math.floor(Date.now() / 1000) + 3600);
  const unavailable = await namedRecents(cookie);
  expect(unavailable.status).toBe(503);
  expect(unavailable.headers.has('set-cookie')).toBe(false);
  expect(network).toHaveBeenCalledTimes(1);

  network.mockResolvedValueOnce(Response.json({ message: 'Invalid session' }, { status: 401 }));
  const invalid = await namedRecents(cookie);
  expect(invalid.status).toBe(401);
  expect(invalid.headers.has('set-cookie')).toBe(false);
  expect(network).toHaveBeenCalledTimes(2);
});
