import { describe, expect, it, vi } from 'vitest';

import { createSupabaseResponseMutationSink } from '../../../../apps/web/lib/auth/cookies';
import { handleAccountSession, handleSignOut } from '../../../../apps/web/lib/auth/routeHandlers';

vi.mock('../../../../apps/web/lib/auth/serverClient', () => ({
  createRouteSupabaseClientSession: vi.fn(),
}));
vi.mock('../../../../apps/web/lib/auth/serverPrincipal', () => ({
  resolveServerAccountPrincipal: vi.fn(),
}));

const provider = {
  issuer: 'https://project.supabase.co/auth/v1',
  publishableKey: 'publishable-key',
  siteOrigin: 'https://lash.example',
  url: 'https://project.supabase.co',
};

const mutationSession = (client: unknown) => {
  const sink = createSupabaseResponseMutationSink({
    getAll: () => [],
  });
  sink.adapter.setAll?.(
    [
      {
        name: 'sb-access',
        value: 'access-value',
        options: { httpOnly: true, path: '/', sameSite: 'lax', secure: true },
      },
      {
        name: 'sb-refresh',
        value: 'refresh-value',
        options: { httpOnly: true, path: '/', sameSite: 'strict', secure: true },
      },
    ],
    { 'x-supabase-refresh': 'applied' },
  );
  return {
    applyTo: sink.applyTo,
    client,
  };
};

interface AuthRouteResponse {
  cookies: { get(name: string): { value: string } | undefined };
  headers: Headers;
  status: number;
}

const assertMutations = (response: AuthRouteResponse) => {
  expect(response.cookies.get('sb-access')?.value).toBe('access-value');
  expect(response.cookies.get('sb-refresh')?.value).toBe('refresh-value');
  expect(response.headers.get('set-cookie')).toContain('sb-access=access-value');
  expect(response.headers.get('set-cookie')).toContain('sb-refresh=refresh-value');
  expect(response.headers.get('x-supabase-refresh')).toBe('applied');
  expect(response.headers.get('cache-control')).toContain('no-store');
};

const accountRequest = () =>
  ({
    cookies: { getAll: () => [] },
    headers: new Headers({ host: 'lash.example' }),
    nextUrl: new URL('https://lash.example/api/account/session'),
  }) as never;

const signOutRequest = () =>
  ({
    cookies: { getAll: () => [] },
    formData: async () => {
      const form = new FormData();
      form.set('next', '/doc/weekly-plan');
      return form;
    },
    headers: new Headers({
      host: 'lash.example',
      origin: 'https://lash.example',
    }),
    nextUrl: new URL('https://lash.example/api/auth/sign-out'),
  }) as never;

describe('auth route response mutation preservation', () => {
  it.each(['authenticated', 'anonymous', 'invalid', 'unavailable', 'unverified'] as const)(
    'retains every Supabase mutation for an %s account result',
    async (status) => {
      const response = await handleAccountSession(accountRequest(), {
        createSession: () => mutationSession({ auth: {} }) as never,
        requireConfig: () => provider,
        resolvePrincipal: vi.fn().mockResolvedValue(
          status === 'authenticated'
            ? {
                status,
                principal: {
                  email: 'person@example.com',
                  emailVerifiedAt: '2026-07-30T01:00:00.000Z',
                  id: 'account:v1:pseudonym',
                  kind: 'account',
                },
              }
            : { status, principal: null },
        ),
      });

      expect(response.status).toBe(status === 'authenticated' ? 204 : 401);
      assertMutations(response);
    },
  );

  it('retains every Supabase mutation when account resolution throws', async () => {
    const response = await handleAccountSession(accountRequest(), {
      createSession: () => mutationSession({ auth: {} }) as never,
      requireConfig: () => provider,
      resolvePrincipal: vi.fn().mockRejectedValue(new Error('provider failed')),
    });

    expect(response.status).toBe(401);
    assertMutations(response);
  });

  it.each([
    { label: 'success', result: { error: null }, expectedStatus: 303 },
    { label: 'provider error', result: { error: new Error('failed') }, expectedStatus: 503 },
  ])('retains every Supabase mutation on sign-out $label', async ({ result, expectedStatus }) => {
    const response = await handleSignOut(signOutRequest(), {
      createSession: () =>
        mutationSession({
          auth: { signOut: vi.fn().mockResolvedValue(result) },
        }) as never,
      requireConfig: () => provider,
    });

    expect(response.status).toBe(expectedStatus);
    assertMutations(response);
  });

  it('retains every Supabase mutation when sign-out throws', async () => {
    const response = await handleSignOut(signOutRequest(), {
      createSession: () =>
        mutationSession({
          auth: { signOut: vi.fn().mockRejectedValue(new Error('provider failed')) },
        }) as never,
      requireConfig: () => provider,
    });

    expect(response.status).toBe(503);
    assertMutations(response);
  });
});
