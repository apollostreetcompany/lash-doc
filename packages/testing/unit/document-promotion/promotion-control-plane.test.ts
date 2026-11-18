import {
  canonicalize,
  type DocumentClaimPromotionRequestV2,
  type DocumentPromotionSnapshotV1,
} from '@lash/types';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  promoteDocumentSnapshot,
  type PromotionControlPlaneDependencies,
} from '../../../../apps/web/lib/documentPromotion/controlPlane';
import {
  callWorkerPromotion,
  type WorkerPromotionCall,
} from '../../../../apps/web/lib/documentPromotion/workerClient';

const PRINCIPAL_ID = `account:v1:${'a'.repeat(43)}`;
const CLAIM_ID = `claim-v1-${'d'.repeat(64)}`;
const CURRENT_ROOM_ID = `doc-v2-${'b'.repeat(64)}`;
const RETAINED_ROOM_ID = `doc-v1-${'e'.repeat(64)}`;
const ALIASED_ROOM_ID = `doc-v0-${'f'.repeat(64)}`;
const HASH = 'c'.repeat(43);
const SECRET = 'current-control-secret-with-at-least-32-bytes';

const snapshot: DocumentPromotionSnapshotV1 = {
  version: 1,
  title: 'Weekly plan',
  body: { type: 'doc' },
  bodySha256: HASH,
  initialUpdate: 'AAA=',
  initialUpdateSha256: HASH,
  adjuncts: { comments: 0, suggestions: 0 },
  snapshotSha256: HASH,
};

const promotionRequest = (): DocumentClaimPromotionRequestV2 => ({
  version: 2,
  claimId: CLAIM_ID,
  ownerPrincipalId: PRINCIPAL_ID,
  localDocumentId: 'weekly-plan',
  idempotencyHash: HASH,
  candidates: [
    { kind: 'current', derivationVersion: 'v2', roomId: CURRENT_ROOM_ID },
    { kind: 'retained', derivationVersion: 'v1', roomId: RETAINED_ROOM_ID },
  ],
  snapshot,
});

const success = (roomId = CURRENT_ROOM_ID) => ({
  ok: true as const,
  version: 2 as const,
  claimId: CLAIM_ID,
  roomId,
  ownerPrincipalId: PRINCIPAL_ID,
  aclVersion: 1 as const,
  publicPolicy: 'restricted' as const,
  publicPolicyVersion: 1 as const,
  snapshotSha256: HASH,
  created: false,
});

describe('Worker promotion client', () => {
  it('signs the exact v2 claim body and sends no browser credentials', async () => {
    const requestId = randomUUID();
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      const body = String(init.body);
      const headers = new Headers(init.headers);
      const pathname = new URL(url).pathname;
      const bodySha256 = createHash('sha256').update(body).digest('base64url');
      const expiresAt = headers.get('x-lash-control-expires-at');
      const expectedSignature = createHmac('sha256', SECRET)
        .update(
          [
            'lash-worker-control:v2',
            'POST',
            pathname,
            bodySha256,
            requestId,
            PRINCIPAL_ID,
            expiresAt,
          ].join('\n'),
        )
        .digest('base64url');

      expect(pathname).toBe(`/api/management/document-claims/${CLAIM_ID}/promote`);
      expect(body).toBe(canonicalize(promotionRequest()));
      expect(headers.get('authorization')).toBe(`Lash-Control v2:${expectedSignature}`);
      expect(headers.get('x-lash-control-body-sha256')).toBe(bodySha256);
      expect(headers.get('x-lash-control-request-id')).toBe(requestId);
      expect(headers.get('x-lash-control-principal-id')).toBe(PRINCIPAL_ID);
      expect(init.credentials).toBe('omit');
      expect(init.redirect).toBe('manual');
      expect(init.cache).toBe('no-store');
      return new Response(JSON.stringify(success()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const result = await callWorkerPromotion(
      {
        workerOrigin: 'https://worker.example',
        controlSecret: SECRET,
        request: promotionRequest(),
      },
      {
        fetchImpl: fetchImpl as never,
        now: () => new Date('2026-07-30T00:00:00.000Z'),
        randomUUID: () => requestId,
      },
    );

    expect(result).toEqual(success());
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    {
      status: 400,
      result: { ok: false, version: 2, error: 'invalid-request', retryable: false },
    },
    {
      status: 400,
      result: { ok: false, version: 2, error: 'upgrade-required', retryable: false },
    },
    {
      status: 401,
      result: { ok: false, version: 2, error: 'unauthorized', retryable: false },
    },
    {
      status: 404,
      result: { ok: false, version: 2, error: 'promotion-not-found', retryable: false },
    },
    {
      status: 409,
      result: { ok: false, version: 2, error: 'replay-detected', retryable: false },
    },
    {
      status: 409,
      result: { ok: false, version: 2, error: 'owner-mismatch', retryable: false },
    },
    {
      status: 409,
      result: { ok: false, version: 2, error: 'promotion-conflict', retryable: false },
    },
    {
      status: 409,
      result: { ok: false, version: 2, error: 'claim-conflict', retryable: false },
    },
    {
      status: 503,
      result: { ok: false, version: 2, error: 'promotion-disabled', retryable: false },
    },
    {
      status: 500,
      result: { ok: false, version: 2, error: 'readback-failed', retryable: true },
    },
    {
      status: 500,
      result: { ok: false, version: 2, error: 'internal-error', retryable: true },
    },
  ])('accepts the exact $status Worker status/result pair', async ({ status, result }) => {
    const actual = await callWorkerPromotion(
      {
        workerOrigin: 'https://worker.example',
        controlSecret: SECRET,
        request: promotionRequest(),
      },
      {
        fetchImpl: vi.fn().mockResolvedValue(
          new Response(JSON.stringify(result), {
            status,
            headers: { 'content-type': 'application/json' },
          }),
        ),
        now: () => new Date(),
        randomUUID,
      },
    );
    expect(actual).toEqual(result);
  });

  it.each([ALIASED_ROOM_ID, `doc-v99999999-${'f'.repeat(64)}`])(
    'accepts an exact aliased room after its retained derivation key has been removed',
    async (aliasedRoomId) => {
      const aliasedSuccess = success(aliasedRoomId);
      const actual = await callWorkerPromotion(
        {
          workerOrigin: 'https://worker.example',
          controlSecret: SECRET,
          request: promotionRequest(),
        },
        {
          fetchImpl: vi.fn().mockResolvedValue(
            new Response(JSON.stringify(aliasedSuccess), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          ),
          now: () => new Date(),
          randomUUID,
        },
      );

      expect(promotionRequest().candidates.map(({ roomId }) => roomId)).not.toContain(
        aliasedRoomId,
      );
      expect(actual).toEqual(aliasedSuccess);
    },
  );

  it.each([
    ['claim', { claimId: `claim-v1-${'f'.repeat(64)}` }],
    ['principal', { ownerPrincipalId: `account:v1:${'z'.repeat(43)}` }],
    ['snapshot', { snapshotSha256: 'z'.repeat(43) }],
    ['policy', { publicPolicy: 'public-comment' }],
    ['room normalization', { roomId: `doc-v0-${'F'.repeat(64)}` }],
    ['room version padding', { roomId: `doc-v01-${'f'.repeat(64)}` }],
    ['room version bound', { roomId: `doc-v123456789-${'f'.repeat(64)}` }],
    ['room digest length', { roomId: `doc-v0-${'f'.repeat(63)}` }],
    ['room digest alphabet', { roomId: `doc-v0-${'g'.repeat(64)}` }],
    ['room syntax', { roomId: 'doc-v0-not-a-sha256-base64url-room' }],
  ])('rejects a success with a wrong %s', async (_label, mutation) => {
    const actual = await callWorkerPromotion(
      {
        workerOrigin: 'https://worker.example',
        controlSecret: SECRET,
        request: promotionRequest(),
      },
      {
        fetchImpl: vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ ...success(ALIASED_ROOM_ID), ...mutation }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
        now: () => new Date(),
        randomUUID,
      },
    );

    expect(actual).toEqual({
      ok: false,
      version: 2,
      error: 'internal-error',
      retryable: true,
    });
  });

  it.each([
    ['redirect', new Response(null, { status: 302 })],
    [
      'wrong status/result',
      new Response(JSON.stringify(success()), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    ],
    [
      'unknown response field',
      new Response(JSON.stringify({ ...success(), email: 'private@example.com' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ],
  ])('fails retryably for a %s Worker response', async (_label, response) => {
    const actual = await callWorkerPromotion(
      {
        workerOrigin: 'https://worker.example',
        controlSecret: SECRET,
        request: promotionRequest(),
      },
      {
        fetchImpl: vi.fn().mockResolvedValue(response),
        now: () => new Date(),
        randomUUID,
      },
    );
    expect(actual).toEqual({
      ok: false,
      version: 2,
      error: 'internal-error',
      retryable: true,
    });
  });

  it('uses a fresh lowercase UUIDv4 for each call while retaining the claim and idempotency hash', async () => {
    const requestIds = [
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb',
    ];
    const observed: Array<{
      claimId: string;
      idempotencyHash: string;
      requestId: string | null;
    }> = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body)) as {
        claimId: string;
        idempotencyHash: string;
      };
      observed.push({
        claimId: request.claimId,
        idempotencyHash: request.idempotencyHash,
        requestId: new Headers(init.headers).get('x-lash-control-request-id'),
      });
      return new Response(JSON.stringify(success()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    let index = 0;
    const call: WorkerPromotionCall = {
      workerOrigin: 'https://worker.example',
      controlSecret: SECRET,
      request: promotionRequest(),
    };

    await callWorkerPromotion(call, {
      fetchImpl: fetchImpl as never,
      now: () => new Date(),
      randomUUID: () => requestIds[index++]!,
    });
    await callWorkerPromotion(call, {
      fetchImpl: fetchImpl as never,
      now: () => new Date(),
      randomUUID: () => requestIds[index++]!,
    });

    expect(observed).toEqual([
      { claimId: CLAIM_ID, idempotencyHash: HASH, requestId: requestIds[0] },
      { claimId: CLAIM_ID, idempotencyHash: HASH, requestId: requestIds[1] },
    ]);
  });

  it('aborts a timed-out Worker call and reports a retryable internal failure', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );
    const result = await callWorkerPromotion(
      {
        workerOrigin: 'https://worker.example',
        controlSecret: SECRET,
        request: promotionRequest(),
      },
      {
        fetchImpl: fetchImpl as never,
        now: () => new Date(),
        randomUUID,
        timeoutMs: 1,
      },
    );

    expect(result).toEqual({
      ok: false,
      version: 2,
      error: 'internal-error',
      retryable: true,
    });
  });

  it('cancels an oversized streaming Worker response', async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(33 * 1024));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
    const result = await callWorkerPromotion(
      {
        workerOrigin: 'https://worker.example',
        controlSecret: SECRET,
        request: promotionRequest(),
      },
      {
        fetchImpl: vi.fn().mockResolvedValue(response),
        now: () => new Date(),
        randomUUID,
      },
    );

    expect(cancelled).toBe(true);
    expect(result).toEqual({
      ok: false,
      version: 2,
      error: 'internal-error',
      retryable: true,
    });
  });
});

describe('promotion key rotation orchestration', () => {
  const dependencies = (
    callWorker: PromotionControlPlaneDependencies['callWorker'],
  ): PromotionControlPlaneDependencies => ({
    callWorker,
    deriveClaimId: () => CLAIM_ID,
    deriveRoomId: (version) =>
      version === 'v2' ? CURRENT_ROOM_ID : `doc-${version}-${'e'.repeat(64)}`,
  });

  it('submits all candidates current-first in one atomic claim call', async () => {
    const calls: WorkerPromotionCall[] = [];
    const callWorker = vi.fn(async (call: WorkerPromotionCall) => {
      calls.push(call);
      return success(RETAINED_ROOM_ID);
    });

    const result = await promoteDocumentSnapshot(
      {
        workerOrigin: 'https://worker.example',
        controlSecret: SECRET,
        derivationKeys: [
          { version: 'v2', key: Buffer.alloc(32, 2) },
          { version: 'v1', key: Buffer.alloc(32, 1) },
          { version: 'v0', key: Buffer.alloc(32, 0) },
        ],
        principalId: PRINCIPAL_ID,
        localDocumentId: 'weekly-plan',
        idempotencyHash: HASH,
        snapshot,
      },
      dependencies(callWorker),
    );

    expect(result).toEqual(success(RETAINED_ROOM_ID));
    expect(callWorker).toHaveBeenCalledOnce();
    expect(calls[0]?.request).toEqual({
      version: 2,
      claimId: CLAIM_ID,
      ownerPrincipalId: PRINCIPAL_ID,
      localDocumentId: 'weekly-plan',
      idempotencyHash: HASH,
      candidates: [
        { kind: 'current', derivationVersion: 'v2', roomId: CURRENT_ROOM_ID },
        { kind: 'retained', derivationVersion: 'v1', roomId: RETAINED_ROOM_ID },
        {
          kind: 'retained',
          derivationVersion: 'v0',
          roomId: `doc-v0-${'e'.repeat(64)}`,
        },
      ],
      snapshot,
    });
  });

  it('returns the coordinator terminal result without a v1 fallback', async () => {
    const terminal = {
      ok: false as const,
      version: 2 as const,
      error: 'claim-conflict' as const,
      retryable: false as const,
    };
    const callWorker = vi.fn().mockResolvedValue(terminal);
    const result = await promoteDocumentSnapshot(
      {
        workerOrigin: 'https://worker.example',
        controlSecret: SECRET,
        derivationKeys: [
          { version: 'v2', key: Buffer.alloc(32, 2) },
          { version: 'v1', key: Buffer.alloc(32, 1) },
        ],
        principalId: PRINCIPAL_ID,
        localDocumentId: 'weekly-plan',
        idempotencyHash: HASH,
        snapshot,
      },
      dependencies(callWorker),
    );

    expect(result).toEqual(terminal);
    expect(callWorker).toHaveBeenCalledOnce();
  });
});
