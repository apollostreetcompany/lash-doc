import type {
  DocumentClaimPromotionRequestV2,
  DocumentClaimPromotionResultV2,
  OwnerSessionManagementFailureV1,
  OwnerSessionManagementRequestV1,
} from '@lash/types';

import {
  parseDocumentPromotionRequest,
  type ExecuteDocumentPromotionResult,
  type ValidatedDocumentPromotionRequestV1,
} from './promotion';

const ACCOUNT_PRINCIPAL = /^account:v1:[A-Za-z0-9_-]{43}$/u;
const BASE64URL_SHA256 = /^[A-Za-z0-9_-]{43}$/u;
const CLAIM_ID = /^claim-v1-[0-9a-f]{64}$/u;
const LOCAL_DOCUMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;
const DERIVATION_VERSION = /^v(?:0|[1-9][0-9]{0,7})$/u;
const DOCUMENT_ROOM_ID = /^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u;
const MAX_CANDIDATES = 4;
const CLAIM_DOMAIN = 'lash-document-claim:v1';

const exactKeys = (value: Record<string, unknown>, expected: string[]) => {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const bytesToHex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

export const deriveDocumentClaimId = async (ownerPrincipalId: string, localDocumentId: string) => {
  const material = new TextEncoder().encode(
    `${CLAIM_DOMAIN}\0${ownerPrincipalId}\0${localDocumentId}`,
  );
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', material));
  return `claim-v1-${bytesToHex(digest)}`;
};

export type DocumentClaimParseDecision =
  | { ok: true; request: DocumentClaimPromotionRequestV2 }
  | { ok: false; error: 'invalid-request' };

export const parseDocumentClaimPromotionRequest = async (
  value: unknown,
  expectedClaimId: string,
): Promise<DocumentClaimParseDecision> => {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'version',
      'claimId',
      'ownerPrincipalId',
      'localDocumentId',
      'idempotencyHash',
      'candidates',
      'snapshot',
    ]) ||
    value.version !== 2 ||
    typeof value.claimId !== 'string' ||
    value.claimId !== expectedClaimId ||
    !CLAIM_ID.test(value.claimId) ||
    typeof value.ownerPrincipalId !== 'string' ||
    !ACCOUNT_PRINCIPAL.test(value.ownerPrincipalId) ||
    typeof value.localDocumentId !== 'string' ||
    !LOCAL_DOCUMENT_ID.test(value.localDocumentId) ||
    typeof value.idempotencyHash !== 'string' ||
    !BASE64URL_SHA256.test(value.idempotencyHash) ||
    !Array.isArray(value.candidates) ||
    value.candidates.length < 1 ||
    value.candidates.length > MAX_CANDIDATES
  ) {
    return { ok: false, error: 'invalid-request' };
  }

  const candidates: DocumentClaimPromotionRequestV2['candidates'][number][] = [];
  const versions = new Set<string>();
  const rooms = new Set<string>();
  for (let index = 0; index < value.candidates.length; index += 1) {
    const candidate = value.candidates[index];
    const expectedKind: 'current' | 'retained' = index === 0 ? 'current' : 'retained';
    if (
      !isRecord(candidate) ||
      !exactKeys(candidate, ['kind', 'derivationVersion', 'roomId']) ||
      candidate.kind !== expectedKind ||
      typeof candidate.derivationVersion !== 'string' ||
      candidate.derivationVersion.length > 80 ||
      !DERIVATION_VERSION.test(candidate.derivationVersion) ||
      versions.has(candidate.derivationVersion) ||
      typeof candidate.roomId !== 'string' ||
      !DOCUMENT_ROOM_ID.test(candidate.roomId) ||
      !candidate.roomId.startsWith(`doc-${candidate.derivationVersion}-`) ||
      rooms.has(candidate.roomId)
    ) {
      return { ok: false, error: 'invalid-request' };
    }
    versions.add(candidate.derivationVersion);
    rooms.add(candidate.roomId);
    candidates.push({
      kind: expectedKind,
      derivationVersion: candidate.derivationVersion,
      roomId: candidate.roomId,
    });
  }

  if (
    (await deriveDocumentClaimId(value.ownerPrincipalId, value.localDocumentId)) !== value.claimId
  ) {
    return { ok: false, error: 'invalid-request' };
  }

  const current = candidates[0];
  if (!current || current.kind !== 'current') {
    return { ok: false, error: 'invalid-request' };
  }
  const promotion = await parseDocumentPromotionRequest(
    {
      version: 1,
      roomId: current.roomId,
      ownerPrincipalId: value.ownerPrincipalId,
      idempotencyHash: value.idempotencyHash,
      createIfMissing: false,
      snapshot: value.snapshot,
    },
    current.roomId,
  );
  if (!promotion.ok) return promotion;

  return {
    ok: true,
    request: {
      version: 2,
      claimId: value.claimId,
      ownerPrincipalId: value.ownerPrincipalId,
      localDocumentId: value.localDocumentId,
      idempotencyHash: value.idempotencyHash,
      candidates: candidates as DocumentClaimPromotionRequestV2['candidates'],
      snapshot: promotion.request.snapshot,
    },
  };
};

export interface DocumentClaimAliasV1 {
  claimId: string;
  ownerPrincipalId: string;
  canonicalLocalDocumentId: string;
  roomId: string;
  promotionSnapshotSha256: string;
  createdAt: string;
}

export interface DocumentClaimAliasStore {
  transaction<T>(callback: () => T): T;
  readAlias(): DocumentClaimAliasV1 | null;
  createAlias(alias: DocumentClaimAliasV1): void;
  hasManagementRequest(requestId: string): boolean;
  recordSuccessfulRequest(requestId: string, bodySha256?: string, createdAt?: string): void;
}

export type OwnerSessionAliasDecision =
  | {
      ok: true;
      roomId: string;
      promotionSnapshotSha256: string;
    }
  | OwnerSessionManagementFailureV1;

export const resolveOwnerSessionAlias = (
  alias: DocumentClaimAliasV1 | null,
  request: OwnerSessionManagementRequestV1,
): OwnerSessionAliasDecision => {
  if (!alias) {
    return { ok: false, version: 1, error: 'claim-not-found', retryable: false };
  }
  if (alias.ownerPrincipalId !== request.ownerPrincipalId) {
    return { ok: false, version: 1, error: 'owner-mismatch', retryable: false };
  }
  if (
    alias.claimId !== request.claimId ||
    alias.canonicalLocalDocumentId !== request.localDocumentId
  ) {
    return { ok: false, version: 1, error: 'claim-conflict', retryable: false };
  }
  return {
    ok: true,
    roomId: alias.roomId,
    promotionSnapshotSha256: alias.promotionSnapshotSha256,
  };
};

export interface RoomPromotionCall {
  roomId: string;
  createIfMissing: boolean;
  promotion: ValidatedDocumentPromotionRequestV1;
}

const exactRoomSuccess = (
  result: ExecuteDocumentPromotionResult,
  request: DocumentClaimPromotionRequestV2,
  roomId: string,
): result is Extract<ExecuteDocumentPromotionResult, { ok: true }> =>
  result.ok &&
  result.roomId === roomId &&
  result.ownerPrincipalId === request.ownerPrincipalId &&
  result.aclVersion === 1 &&
  result.publicPolicy === 'restricted' &&
  result.publicPolicyVersion === 1 &&
  result.snapshotSha256 === request.snapshot.snapshotSha256;

const claimFailure = (
  error: 'claim-conflict' | 'replay-detected' | 'internal-error' | 'readback-failed',
): DocumentClaimPromotionResultV2 =>
  error === 'internal-error' || error === 'readback-failed'
    ? { ok: false, version: 2, error, retryable: true }
    : { ok: false, version: 2, error, retryable: false };

const promotionFor = (
  request: DocumentClaimPromotionRequestV2,
  roomId: string,
  createIfMissing: boolean,
): ValidatedDocumentPromotionRequestV1 => ({
  version: 1,
  roomId,
  ownerPrincipalId: request.ownerPrincipalId,
  idempotencyHash: request.idempotencyHash,
  createIfMissing,
  snapshot: request.snapshot,
});

const exactAlias = (alias: DocumentClaimAliasV1, request: DocumentClaimPromotionRequestV2) =>
  alias.claimId === request.claimId &&
  alias.ownerPrincipalId === request.ownerPrincipalId &&
  alias.canonicalLocalDocumentId === request.localDocumentId &&
  alias.promotionSnapshotSha256 === request.snapshot.snapshotSha256;

export const coordinateDocumentClaimPromotion = async (input: {
  store: DocumentClaimAliasStore;
  request: DocumentClaimPromotionRequestV2;
  requestId: string;
  bodySha256?: string;
  createdAt: string;
  promoteRoom: (call: RoomPromotionCall) => Promise<ExecuteDocumentPromotionResult>;
}): Promise<DocumentClaimPromotionResultV2> => {
  if (input.store.hasManagementRequest(input.requestId)) {
    return claimFailure('replay-detected');
  }

  const probe = (roomId: string, createIfMissing: boolean) =>
    input.promoteRoom({
      roomId,
      createIfMissing,
      promotion: promotionFor(input.request, roomId, createIfMissing),
    });
  let chosenRoomId: string;
  let created = false;
  const alias = input.store.readAlias();

  if (alias) {
    if (!exactAlias(alias, input.request)) return claimFailure('claim-conflict');
    const room = await probe(alias.roomId, false);
    if (!exactRoomSuccess(room, input.request, alias.roomId)) {
      return room.ok || !room.retryable ? claimFailure('claim-conflict') : claimFailure(room.error);
    }
    chosenRoomId = alias.roomId;
  } else {
    const roots: string[] = [];
    for (const candidate of input.request.candidates) {
      const result = await probe(candidate.roomId, false);
      if (exactRoomSuccess(result, input.request, candidate.roomId)) {
        roots.push(candidate.roomId);
      } else if (!result.ok && result.error === 'promotion-not-found') {
        continue;
      } else if (!result.ok && result.retryable) {
        return claimFailure(result.error);
      } else {
        return claimFailure('claim-conflict');
      }
    }
    if (roots.length > 1) return claimFailure('claim-conflict');
    if (roots.length === 1) {
      chosenRoomId = roots[0]!;
    } else {
      const current = input.request.candidates[0];
      const result = await probe(current.roomId, true);
      if (!exactRoomSuccess(result, input.request, current.roomId)) {
        return !result.ok && result.retryable
          ? claimFailure(result.error)
          : claimFailure('claim-conflict');
      }
      chosenRoomId = current.roomId;
      created = result.created;
    }

    try {
      input.store.transaction(() => {
        const concurrent = input.store.readAlias();
        if (concurrent) {
          if (!exactAlias(concurrent, input.request) || concurrent.roomId !== chosenRoomId) {
            throw new Error('claim alias conflict');
          }
          return;
        }
        input.store.createAlias({
          claimId: input.request.claimId,
          ownerPrincipalId: input.request.ownerPrincipalId,
          canonicalLocalDocumentId: input.request.localDocumentId,
          roomId: chosenRoomId,
          promotionSnapshotSha256: input.request.snapshot.snapshotSha256,
          createdAt: input.createdAt,
        });
        const readback = input.store.readAlias();
        if (!readback || !exactAlias(readback, input.request) || readback.roomId !== chosenRoomId) {
          throw new Error('claim alias readback mismatch');
        }
      });
    } catch {
      return claimFailure('internal-error');
    }

    const roomReadback = await probe(chosenRoomId, false);
    if (!exactRoomSuccess(roomReadback, input.request, chosenRoomId)) {
      return !roomReadback.ok && roomReadback.retryable
        ? claimFailure(roomReadback.error)
        : claimFailure('readback-failed');
    }
  }

  try {
    input.store.transaction(() =>
      input.store.recordSuccessfulRequest(input.requestId, input.bodySha256, input.createdAt),
    );
  } catch {
    return claimFailure('internal-error');
  }
  return {
    ok: true,
    version: 2,
    claimId: input.request.claimId,
    roomId: chosenRoomId,
    ownerPrincipalId: input.request.ownerPrincipalId,
    aclVersion: 1,
    publicPolicy: 'restricted',
    publicPolicyVersion: 1,
    snapshotSha256: input.request.snapshot.snapshotSha256,
    created,
  };
};
