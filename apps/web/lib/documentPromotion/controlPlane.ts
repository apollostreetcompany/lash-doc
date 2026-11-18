import type {
  DocumentClaimPromotionRequestV2,
  DocumentClaimPromotionResultV2,
  DocumentPromotionSnapshotV1,
} from '@lash/types';

import type { DocumentDerivationKey } from './config';
import { deriveDocumentClaimId, deriveDocumentRoomId } from './crypto';
import { callWorkerPromotion, type WorkerPromotionCall } from './workerClient';

export interface PromotionControlPlaneInput {
  workerOrigin: string;
  controlSecret: string;
  derivationKeys: DocumentDerivationKey[];
  principalId: string;
  localDocumentId: string;
  idempotencyHash: string;
  snapshot: DocumentPromotionSnapshotV1;
}

export interface PromotionControlPlaneDependencies {
  callWorker: (call: WorkerPromotionCall) => Promise<DocumentClaimPromotionResultV2>;
  deriveClaimId: typeof deriveDocumentClaimId;
  deriveRoomId: typeof deriveDocumentRoomId;
}

const defaultDependencies: PromotionControlPlaneDependencies = {
  callWorker: callWorkerPromotion,
  deriveClaimId: deriveDocumentClaimId,
  deriveRoomId: deriveDocumentRoomId,
};

export const promoteDocumentSnapshot = async (
  input: PromotionControlPlaneInput,
  dependencies: PromotionControlPlaneDependencies = defaultDependencies,
): Promise<DocumentClaimPromotionResultV2> => {
  const [current, ...previous] = input.derivationKeys;
  if (!current) {
    return { ok: false, version: 2, error: 'internal-error', retryable: true };
  }

  const deriveCandidate = (key: DocumentDerivationKey) => ({
    derivationVersion: key.version,
    roomId: dependencies.deriveRoomId(
      key.version,
      key.key,
      input.principalId,
      input.localDocumentId,
    ),
  });
  const request: DocumentClaimPromotionRequestV2 = {
    version: 2,
    claimId: dependencies.deriveClaimId(input.principalId, input.localDocumentId),
    ownerPrincipalId: input.principalId,
    localDocumentId: input.localDocumentId,
    idempotencyHash: input.idempotencyHash,
    candidates: [
      { kind: 'current', ...deriveCandidate(current) },
      ...previous.map((key) => ({ kind: 'retained' as const, ...deriveCandidate(key) })),
    ],
    snapshot: input.snapshot,
  };
  return dependencies.callWorker({
    workerOrigin: input.workerOrigin,
    controlSecret: input.controlSecret,
    request,
  });
};
