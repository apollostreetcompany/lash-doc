import { describe, expect, it, vi } from 'vitest';

import { deriveDocumentClaimId } from '../../../realtime-worker/src/documentClaim';
import { MANAGEMENT_ASSERTION_DOMAIN_V2 } from '../../../realtime-worker/src/managementAuth';

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

const OWNER = `account:v1:${'o'.repeat(43)}`;
const SECRET = 'owner-management-comment-secret-at-least-32-bytes';
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const COMMENT_ID = 'pc-v1-323e4567-e89b-42d3-a456-426614174000';

const base64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
};

const signedModeration = async () => {
  const claimId = await deriveDocumentClaimId(OWNER, 'doc-alpha');
  const path = `/api/management/document-claims/${claimId}/public-comments/moderate`;
  const bodyValue = {
    version: 1,
    claimId,
    ownerPrincipalId: OWNER,
    localDocumentId: 'doc-alpha',
    commentId: COMMENT_ID,
    action: 'hide',
    mutationId: '923e4567-e89b-42d3-a456-426614174000',
    expectedPolicyVersion: 3,
    expectedCutoffGeneration: 2,
  };
  const body = JSON.stringify(bodyValue);
  const bodySha256 = base64Url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))),
  );
  const expiresAt = Math.floor(Date.now() / 1_000) + 30;
  const canonical = [
    MANAGEMENT_ASSERTION_DOMAIN_V2,
    'POST',
    path,
    bodySha256,
    REQUEST_ID,
    OWNER,
    String(expiresAt),
  ].join('\n');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = base64Url(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical))),
  );
  return {
    claimId,
    bodyValue,
    request: new Request(`https://worker.test${path}`, {
      method: 'POST',
      headers: {
        authorization: `Lash-Control v2:${signature}`,
        'content-type': 'application/json',
        'x-lash-control-body-sha256': bodySha256,
        'x-lash-control-request-id': REQUEST_ID,
        'x-lash-control-principal-id': OWNER,
        'x-lash-control-expires-at': String(expiresAt),
      },
      body,
    }),
  };
};

describe('owner public-comment moderation route', () => {
  it('reuses Lash-Control v2 and forwards the exact owner-only hide command', async () => {
    const input = await signedModeration();
    const roomId = `doc-v1-${'a'.repeat(64)}`;
    const claimFetch = vi.fn(async (request: Request) => {
      expect(new URL(request.url).pathname).toBe('/__lash-document-claim/public-comments/moderate');
      expect(request.headers.get('x-lash-internal-management')).toBe(
        'public-comment-moderation-v1',
      );
      await expect(request.json()).resolves.toMatchObject({
        version: 1,
        requestId: REQUEST_ID,
        publicComment: input.bodyValue,
      });
      return Response.json({
        ok: true,
        version: 1,
        claimId: input.claimId,
        roomId,
        commentId: COMMENT_ID,
        state: 'hidden',
        changed: true,
        policyVersion: 3,
        cutoffGeneration: 2,
        moderatedAt: '2026-07-30T00:01:00.000Z',
      });
    });
    const worker = (await import('../../../realtime-worker/src/index')).default;
    const response = await worker.fetch(input.request, {
      LASH_SHARE_PHASE: 'enabled',
      LASH_WORKER_CONTROL_SECRET_CURRENT: SECRET,
      LASH_DOCUMENT_CLAIM: {
        getByName: vi.fn(() => ({ fetch: claimFetch })),
      },
    } as never);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(claimFetch).toHaveBeenCalledOnce();
  });

  it('rejects public-comment audience headers and forged owner binding', async () => {
    const worker = (await import('../../../realtime-worker/src/index')).default;
    const input = await signedModeration();
    const claimFetch = vi.fn();
    const forged = new Request(input.request, {
      headers: {
        ...Object.fromEntries(input.request.headers.entries()),
        'x-lash-control-principal-id': `account:v1:${'p'.repeat(43)}`,
        'x-lash-control-audience': 'public-comment-create-v1',
      },
    });
    const response = await worker.fetch(forged, {
      LASH_SHARE_PHASE: 'enabled',
      LASH_WORKER_CONTROL_SECRET_CURRENT: SECRET,
      LASH_DOCUMENT_CLAIM: {
        getByName: vi.fn(() => ({ fetch: claimFetch })),
      },
    } as never);
    expect(response.status).toBe(401);
    expect(claimFetch).not.toHaveBeenCalled();
  });
});
