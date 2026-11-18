import { describe, expect, it, vi } from 'vitest';

import { MANAGEMENT_ASSERTION_DOMAIN_V2 } from '../../../realtime-worker/src/managementAuth';
import { sha256Base64Url } from '../../../realtime-worker/src/promotion';
import { parseRealtimeRoute } from '../../../realtime-worker/src/routing';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    protected readonly ctx: unknown;
    protected readonly env: unknown;

    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const SECRET = 'current-control-secret-with-at-least-32-bytes';
const PRINCIPAL = `account:v1:${'a'.repeat(43)}`;
const OTHER_PRINCIPAL = `account:v1:${'b'.repeat(43)}`;
const LOCAL_DOCUMENT_ID = 'doc-alpha';
const CLAIM_ID = 'claim-v1-9d05c49f61f58ffa69b8c098851879494c21aea1988e336055c1f646e9ad5543';
const ROOM_ID = `doc-v1-${'a'.repeat(64)}`;
const SNAPSHOT_SHA = 's'.repeat(43);
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const MUTATION_ID = '223e4567-e89b-42d3-a456-426614174000';

const readBody = () => ({
  version: 1 as const,
  claimId: CLAIM_ID,
  ownerPrincipalId: PRINCIPAL,
  localDocumentId: LOCAL_DOCUMENT_ID,
});

const updateBody = (mode: unknown = 'comment') => ({
  ...readBody(),
  mode,
  expectedPolicyVersion: 1,
  mutationId: MUTATION_ID,
});

const base64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
};

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

const signedRequest = async (
  action: 'read' | 'update',
  bodyValue: unknown = action === 'read' ? readBody() : updateBody(),
  assertedPrincipal = PRINCIPAL,
) => {
  const path = `/api/management/document-claims/${CLAIM_ID}/public-policy/${action}`;
  const body = JSON.stringify(bodyValue);
  const bodySha256 = await sha256Base64Url(new TextEncoder().encode(body));
  const expiresAt = Math.floor(Date.now() / 1000) + 30;
  const signature = await hmac(
    SECRET,
    [
      MANAGEMENT_ASSERTION_DOMAIN_V2,
      'POST',
      path,
      bodySha256,
      REQUEST_ID,
      assertedPrincipal,
      String(expiresAt),
    ].join('\n'),
  );
  return new Request(`https://worker.test${path}`, {
    method: 'POST',
    headers: {
      authorization: `Lash-Control v2:${signature}`,
      'content-type': 'application/json; charset=utf-8',
      'content-encoding': 'identity',
      'x-lash-control-request-id': REQUEST_ID,
      'x-lash-control-principal-id': assertedPrincipal,
      'x-lash-control-expires-at': String(expiresAt),
      'x-lash-control-body-sha256': bodySha256,
    },
    body,
  });
};

const readSuccess = {
  ok: true as const,
  version: 1 as const,
  claimId: CLAIM_ID,
  roomId: ROOM_ID,
  ownerPrincipalId: PRINCIPAL,
  mode: 'restricted' as const,
  policyVersion: 1,
  cutoffGeneration: 0,
  publicPath: null,
};

const updateSuccess = {
  ...readSuccess,
  mode: 'comment' as const,
  policyVersion: 2,
  cutoffGeneration: 1,
  publicPath: `/public/${ROOM_ID}`,
  changed: true,
};

describe('public-policy Worker routes', () => {
  it('recognizes only exact canonical claim read/update routes', () => {
    for (const action of ['read', 'update'] as const) {
      const path = `/api/management/document-claims/${CLAIM_ID}/public-policy/${action}`;
      expect(parseRealtimeRoute(new URL(`https://worker.test${path}`))).toEqual({
        kind: 'management-document-claim-public-policy',
        claimId: CLAIM_ID,
        action,
      });
      for (const invalid of [`${path}/`, path.replace('claim-v1-', 'CLAIM-V1-')]) {
        expect(parseRealtimeRoute(new URL(`https://worker.test${invalid}`))).toEqual({
          kind: 'not-found',
        });
      }
    }
  });

  it('authenticates and forwards exact owner read/update commands without browser CORS', async () => {
    const worker = (await import('../../../realtime-worker/src/index')).default;
    for (const [action, body, result] of [
      ['read', readBody(), readSuccess],
      ['update', updateBody(), updateSuccess],
    ] as const) {
      const claimFetch = vi.fn(async (request: Request) => {
        expect(new URL(request.url).pathname).toBe(
          `/__lash-document-claim/public-policy/${action}`,
        );
        expect(new URL(request.url).search).toBe('');
        expect(request.headers.get('x-lash-internal-management')).toBe('public-policy-v1');
        await expect(request.json()).resolves.toEqual({
          version: 1,
          requestId: REQUEST_ID,
          bodySha256: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
          publicPolicy: body,
        });
        return Response.json(result);
      });
      const response = await worker.fetch(await signedRequest(action), {
        LASH_SHARE_PHASE: 'enabled',
        LASH_WORKER_CONTROL_SECRET_CURRENT: SECRET,
        LASH_DOCUMENT_CLAIM: { getByName: vi.fn(() => ({ fetch: claimFetch })) },
        LASH_REALTIME_ROOM: { getByName: vi.fn() },
      } as never);

      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      await expect(response.json()).resolves.toEqual(result);
      expect(claimFetch).toHaveBeenCalledOnce();
    }
  });

  it('rejects public Edit and unknown values before claim dispatch', async () => {
    const worker = (await import('../../../realtime-worker/src/index')).default;
    for (const mode of ['edit', 'unknown', null, 4]) {
      const claimFetch = vi.fn();
      const response = await worker.fetch(await signedRequest('update', updateBody(mode)), {
        LASH_SHARE_PHASE: 'enabled',
        LASH_WORKER_CONTROL_SECRET_CURRENT: SECRET,
        LASH_DOCUMENT_CLAIM: { getByName: vi.fn(() => ({ fetch: claimFetch })) },
        LASH_REALTIME_ROOM: { getByName: vi.fn() },
      } as never);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        version: 1,
        error: 'invalid-request',
        retryable: false,
      });
      expect(claimFetch).not.toHaveBeenCalled();
    }
  });

  it('requires the signed management principal to be the immutable document owner', async () => {
    const worker = (await import('../../../realtime-worker/src/index')).default;
    const claimFetch = vi.fn();
    const response = await worker.fetch(await signedRequest('read', readBody(), OTHER_PRINCIPAL), {
      LASH_SHARE_PHASE: 'enabled',
      LASH_WORKER_CONTROL_SECRET_CURRENT: SECRET,
      LASH_DOCUMENT_CLAIM: { getByName: vi.fn(() => ({ fetch: claimFetch })) },
      LASH_REALTIME_ROOM: { getByName: vi.fn() },
    } as never);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      version: 1,
      error: 'unauthorized',
      retryable: false,
    });
    expect(claimFetch).not.toHaveBeenCalled();
  });

  it('resolves one immutable alias and forwards the owner update to that room only', async () => {
    const roomFetch = vi.fn(async (request: Request) => {
      expect(new URL(request.url).pathname).toBe('/__lash-room/public-policy/update');
      expect(request.headers.get('x-lash-internal-management')).toBe('public-policy-v1');
      await expect(request.json()).resolves.toEqual({
        version: 1,
        requestId: REQUEST_ID,
        bodySha256: 'h'.repeat(43),
        publicPolicy: {
          ...updateBody(),
          roomId: ROOM_ID,
        },
      });
      const { claimId: _claimId, ...roomResult } = updateSuccess;
      return Response.json(roomResult);
    });
    const sql = vi.fn((statement: string) => {
      const normalized = statement.replace(/\s+/gu, ' ').trim();
      return {
        toArray: () =>
          normalized.includes('FROM document_claim_alias_v1')
            ? [
                {
                  claim_id: CLAIM_ID,
                  owner_principal_id: PRINCIPAL,
                  canonical_local_document_id: LOCAL_DOCUMENT_ID,
                  room_id: ROOM_ID,
                  promotion_snapshot_sha256: SNAPSHOT_SHA,
                  created_at: '2026-07-30T00:00:00.000Z',
                },
              ]
            : [],
      };
    });
    const blockConcurrencyWhile = vi.fn(<T>(callback: () => Promise<T> | T) =>
      Promise.resolve(callback()),
    );
    const { LashDocumentClaim } = await import('../../../realtime-worker/src/claimCoordinator');
    const claim = new LashDocumentClaim(
      {
        blockConcurrencyWhile,
        storage: {
          sql: { exec: sql },
          transactionSync: vi.fn((callback: () => unknown) => callback()),
        },
      } as never,
      {
        LASH_REALTIME_ROOM: {
          getByName: vi.fn((roomId: string) => {
            expect(roomId).toBe(ROOM_ID);
            return { fetch: roomFetch };
          }),
        },
      } as never,
    );
    await Promise.all(
      blockConcurrencyWhile.mock.results
        .map((result) => result.value)
        .filter((value): value is Promise<unknown> => value instanceof Promise),
    );

    const response = await claim.fetch(
      new Request('https://claim.internal/__lash-document-claim/public-policy/update', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-lash-internal-management': 'public-policy-v1',
        },
        body: JSON.stringify({
          version: 1,
          requestId: REQUEST_ID,
          bodySha256: 'h'.repeat(43),
          publicPolicy: updateBody(),
        }),
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(updateSuccess);
    expect(roomFetch).toHaveBeenCalledOnce();
  });
});
