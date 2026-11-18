import { describe, expect, it, vi } from 'vitest';

import {
  MANAGEMENT_ASSERTION_DOMAIN_V1,
  MANAGEMENT_ASSERTION_DOMAIN_V2,
} from '../../../realtime-worker/src/managementAuth';
import { canonicalizePromotionJson, sha256Base64Url } from '../../../realtime-worker/src/promotion';
import { parseRealtimeRoute } from '../../../realtime-worker/src/routing';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    protected readonly ctx: unknown;

    constructor(ctx: unknown) {
      this.ctx = ctx;
    }
  },
}));

const SECRET = 'current-control-secret-with-at-least-32-bytes';
const PRINCIPAL = `account:v1:${'a'.repeat(43)}`;
const CLAIM_ID = 'claim-v1-9d05c49f61f58ffa69b8c098851879494c21aea1988e336055c1f646e9ad5543';
const ROOM = `doc-v2-${'b'.repeat(64)}`;
const RETAINED_ROOM = `doc-v1-${'e'.repeat(64)}`;
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const INITIAL_UPDATE =
  'AQTvjKbdDgAHAQdjb250ZW50AwlwYXJhZ3JhcGgHAO+Mpt0OAAYEAO+Mpt0OAQ1Qcm9tb3RlZCBib2R5KAEZbGFzaDpkb2N1bWVudC1tZXRhZGF0YTp2MQV0aXRsZQF3DlByb21vdGVkIHRpdGxlAA==';

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

const snapshot = async () => {
  const body = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Promoted body' }] }],
  };
  const title = 'Promoted title';
  const bodySha256 = await sha256Base64Url(
    new TextEncoder().encode(canonicalizePromotionJson(body)),
  );
  const updateBytes = Uint8Array.from(atob(INITIAL_UPDATE), (character) => character.charCodeAt(0));
  const initialUpdateSha256 = await sha256Base64Url(updateBytes);
  const adjuncts = { comments: 0, suggestions: 0 };
  const snapshotSha256 = await sha256Base64Url(
    new TextEncoder().encode(
      canonicalizePromotionJson({
        version: 1,
        title,
        bodySha256,
        initialUpdateSha256,
        adjuncts,
      }),
    ),
  );
  return {
    version: 1 as const,
    title,
    body,
    bodySha256,
    initialUpdate: INITIAL_UPDATE,
    initialUpdateSha256,
    adjuncts,
    snapshotSha256,
  };
};

const claimPromotionBody = async () => ({
  version: 2 as const,
  claimId: CLAIM_ID,
  ownerPrincipalId: PRINCIPAL,
  localDocumentId: 'doc-alpha',
  idempotencyHash: 'i'.repeat(43),
  candidates: [
    { kind: 'current' as const, derivationVersion: 'v2', roomId: ROOM },
    { kind: 'retained' as const, derivationVersion: 'v1', roomId: RETAINED_ROOM },
  ],
  snapshot: await snapshot(),
});

const signedRequest = async ({
  version = 2,
  bodyValue,
}: {
  version?: 1 | 2;
  bodyValue?: unknown;
} = {}) => {
  const path =
    version === 2
      ? `/api/management/document-claims/${CLAIM_ID}/promote`
      : `/api/management/documents/${ROOM}/promote`;
  const body = JSON.stringify(bodyValue ?? (await claimPromotionBody()));
  const bodySha256 = await sha256Base64Url(new TextEncoder().encode(body));
  const expiresAt = Math.floor(Date.now() / 1000) + 30;
  const canonical = [
    version === 2 ? MANAGEMENT_ASSERTION_DOMAIN_V2 : MANAGEMENT_ASSERTION_DOMAIN_V1,
    'POST',
    path,
    bodySha256,
    REQUEST_ID,
    PRINCIPAL,
    String(expiresAt),
  ].join('\n');
  const signature = await hmac(SECRET, canonical);
  return new Request(`https://worker.test${path}`, {
    method: 'POST',
    headers: {
      authorization: `Lash-Control v${version}:${signature}`,
      'content-type': 'application/json; charset=utf-8',
      'content-encoding': 'identity',
      'x-lash-control-request-id': REQUEST_ID,
      'x-lash-control-principal-id': PRINCIPAL,
      'x-lash-control-expires-at': String(expiresAt),
      'x-lash-control-body-sha256': bodySha256,
    },
    body,
  });
};

const workerEnvironment = (fetch: (request: Request) => Promise<Response>): Env =>
  ({
    LASH_SHARE_PHASE: 'enabled',
    LASH_WORKER_CONTROL_SECRET_CURRENT: SECRET,
    LASH_REALTIME_ROOM: { getByName: vi.fn(() => ({ fetch: vi.fn() })) },
    LASH_DOCUMENT_CLAIM: {
      getByName: vi.fn(() => ({ fetch })),
    },
  }) as unknown as Env;

describe('document promotion management route', () => {
  it('recognizes only canonical normalized claim and legacy management pathnames', () => {
    expect(
      parseRealtimeRoute(
        new URL(`https://worker.test/api/management/document-claims/${CLAIM_ID}/promote`),
      ),
    ).toEqual({ kind: 'management-document-claim-promotion', claimId: CLAIM_ID });
    expect(
      parseRealtimeRoute(new URL(`https://worker.test/api/management/documents/${ROOM}/promote`)),
    ).toEqual({ kind: 'management-document-promotion', roomId: ROOM });
    for (const pathname of [
      `/api/management/document-claims/${CLAIM_ID.toUpperCase()}/promote`,
      `/api/management/document-claims/${CLAIM_ID}/promote/`,
      `/api/management/documents/Room-Current/promote`,
    ]) {
      expect(parseRealtimeRoute(new URL(`https://worker.test${pathname}`))).toEqual({
        kind: 'not-found',
      });
    }
  });

  it('forwards only the validated v2 private command and returns no local id or browser CORS', async () => {
    const internalFetch = vi.fn(async (request: Request) => {
      expect(new URL(request.url).pathname).toBe('/__lash-document-claim/promote');
      expect(new URL(request.url).search).toBe('');
      expect(request.headers.get('x-lash-internal-management')).toBe('document-claim-v2');
      const command = (await request.json()) as Record<string, unknown>;
      expect(command).toEqual({
        version: 2,
        requestId: REQUEST_ID,
        bodySha256: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
        promotion: await claimPromotionBody(),
      });
      const promotion = command.promotion as Awaited<ReturnType<typeof claimPromotionBody>>;
      return Response.json({
        ok: true,
        version: 2,
        claimId: CLAIM_ID,
        roomId: ROOM,
        ownerPrincipalId: PRINCIPAL,
        aclVersion: 1,
        publicPolicy: 'restricted',
        publicPolicyVersion: 1,
        snapshotSha256: promotion.snapshot.snapshotSha256,
        created: true,
      });
    });
    const worker = (await import('../../../realtime-worker/src/index')).default;
    const response = await worker.fetch(await signedRequest(), workerEnvironment(internalFetch));

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    const responseText = await response.text();
    expect(responseText).not.toContain('localDocumentId');
    expect(responseText).not.toContain('doc-alpha');
    expect(JSON.parse(responseText)).toMatchObject({
      ok: true,
      publicPolicy: 'restricted',
      created: true,
    });
    expect(internalFetch).toHaveBeenCalledOnce();
  });

  it('cuts off the entire signed v1 public route before any room dispatch', async () => {
    const internalFetch = vi.fn();
    const worker = (await import('../../../realtime-worker/src/index')).default;
    const legacyBody = {
      version: 1,
      roomId: ROOM,
      ownerPrincipalId: PRINCIPAL,
      idempotencyHash: 'i'.repeat(43),
      createIfMissing: true,
      snapshot: await snapshot(),
    };
    const response = await worker.fetch(
      await signedRequest({ version: 1, bodyValue: legacyBody }),
      workerEnvironment(internalFetch),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      version: 1,
      error: 'upgrade-required',
      retryable: false,
    });
    expect(internalFetch).not.toHaveBeenCalled();
  });

  it('fails closed for OPTIONS, disabled phase, and invalid claim-coordinator output', async () => {
    const worker = (await import('../../../realtime-worker/src/index')).default;
    const options = await worker.fetch(
      new Request(`https://worker.test/api/management/document-claims/${CLAIM_ID}/promote`, {
        method: 'OPTIONS',
      }),
      workerEnvironment(vi.fn()),
    );
    expect(options.status).toBe(401);
    expect(options.headers.get('access-control-allow-origin')).toBeNull();

    const disabled = await worker.fetch(await signedRequest(), {
      ...workerEnvironment(vi.fn()),
      LASH_SHARE_PHASE: 'disabled',
    } as never);
    expect(disabled.status).toBe(503);
    await expect(disabled.json()).resolves.toMatchObject({
      ok: false,
      error: 'promotion-disabled',
    });

    const invalidInternal = await worker.fetch(
      await signedRequest(),
      workerEnvironment(vi.fn(async () => Response.json({ ok: true }))),
    );
    expect(invalidInternal.status).toBe(500);
    await expect(invalidInternal.json()).resolves.toEqual({
      ok: false,
      version: 2,
      error: 'internal-error',
      retryable: true,
    });
  });
});
