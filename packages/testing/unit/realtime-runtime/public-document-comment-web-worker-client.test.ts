import { canonicalize } from '@lash/types';
import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  callWorkerPublicCommentModeration,
  callWorkerPublicComments,
} from '../../../../apps/web/lib/publicDocumentComments/workerClient';

const ROOM_ID = `doc-v1-${'a'.repeat(64)}`;
const CLAIM_ID = `claim-v1-${'b'.repeat(64)}`;
const PRINCIPAL_ID = `account:v1:${'p'.repeat(43)}`;
const COMMENT_ID = 'pc-v1-123e4567-e89b-42d3-a456-426614174000';
const MUTATION_ID = '123e4567-e89b-42d3-a456-426614174000';
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174001';
const RETRY_REQUEST_ID = '123e4567-e89b-42d3-a456-426614174002';
const NOW = new Date('2026-07-30T02:00:00.000Z');
const COMMENT_SECRET = 'comment-control-secret-current-at-least-32-bytes';
const CONTROL_SECRET = 'management-control-secret-current-at-least-32-bytes';

const dto = {
  id: COMMENT_ID,
  sequence: 7,
  anchor: { kind: 'document' as const },
  body: 'One calm comment.',
  author: { label: 'Commenter AbC123' },
  createdAt: '2026-07-30T02:00:00.000Z',
};

const listRequest = {
  version: 1 as const,
  roomId: ROOM_ID,
  expectedPolicyVersion: 4,
  expectedCutoffGeneration: 2,
  beforeSequence: null,
  limit: 50 as const,
  rateKey: `rate-v1-${'r'.repeat(43)}`,
};

const createRequest = {
  version: 1 as const,
  roomId: ROOM_ID,
  commenterPrincipalId: PRINCIPAL_ID,
  commenterAlias: 'Commenter AbC123',
  mutationId: MUTATION_ID,
  expectedPolicyVersion: 4,
  expectedCutoffGeneration: 2,
  body: 'One calm comment.',
};

const listSuccess = {
  ok: true as const,
  version: 1 as const,
  authorization: {
    roomId: ROOM_ID,
    mode: 'comment' as const,
    policyVersion: 4,
    cutoffGeneration: 2,
  },
  comments: [dto],
  nextBeforeSequence: null,
};

describe('public comment Worker client', () => {
  it('signs the exact anonymous list request without a principal header', async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      const path = `/api/public-comment-control/documents/${ROOM_ID}/comments/list`;
      const body = canonicalize(listRequest);
      const bodyHash = createHash('sha256').update(body, 'utf8').digest('base64url');
      const expiresAt = Math.floor(NOW.getTime() / 1_000) + 55;
      const canonical = [
        'lash-worker-public-comment:v1',
        'POST',
        path,
        'public-comment-list-v1',
        'lash-web-bff-v1',
        '-',
        bodyHash,
        REQUEST_ID,
        String(expiresAt),
      ].join('\n');
      const signature = createHmac('sha256', COMMENT_SECRET)
        .update(canonical, 'utf8')
        .digest('base64url');

      expect(url).toBe(`https://worker.example${path}`);
      expect(init).toMatchObject({
        method: 'POST',
        body,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'manual',
      });
      const headers = new Headers(init.headers);
      expect(headers.get('authorization')).toBe(`Lash-Public-Comment-Control v1:${signature}`);
      expect(headers.get('x-lash-control-audience')).toBe('public-comment-list-v1');
      expect(headers.get('x-lash-control-service-id')).toBe('lash-web-bff-v1');
      expect(headers.get('x-lash-control-body-sha256')).toBe(bodyHash);
      expect(headers.get('x-lash-control-request-id')).toBe(REQUEST_ID);
      expect(headers.get('x-lash-control-expires-at')).toBe(String(expiresAt));
      expect(headers.has('x-lash-control-principal-id')).toBe(false);
      return Response.json(listSuccess);
    });

    await expect(
      callWorkerPublicComments(
        {
          action: 'list',
          workerOrigin: 'https://worker.example',
          commentControlSecret: COMMENT_SECRET,
          request: listRequest,
        },
        {
          fetchImpl: fetchImpl as never,
          now: () => NOW,
          randomUUID: () => REQUEST_ID,
        },
      ),
    ).resolves.toEqual({ kind: 'verified', status: 200, result: listSuccess });
  });

  it('retries one verified transport replay with the same mutation body and a fresh request id', async () => {
    const bodies: string[] = [];
    const requestIds: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      requestIds.push(new Headers(init.headers).get('x-lash-control-request-id') ?? '');
      if (requestIds.length === 1) {
        return Response.json(
          {
            ok: false,
            version: 1,
            error: 'replay-detected',
            retryable: false,
          },
          { status: 409 },
        );
      }
      return Response.json(
        {
          ok: true,
          version: 1,
          created: true,
          authorization: listSuccess.authorization,
          comment: dto,
        },
        { status: 201 },
      );
    });
    const ids = [REQUEST_ID, RETRY_REQUEST_ID];

    await expect(
      callWorkerPublicComments(
        {
          action: 'create',
          workerOrigin: 'https://worker.example',
          commentControlSecret: COMMENT_SECRET,
          request: createRequest,
        },
        {
          fetchImpl: fetchImpl as never,
          now: () => NOW,
          randomUUID: () => ids.shift() ?? '',
        },
      ),
    ).resolves.toMatchObject({
      kind: 'verified',
      status: 201,
      result: { ok: true, created: true },
    });
    expect(bodies).toEqual([canonicalize(createRequest), canonicalize(createRequest)]);
    expect(requestIds).toEqual([REQUEST_ID, RETRY_REQUEST_ID]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects status/body mismatches and identity-bearing DTO additions', async () => {
    for (const response of [
      Response.json(listSuccess, { status: 201 }),
      Response.json({
        ...listSuccess,
        comments: [{ ...dto, principalId: PRINCIPAL_ID }],
      }),
      Response.json(
        { ok: false, version: 1, error: 'rate-limited', retryable: false },
        { status: 429 },
      ),
    ]) {
      await expect(
        callWorkerPublicComments(
          {
            action: 'list',
            workerOrigin: 'https://worker.example',
            commentControlSecret: COMMENT_SECRET,
            request: listRequest,
          },
          {
            fetchImpl: vi.fn().mockResolvedValue(response) as never,
            now: () => NOW,
            randomUUID: () => REQUEST_ID,
          },
        ),
      ).resolves.toEqual({ kind: 'unverified-failure' });
    }
  });
});

describe('public comment moderation Worker client', () => {
  it('uses the existing Lash-Control v2 claim boundary and parses exact success', async () => {
    const request = {
      version: 1 as const,
      claimId: CLAIM_ID,
      ownerPrincipalId: PRINCIPAL_ID,
      localDocumentId: 'local-document',
      commentId: COMMENT_ID,
      action: 'hide' as const,
      mutationId: MUTATION_ID,
      expectedPolicyVersion: 4,
      expectedCutoffGeneration: 2,
    };
    const success = {
      ok: true as const,
      version: 1 as const,
      claimId: CLAIM_ID,
      roomId: ROOM_ID,
      commentId: COMMENT_ID,
      state: 'hidden' as const,
      changed: true,
      policyVersion: 4,
      cutoffGeneration: 2,
      moderatedAt: '2026-07-30T02:00:00.000Z',
    };
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      const path = `/api/management/document-claims/${CLAIM_ID}/public-comments/moderate`;
      const body = canonicalize(request);
      const bodyHash = createHash('sha256').update(body, 'utf8').digest('base64url');
      const expiresAt = Math.floor(NOW.getTime() / 1_000) + 55;
      const signature = createHmac('sha256', CONTROL_SECRET)
        .update(
          [
            'lash-worker-control:v2',
            'POST',
            path,
            bodyHash,
            REQUEST_ID,
            PRINCIPAL_ID,
            String(expiresAt),
          ].join('\n'),
          'utf8',
        )
        .digest('base64url');
      const headers = new Headers(init.headers);
      expect(url).toBe(`https://worker.example${path}`);
      expect(headers.get('authorization')).toBe(`Lash-Control v2:${signature}`);
      expect(headers.get('x-lash-control-principal-id')).toBe(PRINCIPAL_ID);
      return Response.json(success);
    });

    await expect(
      callWorkerPublicCommentModeration(
        {
          workerOrigin: 'https://worker.example',
          controlSecret: CONTROL_SECRET,
          request,
        },
        {
          fetchImpl: fetchImpl as never,
          now: () => NOW,
          randomUUID: () => REQUEST_ID,
        },
      ),
    ).resolves.toEqual({ kind: 'verified', status: 200, result: success });

    await expect(
      callWorkerPublicCommentModeration(
        {
          workerOrigin: 'https://worker.example',
          controlSecret: CONTROL_SECRET,
          request,
        },
        {
          fetchImpl: vi
            .fn()
            .mockResolvedValue(Response.json({ ...success, policyVersion: 5 })) as never,
          now: () => NOW,
          randomUUID: () => REQUEST_ID,
        },
      ),
    ).resolves.toEqual({ kind: 'unverified-failure' });
  });
});
