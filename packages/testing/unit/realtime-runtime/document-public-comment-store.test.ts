import { describe, expect, it } from 'vitest';

import type {
  PublicCommentAuthority,
  PublicCommentModerationReceipt,
  PublicCommentModerationStore,
  PublicCommentStore,
  StoredPublicCommentV1,
} from '../../../realtime-worker/src/publicComment';
import {
  createPublicComment,
  listPublicComments,
  moderatePublicComment,
} from '../../../realtime-worker/src/publicComment';

const ROOM_ID = `doc-v1-${'a'.repeat(64)}`;
const PRINCIPAL = `account:v1:${'p'.repeat(43)}`;
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const MUTATION_ID = '223e4567-e89b-42d3-a456-426614174000';
const COMMENT_ID = '323e4567-e89b-42d3-a456-426614174000';

const makeStore = () => {
  let authority: PublicCommentAuthority = {
    roomId: ROOM_ID,
    shareable: true,
    mode: 'comment',
    policyVersion: 3,
    cutoffGeneration: 2,
  };
  const requests = new Set<string>();
  const comments: StoredPublicCommentV1[] = [];
  const audits: unknown[] = [];
  const moderationReceipts = new Map<string, PublicCommentModerationReceipt>();
  let sequence = 0;
  let listRate = { rateKeyMinute: 1, roomMinute: 1 };
  let createRate = { principalMinute: 1, principalDay: 1, roomHour: 1 };
  const store: PublicCommentStore & PublicCommentModerationStore = {
    transaction: (callback) => callback(),
    hasTransportRequest: (requestId) => requests.has(requestId),
    recordTransportRequest: (requestId) => void requests.add(requestId),
    readAuthority: () => authority,
    incrementListRate: () => listRate,
    incrementCreateRate: () => createRate,
    readCommentByMutation: (mutationId) =>
      comments.find((comment) => comment.mutationId === mutationId) ?? null,
    readCommentById: (commentId) => comments.find((comment) => comment.id === commentId) ?? null,
    insertComment: (comment) => void comments.push({ ...comment, sequence: ++sequence }),
    listVisibleComments: (before, limit) =>
      comments
        .filter(
          (comment) =>
            comment.visibility === 'visible' && (before === null || comment.sequence < before),
        )
        .sort((left, right) => right.sequence - left.sequence)
        .slice(0, limit),
    recordCreateAudit: (input) => void audits.push(input),
    readModerationAuthority: () => ({
      ...authority,
      ownerPrincipalId: `account:v1:${'o'.repeat(43)}`,
    }),
    readModeration: (mutationId) => moderationReceipts.get(mutationId) ?? null,
    hideComment: (commentId, ownerPrincipalId, hiddenAt) => {
      const comment = comments.find((candidate) => candidate.id === commentId);
      if (!comment || comment.visibility !== 'visible') return false;
      comment.visibility = 'hidden';
      comment.hiddenAt = hiddenAt;
      comment.hiddenByPrincipalId = ownerPrincipalId;
      return true;
    },
    createModeration: (receipt) => void moderationReceipts.set(receipt.mutationId, receipt),
    recordHideAudit: (input) => void audits.push(input),
  };
  return {
    store,
    comments,
    audits,
    setAuthority: (next: PublicCommentAuthority) => {
      authority = next;
    },
    setListRate: (next: typeof listRate) => {
      listRate = next;
    },
    setCreateRate: (next: typeof createRate) => {
      createRate = next;
    },
  };
};

const createRequest = {
  version: 1 as const,
  roomId: ROOM_ID,
  commenterPrincipalId: PRINCIPAL,
  commenterAlias: 'Commenter A1b_2-',
  mutationId: MUTATION_ID,
  expectedPolicyVersion: 3,
  expectedCutoffGeneration: 2,
  body: 'Public note',
};

const createThenReplay = (authority: PublicCommentAuthority, replayBodySha256 = 'b'.repeat(43)) => {
  const harness = makeStore();
  const first = createPublicComment({
    store: harness.store,
    request: createRequest,
    requestId: REQUEST_ID,
    bodySha256: 'b'.repeat(43),
    nowMs: Date.parse('2026-07-30T00:00:00.000Z'),
    randomUUID: () => COMMENT_ID,
  });
  expect(first.status).toBe(201);
  harness.setAuthority(authority);
  return createPublicComment({
    store: harness.store,
    request: createRequest,
    requestId: '423e4567-e89b-42d3-a456-426614174000',
    bodySha256: replayBodySha256,
    nowMs: Date.parse('2026-07-30T00:01:00.000Z'),
    randomUUID: () => crypto.randomUUID(),
  });
};

describe('public comment persistent domain', () => {
  it('creates, filters its DTO, and exactly replays a mutation under the same authority tuple', () => {
    const harness = makeStore();
    const first = createPublicComment({
      store: harness.store,
      request: createRequest,
      requestId: REQUEST_ID,
      bodySha256: 'b'.repeat(43),
      nowMs: Date.parse('2026-07-30T00:00:00.000Z'),
      randomUUID: () => COMMENT_ID,
    });
    expect(first.status).toBe(201);
    expect(first.result).toEqual({
      ok: true,
      version: 1,
      created: true,
      authorization: {
        roomId: ROOM_ID,
        mode: 'comment',
        policyVersion: 3,
        cutoffGeneration: 2,
      },
      comment: {
        id: `pc-v1-${COMMENT_ID}`,
        sequence: 1,
        anchor: { kind: 'document' },
        body: 'Public note',
        author: { label: 'Commenter A1b_2-' },
        createdAt: '2026-07-30T00:00:00.000Z',
      },
    });
    expect(JSON.stringify(first.result)).not.toMatch(/principal|mutation|visibility|hidden/iu);
    expect(JSON.stringify(harness.audits)).not.toContain('Public note');

    const replay = createPublicComment({
      store: harness.store,
      request: createRequest,
      requestId: '423e4567-e89b-42d3-a456-426614174000',
      bodySha256: 'b'.repeat(43),
      nowMs: Date.parse('2026-07-30T00:01:00.000Z'),
      randomUUID: () => crypto.randomUUID(),
    });
    expect(replay.status).toBe(200);
    expect(replay.result).toMatchObject({ ok: true, created: false });
  });

  it('rejects an exact mutation replay after authority changes to Read', () => {
    expect(
      createThenReplay({
        roomId: ROOM_ID,
        shareable: true,
        mode: 'read',
        policyVersion: 3,
        cutoffGeneration: 2,
      }),
    ).toEqual({
      status: 409,
      result: {
        ok: false,
        version: 1,
        error: 'public-access-changed',
        retryable: false,
      },
    });
  });

  it('rejects an exact mutation replay after authority changes to Restricted', () => {
    expect(
      createThenReplay({
        roomId: ROOM_ID,
        shareable: true,
        mode: 'restricted',
        policyVersion: 3,
        cutoffGeneration: 2,
      }),
    ).toEqual({
      status: 409,
      result: {
        ok: false,
        version: 1,
        error: 'public-access-changed',
        retryable: false,
      },
    });
  });

  it('rejects an exact mutation replay after policy-version drift', () => {
    expect(
      createThenReplay({
        roomId: ROOM_ID,
        shareable: true,
        mode: 'comment',
        policyVersion: 4,
        cutoffGeneration: 2,
      }),
    ).toEqual({
      status: 409,
      result: {
        ok: false,
        version: 1,
        error: 'public-access-changed',
        retryable: false,
      },
    });
  });

  it('rejects an exact mutation replay after cutoff drift', () => {
    expect(
      createThenReplay({
        roomId: ROOM_ID,
        shareable: true,
        mode: 'comment',
        policyVersion: 3,
        cutoffGeneration: 3,
      }),
    ).toEqual({
      status: 409,
      result: {
        ok: false,
        version: 1,
        error: 'public-access-changed',
        retryable: false,
      },
    });
  });

  it('preserves idempotency-conflict detection before replay authority success', () => {
    const conflict = createThenReplay(
      {
        roomId: ROOM_ID,
        shareable: true,
        mode: 'read',
        policyVersion: 4,
        cutoffGeneration: 3,
      },
      'c'.repeat(43),
    );
    expect(conflict).toEqual({
      status: 409,
      result: {
        ok: false,
        version: 1,
        error: 'idempotency-conflict',
        retryable: false,
      },
    });
  });

  it('collapses stale/read/restricted authority and separates transport from mutation replay', () => {
    const harness = makeStore();
    harness.setAuthority({ ...harness.store.readAuthority()!, mode: 'read' });
    const denied = createPublicComment({
      store: harness.store,
      request: createRequest,
      requestId: REQUEST_ID,
      bodySha256: 'b'.repeat(43),
      nowMs: 1,
      randomUUID: () => COMMENT_ID,
    });
    expect(denied).toMatchObject({
      status: 409,
      result: { error: 'public-access-changed' },
    });
    const transportReplay = createPublicComment({
      store: harness.store,
      request: createRequest,
      requestId: REQUEST_ID,
      bodySha256: 'b'.repeat(43),
      nowMs: 2,
      randomUUID: () => COMMENT_ID,
    });
    expect(transportReplay).toMatchObject({
      status: 409,
      result: { error: 'replay-detected' },
    });
  });

  it('lists latest visible rows ascending, pages backward, and enforces persistent rates', () => {
    const harness = makeStore();
    for (let index = 0; index < 52; index += 1) {
      harness.store.insertComment({
        id: `pc-v1-${COMMENT_ID.slice(0, -2)}${String(index).padStart(2, '0')}`,
        roomId: ROOM_ID,
        authorPrincipalId: PRINCIPAL,
        authorAlias: 'Commenter A1b_2-',
        mutationId: `${MUTATION_ID}-${index}`,
        mutationBodySha256: 'b'.repeat(43),
        body: `Note ${index}`,
        policyVersion: 3,
        cutoffGeneration: 2,
        createdAt: '2026-07-30T00:00:00.000Z',
        visibility: index === 51 ? 'hidden' : 'visible',
        hiddenAt: null,
        hiddenByPrincipalId: null,
      });
    }
    const listed = listPublicComments({
      store: harness.store,
      request: {
        version: 1,
        roomId: ROOM_ID,
        expectedPolicyVersion: 3,
        expectedCutoffGeneration: 2,
        beforeSequence: null,
        limit: 50,
        rateKey: `rate-v1-${'r'.repeat(43)}`,
      },
      requestId: REQUEST_ID,
      bodySha256: 'l'.repeat(43),
      nowMs: Date.parse('2026-07-30T00:00:00.000Z'),
    });
    expect(listed.status).toBe(200);
    if (!listed.result.ok) throw new Error('expected list success');
    expect(listed.result.comments).toHaveLength(50);
    expect(listed.result.comments[0]?.sequence).toBe(2);
    expect(listed.result.comments.at(-1)?.sequence).toBe(51);
    expect(listed.result.nextBeforeSequence).toBe(2);

    harness.setCreateRate({ principalMinute: 6, principalDay: 1, roomHour: 1 });
    expect(
      createPublicComment({
        store: harness.store,
        request: { ...createRequest, mutationId: '523e4567-e89b-42d3-a456-426614174000' },
        requestId: '623e4567-e89b-42d3-a456-426614174000',
        bodySha256: 'c'.repeat(43),
        nowMs: 1,
        randomUUID: () => COMMENT_ID,
      }),
    ).toMatchObject({ status: 429, retryAfterSeconds: 60 });
  });

  it('lets only the owner soft-hide, audits once, and preserves the original moderation time', () => {
    const harness = makeStore();
    harness.store.insertComment({
      id: `pc-v1-${COMMENT_ID}`,
      roomId: ROOM_ID,
      authorPrincipalId: PRINCIPAL,
      authorAlias: 'Commenter A1b_2-',
      mutationId: MUTATION_ID,
      mutationBodySha256: 'b'.repeat(43),
      body: 'Retained body',
      policyVersion: 3,
      cutoffGeneration: 2,
      createdAt: '2026-07-30T00:00:00.000Z',
      visibility: 'visible',
      hiddenAt: null,
      hiddenByPrincipalId: null,
    });
    const owner = `account:v1:${'o'.repeat(43)}`;
    const base = {
      version: 1 as const,
      claimId: `claim-v1-${'c'.repeat(64)}`,
      ownerPrincipalId: owner,
      localDocumentId: 'doc-alpha',
      commentId: `pc-v1-${COMMENT_ID}`,
      action: 'hide' as const,
      expectedPolicyVersion: 3,
      expectedCutoffGeneration: 2,
      roomId: ROOM_ID,
    };
    const first = moderatePublicComment({
      store: harness.store,
      request: {
        ...base,
        mutationId: '723e4567-e89b-42d3-a456-426614174000',
      },
      bodySha256: 'm'.repeat(43),
      moderatedAt: '2026-07-30T00:01:00.000Z',
    });
    expect(first).toMatchObject({ ok: true, changed: true, state: 'hidden' });
    expect(harness.comments[0]).toMatchObject({
      visibility: 'hidden',
      body: 'Retained body',
      hiddenAt: '2026-07-30T00:01:00.000Z',
      hiddenByPrincipalId: owner,
    });
    const second = moderatePublicComment({
      store: harness.store,
      request: {
        ...base,
        mutationId: '823e4567-e89b-42d3-a456-426614174000',
      },
      bodySha256: 'n'.repeat(43),
      moderatedAt: '2026-07-30T00:02:00.000Z',
    });
    expect(second).toMatchObject({
      ok: true,
      changed: false,
      moderatedAt: '2026-07-30T00:01:00.000Z',
    });
    expect(harness.audits).toHaveLength(1);
    expect(JSON.stringify(harness.audits)).not.toContain('Retained body');
  });
});
