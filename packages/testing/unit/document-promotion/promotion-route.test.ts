import { canonicalize } from '@lash/types';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { createSupabaseResponseMutationSink } from '../../../../apps/web/lib/auth/cookies';
import {
  handleDocumentPromotion,
  type DocumentPromotionRouteDependencies,
} from '../../../../apps/web/lib/documentPromotion/routeHandler';

vi.mock('../../../../apps/web/lib/auth/serverClient', () => ({
  createRouteSupabaseClientSession: vi.fn(),
}));
vi.mock('../../../../apps/web/lib/auth/serverPrincipal', () => ({
  requireServerAccountPrincipal: vi.fn(),
}));

const PRINCIPAL_ID = `account:v1:${'a'.repeat(43)}`;
const CLAIM_ID = `claim-v1-${'d'.repeat(64)}`;
const IDEMPOTENCY_KEY = 'AAECAwQFBgcICQoLDA0ODw';
const workerConfig = {
  workerOrigin: 'https://worker.example',
  controlSecret: 'current-control-secret-with-at-least-32-bytes',
  derivationKeys: [{ version: 'v1', key: Buffer.alloc(32, 7) }],
};
const provider = {
  issuer: 'https://project.supabase.co/auth/v1',
  publishableKey: 'publishable-key',
  siteOrigin: 'https://lash.example',
  url: 'https://project.supabase.co',
};

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('base64url');

const promotionBody = () => {
  const body = { type: 'doc', content: [{ type: 'paragraph' }] };
  const initialUpdate = Buffer.from([0, 0]).toString('base64');
  const bodySha256 = sha256(canonicalize(body));
  const initialUpdateSha256 = sha256(Buffer.from(initialUpdate, 'base64'));
  return {
    version: 1,
    idempotencyKey: IDEMPOTENCY_KEY,
    snapshot: {
      version: 1,
      title: 'Weekly plan',
      body,
      bodySha256,
      initialUpdate,
      initialUpdateSha256,
      adjuncts: { comments: 0, suggestions: 0 },
      snapshotSha256: sha256(
        canonicalize({
          version: 1,
          title: 'Weekly plan',
          bodySha256,
          initialUpdateSha256,
          adjuncts: { comments: 0, suggestions: 0 },
        }),
      ),
    },
  };
};

const request = (
  body: unknown = promotionBody(),
  options: { origin?: string; path?: string } = {},
) => {
  const value = new Request(
    `https://lash.example${options.path ?? '/api/documents/weekly-plan/promote'}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host: 'lash.example',
        origin: options.origin ?? 'https://lash.example',
      },
      body: JSON.stringify(body),
    },
  );
  return Object.assign(value, {
    cookies: { getAll: () => [] },
    nextUrl: new URL(value.url),
  }) as never;
};

const mutationSession = () => {
  const sink = createSupabaseResponseMutationSink({ getAll: () => [] });
  sink.adapter.setAll?.(
    [
      {
        name: 'sb-access',
        value: 'refreshed',
        options: { httpOnly: true, path: '/', secure: true, sameSite: 'lax' },
      },
    ],
    { 'x-supabase-refresh': 'applied' },
  );
  return { client: { auth: {} }, applyTo: sink.applyTo };
};

const dependencies = (
  overrides: Partial<DocumentPromotionRouteDependencies> = {},
): DocumentPromotionRouteDependencies => ({
  createSession: () => mutationSession() as never,
  requireAuthConfig: () => provider,
  requirePrincipal: vi.fn().mockResolvedValue({
    kind: 'account',
    id: PRINCIPAL_ID,
    email: 'private@example.com',
    emailVerifiedAt: '2026-07-30T01:00:00.000Z',
  }),
  loadPromotionConfig: () => workerConfig,
  promote: vi.fn().mockResolvedValue({
    ok: true,
    version: 2,
    claimId: CLAIM_ID,
    roomId: `doc-v1-${'c'.repeat(43)}`,
    ownerPrincipalId: PRINCIPAL_ID,
    aclVersion: 1,
    publicPolicy: 'restricted',
    publicPolicyVersion: 1,
    snapshotSha256: promotionBody().snapshot.snapshotSha256,
    created: true,
  }),
  ...overrides,
});

const assertNoStoreMutations = (response: Response & { cookies: unknown }) => {
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(response.headers.get('set-cookie')).toContain('sb-access=refreshed');
  expect(response.headers.get('x-supabase-refresh')).toBe('applied');
};

describe('document promotion route', () => {
  it('binds the exact local route to a verified server principal and sanitizes success', async () => {
    const promote = vi.fn().mockResolvedValue({
      ok: true,
      version: 2,
      claimId: CLAIM_ID,
      roomId: `doc-v1-${'c'.repeat(43)}`,
      ownerPrincipalId: PRINCIPAL_ID,
      aclVersion: 1,
      publicPolicy: 'restricted',
      publicPolicyVersion: 1,
      snapshotSha256: promotionBody().snapshot.snapshotSha256,
      created: true,
    });
    const response = await handleDocumentPromotion(
      request(),
      { localDocumentId: 'weekly-plan' },
      dependencies({ promote }),
    );
    const raw = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(raw)).toEqual({
      ok: true,
      version: 2,
      roomId: `doc-v1-${'c'.repeat(43)}`,
      aclVersion: 1,
      publicPolicy: 'restricted',
      publicPolicyVersion: 1,
      snapshotSha256: promotionBody().snapshot.snapshotSha256,
      created: true,
    });
    expect(raw).not.toContain(PRINCIPAL_ID);
    expect(raw).not.toContain(CLAIM_ID);
    expect(raw).not.toContain('private@example.com');
    expect(promote).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: PRINCIPAL_ID,
        localDocumentId: 'weekly-plan',
        idempotencyHash: 'CEP7tIPvMCDbqIAWo2G_pusiw96XbnQpvEykR7M-LmY',
      }),
    );
    assertNoStoreMutations(response as never);
  });

  it.each([
    ['signed out', 'account-session-invalid'],
    ['unverified', 'verified-account-required'],
  ])('rejects a %s account before contacting the Worker', async (_label, code) => {
    const promote = vi.fn();
    const response = await handleDocumentPromotion(
      request(),
      { localDocumentId: 'weekly-plan' },
      dependencies({
        requirePrincipal: vi.fn().mockRejectedValue(Object.assign(new Error(code), { code })),
        promote,
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      version: 2,
      error: 'unauthorized',
      retryable: false,
    });
    expect(promote).not.toHaveBeenCalled();
    assertNoStoreMutations(response as never);
  });

  it.each([
    ['cross-origin request', request(undefined, { origin: 'https://evil.example' })],
    ['query-bearing route', request(undefined, { path: '/api/documents/weekly-plan/promote?x=1' })],
    ['noncanonical route id', request(undefined, { path: '/api/documents/-weekly/promote' })],
  ])('rejects a %s', async (_label, invalidRequest) => {
    const promote = vi.fn();
    const response = await handleDocumentPromotion(
      invalidRequest,
      {
        localDocumentId: invalidRequest.nextUrl.pathname.includes('-weekly')
          ? '-weekly'
          : 'weekly-plan',
      },
      dependencies({ promote }),
    );
    expect(response.status).toBe(
      invalidRequest.headers.get('origin') === 'https://evil.example' ? 403 : 400,
    );
    expect(promote).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('preserves Supabase response mutations on terminal and retryable Worker failures', async () => {
    for (const [result, status] of [
      [
        {
          ok: false,
          version: 2,
          error: 'claim-conflict',
          retryable: false,
        },
        409,
      ],
      [
        {
          ok: false,
          version: 2,
          error: 'readback-failed',
          retryable: true,
        },
        503,
      ],
    ] as const) {
      const response = await handleDocumentPromotion(
        request(),
        { localDocumentId: 'weekly-plan' },
        dependencies({ promote: vi.fn().mockResolvedValue(result) }),
      );
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual(result);
      assertNoStoreMutations(response as never);
    }
  });

  it('keeps the Next route export surface exact', () => {
    const source = readFileSync(
      new URL(
        '../../../../apps/web/app/api/documents/[localDocumentId]/promote/route.ts',
        import.meta.url,
      ),
      'utf8',
    );
    const exports = [...source.matchAll(/^export\s+(?:async\s+)?(?:const|function)\s+(\w+)/gmu)]
      .map((match) => match[1])
      .sort();
    expect(exports).toEqual(['POST', 'dynamic']);
  });
});
