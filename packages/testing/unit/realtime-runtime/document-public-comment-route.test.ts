import { describe, expect, it, vi } from 'vitest';

import {
  PUBLIC_COMMENT_ASSERTION_DOMAIN,
  PUBLIC_COMMENT_CREATE_AUDIENCE,
  PUBLIC_COMMENT_LIST_AUDIENCE,
} from '../../../realtime-worker/src/publicCommentAuth';
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

const ROOM_ID = `doc-v1-${'a'.repeat(64)}`;
const PRINCIPAL = `account:v1:${'p'.repeat(43)}`;
const SECRET = 'public-comment-route-secret-at-least-32-bytes';
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';

const base64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
};

const signedRequest = async (action: 'list' | 'create', bodyValue: object) => {
  const path = `/api/public-comment-control/documents/${ROOM_ID}/comments/${action}`;
  const audience =
    action === 'list' ? PUBLIC_COMMENT_LIST_AUDIENCE : PUBLIC_COMMENT_CREATE_AUDIENCE;
  const body = JSON.stringify(bodyValue);
  const bodySha256 = base64Url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))),
  );
  const expiresAt = Math.floor(Date.now() / 1_000) + 30;
  const canonical = [
    PUBLIC_COMMENT_ASSERTION_DOMAIN,
    'POST',
    path,
    audience,
    'lash-web-bff-v1',
    action === 'create' ? PRINCIPAL : '-',
    bodySha256,
    REQUEST_ID,
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
  return new Request(`https://worker.test${path}`, {
    method: 'POST',
    headers: {
      authorization: `Lash-Public-Comment-Control v1:${signature}`,
      'content-type': 'application/json',
      'x-lash-control-audience': audience,
      'x-lash-control-service-id': 'lash-web-bff-v1',
      'x-lash-control-body-sha256': bodySha256,
      'x-lash-control-request-id': REQUEST_ID,
      'x-lash-control-expires-at': String(expiresAt),
      ...(action === 'create' ? { 'x-lash-control-principal-id': PRINCIPAL } : {}),
    },
    body,
  });
};

const listBody = {
  version: 1,
  roomId: ROOM_ID,
  expectedPolicyVersion: 3,
  expectedCutoffGeneration: 2,
  beforeSequence: null,
  limit: 50,
  rateKey: `rate-v1-${'r'.repeat(43)}`,
};

const createBody = {
  version: 1,
  roomId: ROOM_ID,
  commenterPrincipalId: PRINCIPAL,
  commenterAlias: 'Commenter A1b_2-',
  mutationId: '223e4567-e89b-42d3-a456-426614174000',
  expectedPolicyVersion: 3,
  expectedCutoffGeneration: 2,
  body: 'Public note',
};

const environment = (roomFetch: ReturnType<typeof vi.fn>) =>
  ({
    LASH_PUBLIC_COMMENT_ACCESS_PHASE: 'enabled',
    LASH_WORKER_PUBLIC_COMMENT_SECRET_CURRENT: SECRET,
    LASH_PUBLIC_COMMENT_ROOM_ALLOWLIST: ROOM_ID,
    LASH_PUBLIC_READ_ROOM_ALLOWLIST: ROOM_ID,
    LASH_REALTIME_ROOM: { getByName: vi.fn(() => ({ fetch: roomFetch })) },
  }) as never;

describe('public comment Worker route', () => {
  it('recognizes only exact raw list/create paths', () => {
    for (const action of ['list', 'create'] as const) {
      const path = `/api/public-comment-control/documents/${ROOM_ID}/comments/${action}`;
      expect(parseRealtimeRoute(new URL(`https://worker.test${path}`))).toEqual({
        kind: 'public-comment-control',
        roomId: ROOM_ID,
        action,
      });
      expect(parseRealtimeRoute(new URL(`https://worker.test${path}/`))).toEqual({
        kind: 'not-found',
      });
    }
  });

  it.each([
    ['list', listBody, 200],
    ['create', createBody, 201],
  ] as const)(
    'authenticates and forwards exact %s wrapper without CORS',
    async (action, body, status) => {
      const roomFetch = vi.fn(async (request: Request) => {
        expect(new URL(request.url).pathname).toBe(`/__lash-room/public-comments/${action}`);
        expect(request.headers.get('x-lash-internal-management')).toBe('public-comment-v1');
        const wrapper = (await request.json()) as Record<string, unknown>;
        expect(wrapper).toMatchObject({
          version: 1,
          requestId: REQUEST_ID,
          publicComment: body,
        });
        const authorization = {
          roomId: ROOM_ID,
          mode: 'comment',
          policyVersion: 3,
          cutoffGeneration: 2,
        };
        return Response.json(
          action === 'list'
            ? {
                ok: true,
                version: 1,
                authorization,
                comments: [],
                nextBeforeSequence: null,
              }
            : {
                ok: true,
                version: 1,
                created: true,
                authorization,
                comment: {
                  id: 'pc-v1-323e4567-e89b-42d3-a456-426614174000',
                  sequence: 1,
                  anchor: { kind: 'document' },
                  body: 'Public note',
                  author: { label: 'Commenter A1b_2-' },
                  createdAt: '2026-07-30T00:00:00.000Z',
                },
              },
          { status },
        );
      });
      const worker = (await import('../../../realtime-worker/src/index')).default;
      const response = await worker.fetch(
        await signedRequest(action, body),
        environment(roomFetch),
      );
      expect(response.status).toBe(status);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    },
  );

  it('fails closed with the distinct disabled response before room dispatch', async () => {
    const worker = (await import('../../../realtime-worker/src/index')).default;
    const roomFetch = vi.fn();
    const response = await worker.fetch(await signedRequest('list', listBody), {
      ...environment(roomFetch),
      LASH_PUBLIC_COMMENT_ACCESS_PHASE: 'disabled',
    } as never);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      version: 1,
      error: 'public-comment-disabled',
      retryable: false,
    });
    expect(roomFetch).not.toHaveBeenCalled();
  });
});
