import { describe, expect, it } from 'vitest';

import { deriveDocumentRoomId } from '../../../../apps/web/lib/documentPromotion/crypto';
import {
  coordinateDocumentClaimPromotion,
  deriveDocumentClaimId,
  parseDocumentClaimPromotionRequest,
  type DocumentClaimAliasStore,
  type RoomPromotionCall,
} from '../../../realtime-worker/src/documentClaim';
import {
  canonicalizePromotionJson,
  sha256Base64Url,
  type ExecuteDocumentPromotionResult,
} from '../../../realtime-worker/src/promotion';
import type { DocumentClaimPromotionRequestV2 } from '../../../types/src';

const PRINCIPAL = `account:v1:${'a'.repeat(43)}`;
const LOCAL_DOCUMENT_ID = 'doc-alpha';
const CLAIM_ID = 'claim-v1-9d05c49f61f58ffa69b8c098851879494c21aea1988e336055c1f646e9ad5543';
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const CURRENT_ROOM_ID = deriveDocumentRoomId(
  'v2',
  Buffer.alloc(32, 2),
  PRINCIPAL,
  LOCAL_DOCUMENT_ID,
);
const RETAINED_ROOM_ID = deriveDocumentRoomId(
  'v1',
  Buffer.alloc(32, 1),
  PRINCIPAL,
  LOCAL_DOCUMENT_ID,
);
const NEXT_ROOM_ID = deriveDocumentRoomId('v3', Buffer.alloc(32, 3), PRINCIPAL, LOCAL_DOCUMENT_ID);
const INITIAL_UPDATE =
  'AQTvjKbdDgAHAQdjb250ZW50AwlwYXJhZ3JhcGgHAO+Mpt0OAAYEAO+Mpt0OAQ1Qcm9tb3RlZCBib2R5KAEZbGFzaDpkb2N1bWVudC1tZXRhZGF0YTp2MQV0aXRsZQF3DlByb21vdGVkIHRpdGxlAA==';

const makeRequest = async (): Promise<DocumentClaimPromotionRequestV2> => {
  const body = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Promoted body' }] }],
  };
  const update = Uint8Array.from(atob(INITIAL_UPDATE), (character) => character.charCodeAt(0));
  const bodySha256 = await sha256Base64Url(
    new TextEncoder().encode(canonicalizePromotionJson(body)),
  );
  const initialUpdateSha256 = await sha256Base64Url(update);
  const adjuncts = { comments: 0 as const, suggestions: 0 as const };
  const snapshotSha256 = await sha256Base64Url(
    new TextEncoder().encode(
      canonicalizePromotionJson({
        version: 1,
        title: 'Promoted title',
        bodySha256,
        initialUpdateSha256,
        adjuncts,
      }),
    ),
  );
  return {
    version: 2,
    claimId: CLAIM_ID,
    ownerPrincipalId: PRINCIPAL,
    localDocumentId: LOCAL_DOCUMENT_ID,
    idempotencyHash: 'h'.repeat(43),
    candidates: [
      { kind: 'current', derivationVersion: 'v2', roomId: CURRENT_ROOM_ID },
      { kind: 'retained', derivationVersion: 'v1', roomId: RETAINED_ROOM_ID },
    ],
    snapshot: {
      version: 1,
      title: 'Promoted title',
      body,
      bodySha256,
      initialUpdate: INITIAL_UPDATE,
      initialUpdateSha256,
      adjuncts,
      snapshotSha256,
    },
  };
};

class MemoryClaimStore implements DocumentClaimAliasStore {
  alias: Parameters<DocumentClaimAliasStore['createAlias']>[0] | null = null;
  requests = new Set<string>();
  failAliasWriteOnce = false;
  failRequestWriteOnce = false;

  transaction<T>(callback: () => T): T {
    const before = this.alias ? structuredClone(this.alias) : null;
    try {
      return callback();
    } catch (error) {
      this.alias = before;
      throw error;
    }
  }

  readAlias() {
    return this.alias ? structuredClone(this.alias) : null;
  }

  createAlias(alias: NonNullable<MemoryClaimStore['alias']>) {
    if (this.failAliasWriteOnce) {
      this.failAliasWriteOnce = false;
      throw new Error('simulated crash before alias commit');
    }
    if (this.alias) throw new Error('immutable alias already exists');
    this.alias = structuredClone(alias);
  }

  hasManagementRequest(requestId: string) {
    return this.requests.has(requestId);
  }

  recordSuccessfulRequest(requestId: string) {
    if (this.failRequestWriteOnce) {
      this.failRequestWriteOnce = false;
      throw new Error('simulated crash after alias commit');
    }
    this.requests.add(requestId);
  }
}

const missing = (): ExecuteDocumentPromotionResult => ({
  ok: false,
  version: 1,
  error: 'promotion-not-found',
  retryable: false,
});

const exact = (
  request: DocumentClaimPromotionRequestV2,
  roomId: string,
  created: boolean,
): ExecuteDocumentPromotionResult => ({
  ok: true,
  version: 1,
  roomId,
  ownerPrincipalId: request.ownerPrincipalId,
  aclVersion: 1,
  publicPolicy: 'restricted',
  publicPolicyVersion: 1,
  snapshotSha256: request.snapshot.snapshotSha256,
  created,
});

describe('document promotion stable claim coordinator', () => {
  it('accepts the frozen real Next-derived lowercase-hex room vector unchanged', async () => {
    const localDocumentId = 'weekly-plan';
    const claimId = await deriveDocumentClaimId(PRINCIPAL, localDocumentId);
    const roomId = deriveDocumentRoomId('v1', Buffer.alloc(32, 7), PRINCIPAL, localDocumentId);
    expect(roomId).toBe('doc-v1-fc67c0ba3b5afee772776560c554e181c590ae22cba47a55ddc90959fbcd0d61');
    const request = {
      ...(await makeRequest()),
      claimId,
      localDocumentId,
      candidates: [{ kind: 'current' as const, derivationVersion: 'v1', roomId }],
    };

    await expect(parseDocumentClaimPromotionRequest(request, claimId)).resolves.toEqual({
      ok: true,
      request,
    });
  });

  it.each([
    ['old base64url', 'v1', 'doc-v1-_GfAujta_udyd2VgxVThgcWQriLLpHpV3ckJWfvNDWE'],
    ['uppercase hex', 'v1', `doc-v1-${'A'.repeat(64)}`],
    ['mixed-case hex', 'v1', `doc-v1-${'a'.repeat(32)}${'A'.repeat(32)}`],
    ['underscore', 'v1', `doc-v1-${'a'.repeat(31)}_${'a'.repeat(32)}`],
    ['padding', 'v1', `doc-v1-${'a'.repeat(64)}=`],
    ['oversized digest', 'v1', `doc-v1-${'a'.repeat(65)}`],
    ['percent encoding', 'v1', `doc-v1-${'a'.repeat(62)}%61`],
    ['leading-zero version', 'v01', `doc-v01-${'a'.repeat(64)}`],
    ['oversized version', 'v123456789', `doc-v123456789-${'a'.repeat(64)}`],
    ['version mismatch', 'v2', `doc-v1-${'a'.repeat(64)}`],
  ])('rejects %s candidate room spelling', async (_label, derivationVersion, roomId) => {
    const request = await makeRequest();
    request.candidates = [{ kind: 'current', derivationVersion, roomId }];
    await expect(parseDocumentClaimPromotionRequest(request, CLAIM_ID)).resolves.toEqual({
      ok: false,
      error: 'invalid-request',
    });
  });

  it('derives the frozen stable claim vector independent of room candidates', async () => {
    await expect(deriveDocumentClaimId(PRINCIPAL, LOCAL_DOCUMENT_ID)).resolves.toBe(CLAIM_ID);
    await expect(deriveDocumentClaimId(PRINCIPAL, 'doc-beta')).resolves.not.toBe(CLAIM_ID);
  });

  it('accepts only the exact recomputed claim and bounded current-first unique candidates', async () => {
    const request = await makeRequest();
    await expect(parseDocumentClaimPromotionRequest(request, CLAIM_ID)).resolves.toEqual({
      ok: true,
      request,
    });

    for (const invalid of [
      { ...request, claimId: `claim-v1-${'0'.repeat(64)}` },
      { ...request, localDocumentId: ' padded' },
      { ...request, candidates: [...request.candidates].reverse() },
      {
        ...request,
        candidates: [
          request.candidates[0],
          { kind: 'retained', derivationVersion: 'v1', roomId: CURRENT_ROOM_ID },
        ],
      },
      {
        ...request,
        candidates: [
          request.candidates[0],
          ...Array.from({ length: 4 }, (_, index) => ({
            kind: 'retained' as const,
            derivationVersion: `v${index + 3}`,
            roomId: deriveDocumentRoomId(
              `v${index + 3}`,
              Buffer.alloc(32, index + 3),
              PRINCIPAL,
              LOCAL_DOCUMENT_ID,
            ),
          })),
        ],
      },
    ]) {
      await expect(parseDocumentClaimPromotionRequest(invalid, CLAIM_ID)).resolves.toEqual({
        ok: false,
        error: 'invalid-request',
      });
    }
  });

  it('probes every candidate, creates only current on zero roots, and records one alias', async () => {
    const request = await makeRequest();
    const store = new MemoryClaimStore();
    const calls: RoomPromotionCall[] = [];
    const roots = new Set<string>();
    const result = await coordinateDocumentClaimPromotion({
      store,
      request,
      requestId: REQUEST_ID,
      createdAt: '2026-07-30T00:00:00.000Z',
      promoteRoom: async (call) => {
        calls.push(call);
        if (roots.has(call.roomId)) return exact(request, call.roomId, false);
        if (!call.createIfMissing) return missing();
        roots.add(call.roomId);
        return exact(request, call.roomId, true);
      },
    });

    expect(result).toMatchObject({
      ok: true,
      version: 2,
      claimId: CLAIM_ID,
      roomId: CURRENT_ROOM_ID,
      created: true,
    });
    expect(calls.map(({ roomId, createIfMissing }) => ({ roomId, createIfMissing }))).toEqual([
      { roomId: CURRENT_ROOM_ID, createIfMissing: false },
      { roomId: RETAINED_ROOM_ID, createIfMissing: false },
      { roomId: CURRENT_ROOM_ID, createIfMissing: true },
      { roomId: CURRENT_ROOM_ID, createIfMissing: false },
    ]);
    expect(store.alias?.roomId).toBe(CURRENT_ROOM_ID);
  });

  it('adopts one exact retained root but rejects multiple roots without alias mutation', async () => {
    const request = await makeRequest();
    const retainedStore = new MemoryClaimStore();
    const retained = await coordinateDocumentClaimPromotion({
      store: retainedStore,
      request,
      requestId: REQUEST_ID,
      createdAt: '2026-07-30T00:00:00.000Z',
      promoteRoom: async ({ roomId }) =>
        roomId === RETAINED_ROOM_ID ? exact(request, roomId, false) : missing(),
    });
    expect(retained).toMatchObject({ ok: true, roomId: RETAINED_ROOM_ID, created: false });
    expect(retainedStore.alias?.roomId).toBe(RETAINED_ROOM_ID);

    const forkedStore = new MemoryClaimStore();
    const forkedCalls: RoomPromotionCall[] = [];
    const immutableRoomRoots = new Map(
      request.candidates.map(({ roomId }) => [
        roomId,
        {
          ownerPrincipalId: request.ownerPrincipalId,
          idempotencyHash: request.idempotencyHash,
          snapshotSha256: request.snapshot.snapshotSha256,
        },
      ]),
    );
    const beforeRoots = structuredClone([...immutableRoomRoots.entries()]);
    let probeAuditRows = 0;
    const forked = await coordinateDocumentClaimPromotion({
      store: forkedStore,
      request,
      requestId: REQUEST_ID,
      createdAt: '2026-07-30T00:00:00.000Z',
      promoteRoom: async (call) => {
        forkedCalls.push(call);
        probeAuditRows += 1;
        return exact(request, call.roomId, false);
      },
    });
    expect(forked).toEqual({
      ok: false,
      version: 2,
      error: 'claim-conflict',
      retryable: false,
    });
    expect(forkedStore.alias).toBeNull();
    expect(forkedCalls.every((call) => call.createIfMissing === false)).toBe(true);
    expect([...immutableRoomRoots.entries()]).toEqual(beforeRoots);
    // Existing-room probes may append their room-local management replay/audit
    // rows, but a conflict cannot mutate owner, content projection, or alias.
    expect(probeAuditRows).toBe(2);
  });

  it('recovers all room-creation and alias crash windows with fresh outer request IDs', async () => {
    const request = await makeRequest();
    const store = new MemoryClaimStore();
    const roomRoots = new Set<string>();
    let failBeforeCreateOnce = true;
    let failAfterCreateBeforeResponseOnce = true;
    const promoteRoom = async ({ roomId, createIfMissing }: RoomPromotionCall) => {
      if (roomRoots.has(roomId)) return exact(request, roomId, false);
      if (!createIfMissing) return missing();
      if (failBeforeCreateOnce) {
        failBeforeCreateOnce = false;
        return { ok: false, version: 1, error: 'internal-error', retryable: true } as const;
      }
      roomRoots.add(roomId);
      if (failAfterCreateBeforeResponseOnce) {
        failAfterCreateBeforeResponseOnce = false;
        return { ok: false, version: 1, error: 'internal-error', retryable: true } as const;
      }
      return exact(request, roomId, true);
    };

    await expect(
      coordinateDocumentClaimPromotion({
        store,
        request,
        requestId: REQUEST_ID,
        createdAt: '2026-07-30T00:00:00.000Z',
        promoteRoom,
      }),
    ).resolves.toMatchObject({ ok: false, error: 'internal-error', retryable: true });
    expect(roomRoots.size).toBe(0);

    await expect(
      coordinateDocumentClaimPromotion({
        store,
        request,
        requestId: '123e4567-e89b-42d3-a456-426614174001',
        createdAt: '2026-07-30T00:00:01.000Z',
        promoteRoom,
      }),
    ).resolves.toMatchObject({ ok: false, error: 'internal-error', retryable: true });
    expect(roomRoots).toEqual(new Set([CURRENT_ROOM_ID]));
    expect(store.alias).toBeNull();

    store.failAliasWriteOnce = true;
    await expect(
      coordinateDocumentClaimPromotion({
        store,
        request,
        requestId: '123e4567-e89b-42d3-a456-426614174002',
        createdAt: '2026-07-30T00:00:02.000Z',
        promoteRoom,
      }),
    ).resolves.toMatchObject({ ok: false, error: 'internal-error', retryable: true });
    expect(store.alias).toBeNull();

    const retried = await coordinateDocumentClaimPromotion({
      store,
      request,
      requestId: '123e4567-e89b-42d3-a456-426614174003',
      createdAt: '2026-07-30T00:00:03.000Z',
      promoteRoom,
    });
    expect(retried).toMatchObject({ ok: true, roomId: CURRENT_ROOM_ID, created: false });

    store.failRequestWriteOnce = true;
    await expect(
      coordinateDocumentClaimPromotion({
        store,
        request,
        requestId: '123e4567-e89b-42d3-a456-426614174004',
        createdAt: '2026-07-30T00:00:04.000Z',
        promoteRoom,
      }),
    ).resolves.toMatchObject({ ok: false, error: 'internal-error', retryable: true });
    expect(store.alias?.roomId).toBe(CURRENT_ROOM_ID);
    await expect(
      coordinateDocumentClaimPromotion({
        store,
        request,
        requestId: '123e4567-e89b-42d3-a456-426614174005',
        createdAt: '2026-07-30T00:00:05.000Z',
        promoteRoom,
      }),
    ).resolves.toMatchObject({ ok: true, roomId: CURRENT_ROOM_ID, created: false });
  });

  it('resolves an exact retained-room alias after that derivation candidate is removed', async () => {
    const request = await makeRequest();
    const store = new MemoryClaimStore();
    store.alias = {
      claimId: request.claimId,
      ownerPrincipalId: request.ownerPrincipalId,
      canonicalLocalDocumentId: request.localDocumentId,
      roomId: RETAINED_ROOM_ID,
      promotionSnapshotSha256: request.snapshot.snapshotSha256,
      createdAt: '2026-07-30T00:00:00.000Z',
    };
    request.candidates = [request.candidates[0]];
    const calls: RoomPromotionCall[] = [];

    await expect(
      coordinateDocumentClaimPromotion({
        store,
        request,
        requestId: '123e4567-e89b-42d3-a456-426614174005',
        createdAt: '2026-07-30T00:00:05.000Z',
        promoteRoom: async (call) => {
          calls.push(call);
          return exact(request, call.roomId, false);
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      claimId: CLAIM_ID,
      roomId: RETAINED_ROOM_ID,
      created: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ roomId: RETAINED_ROOM_ID, createIfMissing: false });
    expect(store.alias?.roomId).toBe(RETAINED_ROOM_ID);
  });

  it('requires exact alias idempotency and room revalidation and never remaps', async () => {
    const request = await makeRequest();
    const store = new MemoryClaimStore();
    store.alias = {
      claimId: request.claimId,
      ownerPrincipalId: request.ownerPrincipalId,
      canonicalLocalDocumentId: request.localDocumentId,
      roomId: CURRENT_ROOM_ID,
      promotionSnapshotSha256: request.snapshot.snapshotSha256,
      createdAt: '2026-07-30T00:00:00.000Z',
    };
    const calls: RoomPromotionCall[] = [];
    const differentIdempotency = { ...request, idempotencyHash: 'j'.repeat(43) };
    await expect(
      coordinateDocumentClaimPromotion({
        store,
        request: differentIdempotency,
        requestId: '123e4567-e89b-42d3-a456-426614174005',
        createdAt: '2026-07-30T00:00:05.000Z',
        promoteRoom: async (call) => {
          calls.push(call);
          return call.promotion.idempotencyHash === request.idempotencyHash
            ? exact(request, call.roomId, false)
            : { ok: false, version: 1, error: 'promotion-conflict', retryable: false };
        },
      }),
    ).resolves.toEqual({
      ok: false,
      version: 2,
      error: 'claim-conflict',
      retryable: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.roomId).toBe(CURRENT_ROOM_ID);
    expect(calls[0]?.createIfMissing).toBe(false);
    expect(store.alias?.roomId).toBe(CURRENT_ROOM_ID);

    const narrowed = structuredClone(request);
    narrowed.candidates = [{ kind: 'current', derivationVersion: 'v3', roomId: NEXT_ROOM_ID }];
    await expect(
      coordinateDocumentClaimPromotion({
        store,
        request: narrowed,
        requestId: '123e4567-e89b-42d3-a456-426614174006',
        createdAt: '2026-07-30T00:00:06.000Z',
        promoteRoom: async (call) => {
          calls.push(call);
          return missing();
        },
      }),
    ).resolves.toEqual({
      ok: false,
      version: 2,
      error: 'claim-conflict',
      retryable: false,
    });
    expect(store.alias?.roomId).toBe(CURRENT_ROOM_ID);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ roomId: CURRENT_ROOM_ID, createIfMissing: false });
  });
});
