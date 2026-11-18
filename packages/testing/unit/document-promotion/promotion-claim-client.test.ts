import type {
  DocumentClaimPromotionRequestV2,
  DocumentClaimPromotionResultV2,
  DocumentPromotionSnapshotV1,
} from '@lash/types';
import { describe, expect, it, vi } from 'vitest';

import {
  promoteDocumentSnapshot,
  type PromotionControlPlaneDependencies,
} from '../../../../apps/web/lib/documentPromotion/controlPlane';
import {
  deriveDocumentClaimId,
  deriveDocumentRoomId,
} from '../../../../apps/web/lib/documentPromotion/crypto';

const PRINCIPAL_ID = `account:v1:${'a'.repeat(43)}`;
const HASH = 'c'.repeat(43);
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

describe('stable document promotion claim client', () => {
  it('matches the frozen derivation-key-independent claim vector', () => {
    expect(deriveDocumentClaimId(PRINCIPAL_ID, 'weekly-plan')).toBe(
      'claim-v1-65eec48c1affe748774e91e0cd08f0ab5e9a3f08ca58eff957ab58266a28565d',
    );
  });

  it('sends one current-first atomic claim request instead of a probe/create sequence', async () => {
    const calls: DocumentClaimPromotionRequestV2[] = [];
    const callWorker = vi.fn(
      async (call: {
        request: DocumentClaimPromotionRequestV2;
      }): Promise<DocumentClaimPromotionResultV2> => {
        calls.push(call.request);
        return {
          ok: true,
          version: 2,
          claimId: call.request.claimId,
          roomId: call.request.candidates[1]!.roomId,
          ownerPrincipalId: PRINCIPAL_ID,
          aclVersion: 1,
          publicPolicy: 'restricted',
          publicPolicyVersion: 1,
          snapshotSha256: HASH,
          created: false,
        };
      },
    );
    const dependencies: PromotionControlPlaneDependencies = {
      callWorker,
      deriveClaimId: deriveDocumentClaimId,
      deriveRoomId: deriveDocumentRoomId,
    };

    const result = await promoteDocumentSnapshot(
      {
        workerOrigin: 'https://worker.example',
        controlSecret: 'current-control-secret-with-at-least-32-bytes',
        derivationKeys: [
          { version: 'v2', key: Buffer.alloc(32, 2) },
          { version: 'v1', key: Buffer.alloc(32, 1) },
        ],
        principalId: PRINCIPAL_ID,
        localDocumentId: 'weekly-plan',
        idempotencyHash: HASH,
        snapshot,
      },
      dependencies,
    );

    expect(result.ok).toBe(true);
    expect(callWorker).toHaveBeenCalledOnce();
    expect(calls[0]).toEqual({
      version: 2,
      claimId: deriveDocumentClaimId(PRINCIPAL_ID, 'weekly-plan'),
      ownerPrincipalId: PRINCIPAL_ID,
      localDocumentId: 'weekly-plan',
      idempotencyHash: HASH,
      candidates: [
        {
          kind: 'current',
          derivationVersion: 'v2',
          roomId: deriveDocumentRoomId('v2', Buffer.alloc(32, 2), PRINCIPAL_ID, 'weekly-plan'),
        },
        {
          kind: 'retained',
          derivationVersion: 'v1',
          roomId: deriveDocumentRoomId('v1', Buffer.alloc(32, 1), PRINCIPAL_ID, 'weekly-plan'),
        },
      ],
      snapshot,
    });
  });

  it('gives rolling old/new configurations the same serialization claim', async () => {
    const claims: string[] = [];
    const dependencies: PromotionControlPlaneDependencies = {
      callWorker: vi.fn(async ({ request }) => {
        claims.push(request.claimId);
        return {
          ok: false,
          version: 2,
          error: 'claim-conflict',
          retryable: false,
        };
      }),
      deriveClaimId: deriveDocumentClaimId,
      deriveRoomId: deriveDocumentRoomId,
    };
    const common = {
      workerOrigin: 'https://worker.example',
      controlSecret: 'current-control-secret-with-at-least-32-bytes',
      principalId: PRINCIPAL_ID,
      localDocumentId: 'weekly-plan',
      idempotencyHash: HASH,
      snapshot,
    };

    await Promise.all([
      promoteDocumentSnapshot(
        {
          ...common,
          derivationKeys: [{ version: 'v1', key: Buffer.alloc(32, 1) }],
        },
        dependencies,
      ),
      promoteDocumentSnapshot(
        {
          ...common,
          derivationKeys: [
            { version: 'v2', key: Buffer.alloc(32, 2) },
            { version: 'v1', key: Buffer.alloc(32, 1) },
          ],
        },
        dependencies,
      ),
    ]);

    expect(claims).toHaveLength(2);
    expect(new Set(claims)).toEqual(
      new Set(['claim-v1-65eec48c1affe748774e91e0cd08f0ab5e9a3f08ca58eff957ab58266a28565d']),
    );
  });
});
