import type {
  PublicCommentCreateRequestV1,
  PublicCommentListRequestV1,
  PublicCommentModerationRequestV1,
} from '@lash/types';
import { describe, expect, it, vi } from 'vitest';

import { createSupabaseResponseMutationSink } from '../../../../apps/web/lib/auth/cookies';
import { createPublicCommentCsrfSession } from '../../../../apps/web/lib/publicDocumentComments/csrf';
import {
  handlePublicCommentAuthoringSession,
  handlePublicCommentCreate,
  handlePublicCommentHide,
  handlePublicCommentList,
} from '../../../../apps/web/lib/publicDocumentComments/routeHandler';

vi.mock('../../../../apps/web/lib/auth/serverClient', () => ({
  createRouteSupabaseClientSession: vi.fn(),
}));
vi.mock('../../../../apps/web/lib/auth/serverPrincipal', () => ({
  requireServerAccountPrincipal: vi.fn(),
  resolveServerAccountPrincipal: vi.fn(),
}));

const ROOM_ID = `doc-v1-${'a'.repeat(64)}`;
const CLAIM_ID = `claim-v1-${'b'.repeat(64)}`;
const COMMENT_ID = 'pc-v1-123e4567-e89b-42d3-a456-426614174000';
const MUTATION_ID = '123e4567-e89b-42d3-a456-426614174000';
const PRINCIPAL_ID = `account:v1:${'A'.repeat(43)}`;
const PRINCIPAL_KEY = 'principal-key-that-is-at-least-32-bytes';
const SITE_ORIGIN = 'https://lash.example';
const WORKER_ORIGIN = 'https://worker.example';
const COMMENT_SECRET = 'comment-control-secret-at-least-32-bytes';
const CONTROL_SECRET = 'management-control-secret-at-least-32-bytes';

const config = {
  enabled: true as const,
  siteOrigin: SITE_ORIGIN,
  workerOrigin: WORKER_ORIGIN,
  commentControlSecret: COMMENT_SECRET,
  principalKey: PRINCIPAL_KEY,
  rateKey: {
    secret: 'rate-key-secret-that-is-at-least-32-bytes',
    headerName: 'x-forwarded-for' as const,
  },
};

const principal = {
  kind: 'account' as const,
  id: PRINCIPAL_ID,
  email: 'private@example.com',
  emailVerifiedAt: '2026-07-30T00:00:00.000Z',
};

const makeRequest = (path: string, body: unknown, extraHeaders: Record<string, string> = {}) => {
  const rawBody = JSON.stringify(body);
  return new Request(`http://127.0.0.1:3001${path}`, {
    method: 'POST',
    headers: {
      host: 'lash.example',
      origin: SITE_ORIGIN,
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
      'content-type': 'application/json; charset=utf-8',
      'x-forwarded-for': '203.0.113.4',
      ...extraHeaders,
    },
    body: rawBody,
  });
};

const makeSession = () => {
  const sink = createSupabaseResponseMutationSink({ getAll: () => [] });
  sink.adapter.setAll?.(
    [
      {
        name: 'sb-session',
        value: 'refreshed',
        options: { httpOnly: true, path: '/', sameSite: 'lax' },
      },
    ],
    { 'x-provider-session-applied': 'yes' },
  );
  return { client: {} as never, applyTo: sink.applyTo };
};

const json = (response: Response) => response.json() as Promise<Record<string, unknown>>;

describe('public comment list BFF', () => {
  it('lists anonymously with a server-derived rate key and no account lookup', async () => {
    const callWorker = vi.fn(async (_call: { request: PublicCommentListRequestV1 }) => ({
      kind: 'verified' as const,
      status: 200,
      result: {
        ok: true as const,
        version: 1 as const,
        authorization: {
          roomId: ROOM_ID,
          mode: 'comment' as const,
          policyVersion: 4,
          cutoffGeneration: 2,
        },
        comments: [],
        nextBeforeSequence: null,
      },
    }));
    const response = await handlePublicCommentList(
      makeRequest(`/api/public/documents/${ROOM_ID}/comments/list`, {
        version: 1,
        expectedPolicyVersion: 4,
        expectedCutoffGeneration: 2,
        beforeSequence: null,
      }) as never,
      { roomId: ROOM_ID },
      {
        loadConfig: () => config,
        callWorker,
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('vary')).toBe('Origin');
    expect(response.headers.get('cache-control')).toContain('private');
    expect(await json(response)).toEqual({
      ok: true,
      version: 1,
      authorization: {
        roomId: ROOM_ID,
        mode: 'comment',
        policyVersion: 4,
        cutoffGeneration: 2,
      },
      comments: [],
      nextBeforeSequence: null,
    });
    expect(callWorker).toHaveBeenCalledWith({
      workerOrigin: WORKER_ORIGIN,
      commentControlSecret: COMMENT_SECRET,
      action: 'list',
      request: {
        version: 1,
        roomId: ROOM_ID,
        expectedPolicyVersion: 4,
        expectedCutoffGeneration: 2,
        beforeSequence: null,
        limit: 50,
        rateKey: expect.stringMatching(/^rate-v1-[A-Za-z0-9_-]{43}$/u),
      },
    });
  });

  it('maps a verified public policy race and rate limit without forwarding Worker internals', async () => {
    for (const [workerError, expectedStatus, browserError] of [
      ['public-access-changed', 409, 'public-access-changed'],
      ['rate-limited', 429, 'rate-limited'],
    ] as const) {
      const response = await handlePublicCommentList(
        makeRequest(`/api/public/documents/${ROOM_ID}/comments/list`, {
          version: 1,
          expectedPolicyVersion: 4,
          expectedCutoffGeneration: 2,
          beforeSequence: null,
        }) as never,
        { roomId: ROOM_ID },
        {
          loadConfig: () => config,
          callWorker: async () => ({
            kind: 'verified',
            status: expectedStatus,
            result: {
              ok: false,
              version: 1,
              error: workerError,
              retryable: workerError === 'rate-limited',
            },
            ...(workerError === 'rate-limited' ? { retryAfter: 60 as const } : {}),
          }),
        },
      );
      expect(response.status).toBe(expectedStatus);
      expect(await json(response)).toEqual({
        ok: false,
        version: 1,
        error: browserError,
        retryable: workerError === 'rate-limited',
      });
      if (workerError === 'rate-limited') {
        expect(response.headers.get('retry-after')).toBe('60');
      }
    }
  });
});

describe('public comment account authoring session BFF', () => {
  it('returns a room-bound proof for a verified account and preserves provider cookie mutations', async () => {
    const response = await handlePublicCommentAuthoringSession(
      makeRequest(`/api/public/documents/${ROOM_ID}/comments/authoring-session`, {
        version: 1,
      }) as never,
      { roomId: ROOM_ID },
      {
        loadConfig: () => config,
        createSession: () => makeSession() as never,
        resolvePrincipal: async () => ({ status: 'authenticated', principal }),
        createCsrf: (input) => {
          let nonce = 0;
          return createPublicCommentCsrfSession({
            ...input,
            nowSeconds: 1_800_000_000,
            randomBytes: (size) => {
              nonce += 1;
              return Uint8Array.from({ length: size }, (_, index) => index + nonce);
            },
          });
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('vary')).toBe('Cookie, Origin');
    expect(response.headers.get('x-provider-session-applied')).toBe('yes');
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('sb-session=refreshed');
    expect(setCookie).toContain('lash-public-comment-csrf-session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie.toLowerCase()).toContain('samesite=strict');
    const body = await json(response);
    expect(body).toMatchObject({
      ok: true,
      version: 1,
      authenticated: true,
      csrfProof: expect.stringMatching(/^v1\.[A-Za-z0-9_-]{43}\.1800000600\.[A-Za-z0-9_-]{43}$/u),
      expiresAt: '2027-01-15T08:10:00.000Z',
    });
    expect(JSON.stringify(body)).not.toContain('private@example.com');
    expect(JSON.stringify(body)).not.toContain(PRINCIPAL_ID);
  });

  it('returns authenticated false and clears the Lash proof for anonymous or unverified sessions', async () => {
    for (const status of ['anonymous', 'invalid', 'unverified'] as const) {
      const response = await handlePublicCommentAuthoringSession(
        makeRequest(`/api/public/documents/${ROOM_ID}/comments/authoring-session`, {
          version: 1,
        }) as never,
        { roomId: ROOM_ID },
        {
          loadConfig: () => config,
          createSession: () => makeSession() as never,
          resolvePrincipal: async () => ({ status, principal: null }),
          createCsrf: () => {
            throw new Error('must not mint');
          },
        },
      );
      expect(response.status).toBe(200);
      expect(await json(response)).toEqual({
        ok: true,
        version: 1,
        authenticated: false,
      });
      expect(response.headers.get('set-cookie')).toContain('lash-public-comment-csrf-session=');
      expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    }
  });
});

describe('public comment create BFF', () => {
  it('re-resolves the verified account, verifies CSRF, and sends only a pseudonym to the Worker', async () => {
    let nonce = 0;
    const issued = createPublicCommentCsrfSession({
      roomId: ROOM_ID,
      principalId: PRINCIPAL_ID,
      principalKey: PRINCIPAL_KEY,
      nowSeconds: 1_800_000_000,
      randomBytes: (size) => {
        nonce += 1;
        return Uint8Array.from({ length: size }, (_, index) => index + nonce);
      },
    });
    const callWorker = vi.fn(async (_call: { request: PublicCommentCreateRequestV1 }) => ({
      kind: 'verified' as const,
      status: 201,
      result: {
        ok: true as const,
        version: 1 as const,
        created: true,
        authorization: {
          roomId: ROOM_ID,
          mode: 'comment' as const,
          policyVersion: 4,
          cutoffGeneration: 2,
        },
        comment: {
          id: COMMENT_ID,
          sequence: 7,
          anchor: { kind: 'document' as const },
          body: 'One calm comment.',
          author: { label: 'Commenter abc123' },
          createdAt: '2026-07-30T00:00:00.000Z',
        },
      },
    }));
    const response = await handlePublicCommentCreate(
      makeRequest(
        `/api/public/documents/${ROOM_ID}/comments/create`,
        {
          version: 1,
          mutationId: MUTATION_ID,
          expectedPolicyVersion: 4,
          expectedCutoffGeneration: 2,
          body: 'One calm comment.',
        },
        {
          cookie: `lash-public-comment-csrf-session=${issued.cookieValue}`,
          'x-lash-csrf-proof': issued.csrfProof,
        },
      ) as never,
      { roomId: ROOM_ID },
      {
        loadConfig: () => config,
        createSession: () => makeSession() as never,
        requirePrincipal: async () => principal,
        callWorker,
        nowSeconds: () => 1_800_000_001,
      },
    );

    expect(response.status).toBe(201);
    expect(response.headers.get('vary')).toBe('Cookie, Origin');
    expect(response.headers.get('x-provider-session-applied')).toBe('yes');
    const body = await json(response);
    expect(JSON.stringify(body)).not.toContain('private@example.com');
    expect(JSON.stringify(body)).not.toContain(PRINCIPAL_ID);
    expect(callWorker).toHaveBeenCalledWith({
      workerOrigin: WORKER_ORIGIN,
      commentControlSecret: COMMENT_SECRET,
      action: 'create',
      request: {
        version: 1,
        roomId: ROOM_ID,
        commenterPrincipalId: PRINCIPAL_ID,
        commenterAlias: expect.stringMatching(/^Commenter [A-Za-z0-9_-]{6}$/u),
        mutationId: MUTATION_ID,
        expectedPolicyVersion: 4,
        expectedCutoffGeneration: 2,
        body: 'One calm comment.',
      },
    });
  });

  it('rejects a missing proof before calling the Worker', async () => {
    const callWorker = vi.fn();
    const response = await handlePublicCommentCreate(
      makeRequest(`/api/public/documents/${ROOM_ID}/comments/create`, {
        version: 1,
        mutationId: MUTATION_ID,
        expectedPolicyVersion: 4,
        expectedCutoffGeneration: 2,
        body: 'One calm comment.',
      }) as never,
      { roomId: ROOM_ID },
      {
        loadConfig: () => config,
        createSession: () => makeSession() as never,
        requirePrincipal: async () => principal,
        callWorker,
        nowSeconds: () => 1_800_000_001,
      },
    );
    expect(response.status).toBe(403);
    expect(await json(response)).toEqual({
      ok: false,
      version: 1,
      error: 'invalid-request',
      retryable: false,
    });
    expect(callWorker).not.toHaveBeenCalled();

    const authenticationRequired = Object.assign(new Error('verified account required'), {
      code: 'verified-account-required',
    });
    const unauthenticatedResponse = await handlePublicCommentCreate(
      makeRequest(`/api/public/documents/${ROOM_ID}/comments/create`, {
        version: 1,
        mutationId: MUTATION_ID,
        expectedPolicyVersion: 4,
        expectedCutoffGeneration: 2,
        body: 'One calm comment.',
      }) as never,
      { roomId: ROOM_ID },
      {
        loadConfig: () => config,
        createSession: () => makeSession() as never,
        requirePrincipal: async () => {
          throw authenticationRequired;
        },
        callWorker,
        nowSeconds: () => 1_800_000_001,
      },
    );
    expect(unauthenticatedResponse.status).toBe(401);
    expect(await json(unauthenticatedResponse)).toEqual({
      ok: false,
      version: 1,
      error: 'authentication-required',
      retryable: false,
    });
  });
});

describe('public comment owner moderation BFF', () => {
  it('derives the ownership claim and returns a sanitized hidden receipt', async () => {
    const callModeration = vi.fn(async (_call: { request: PublicCommentModerationRequestV1 }) => ({
      kind: 'verified' as const,
      status: 200,
      result: {
        ok: true as const,
        version: 1 as const,
        claimId: CLAIM_ID,
        roomId: ROOM_ID,
        commentId: COMMENT_ID,
        state: 'hidden' as const,
        changed: true,
        policyVersion: 4,
        cutoffGeneration: 2,
        moderatedAt: '2026-07-30T00:00:00.000Z',
      },
    }));
    const response = await handlePublicCommentHide(
      makeRequest(`/api/documents/local-1/public-comments/${COMMENT_ID}/hide`, {
        version: 1,
        mutationId: MUTATION_ID,
        expectedPolicyVersion: 4,
        expectedCutoffGeneration: 2,
      }) as never,
      { localDocumentId: 'local-1', commentId: COMMENT_ID },
      {
        loadConfig: () => config,
        createSession: () => makeSession() as never,
        requirePrincipal: async () => principal,
        loadPromotionConfig: () => ({
          workerOrigin: WORKER_ORIGIN,
          controlSecret: CONTROL_SECRET,
          derivationKeys: [],
        }),
        deriveClaimId: () => CLAIM_ID,
        callModeration,
      },
    );

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      ok: true,
      version: 1,
      commentId: COMMENT_ID,
      state: 'hidden',
      changed: true,
      policyVersion: 4,
      cutoffGeneration: 2,
      moderatedAt: '2026-07-30T00:00:00.000Z',
    });
    expect(callModeration).toHaveBeenCalledWith({
      workerOrigin: WORKER_ORIGIN,
      controlSecret: CONTROL_SECRET,
      request: {
        version: 1,
        claimId: CLAIM_ID,
        ownerPrincipalId: PRINCIPAL_ID,
        localDocumentId: 'local-1',
        commentId: COMMENT_ID,
        action: 'hide',
        mutationId: MUTATION_ID,
        expectedPolicyVersion: 4,
        expectedCutoffGeneration: 2,
      },
    });
  });

  it.each([
    ['claim-not-found', 404, 'document-unavailable'],
    ['owner-mismatch', 404, 'document-unavailable'],
    ['policy-conflict', 409, 'public-access-changed'],
    ['replay-detected', 409, 'moderation-conflict'],
  ] as const)(
    'maps %s without exposing ownership details',
    async (workerError, status, browserError) => {
      const response = await handlePublicCommentHide(
        makeRequest(`/api/documents/local-1/public-comments/${COMMENT_ID}/hide`, {
          version: 1,
          mutationId: MUTATION_ID,
          expectedPolicyVersion: 4,
          expectedCutoffGeneration: 2,
        }) as never,
        { localDocumentId: 'local-1', commentId: COMMENT_ID },
        {
          loadConfig: () => config,
          createSession: () => makeSession() as never,
          requirePrincipal: async () => principal,
          loadPromotionConfig: () => ({
            workerOrigin: WORKER_ORIGIN,
            controlSecret: CONTROL_SECRET,
            derivationKeys: [],
          }),
          deriveClaimId: () => CLAIM_ID,
          callModeration: async () => ({
            kind: 'verified',
            status,
            result:
              workerError === 'policy-conflict'
                ? {
                    ok: false,
                    version: 1,
                    error: workerError,
                    retryable: false,
                    state: {
                      mode: 'read',
                      policyVersion: 5,
                      cutoffGeneration: 3,
                      publicPath: `/public/${ROOM_ID}`,
                    },
                  }
                : {
                    ok: false,
                    version: 1,
                    error: workerError,
                    retryable: false,
                  },
          }),
        },
      );
      expect(response.status).toBe(status);
      expect(await json(response)).toEqual({
        ok: false,
        version: 1,
        error: browserError,
        retryable: false,
      });
    },
  );
});
