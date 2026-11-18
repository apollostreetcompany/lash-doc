import { parsePublicAccessMode, type PublicAccessMode } from './documentAuthority';
import { deriveDocumentClaimId } from './documentClaim';

const ACCOUNT_PRINCIPAL = /^account:v1:[A-Za-z0-9_-]{43}$/u;
const CLAIM_ID = /^claim-v1-[0-9a-f]{64}$/u;
const LOCAL_DOCUMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;
const DOCUMENT_ROOM_ID = /^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u;
const BASE64URL_SHA256 = /^[A-Za-z0-9_-]{43}$/u;
const LOWERCASE_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const exactKeys = (value: Record<string, unknown>, expected: string[]) => {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isPositiveVersion = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 1;

const isCutoffGeneration = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

export interface PublicPolicyReadRequestV1 {
  version: 1;
  claimId: string;
  ownerPrincipalId: string;
  localDocumentId: string;
}

export interface PublicPolicyUpdateRequestV1 extends PublicPolicyReadRequestV1 {
  mode: PublicAccessMode;
  expectedPolicyVersion: number;
  mutationId: string;
}

export type PublicPolicyParseDecision<T> =
  | { ok: true; request: T }
  | { ok: false; error: 'invalid-request' };

const parseCommonRequest = async (
  value: unknown,
  expectedClaimId: string,
  expectedKeys: string[],
): Promise<PublicPolicyReadRequestV1 | null> => {
  if (
    !isRecord(value) ||
    !exactKeys(value, expectedKeys) ||
    value.version !== 1 ||
    typeof value.claimId !== 'string' ||
    value.claimId !== expectedClaimId ||
    !CLAIM_ID.test(value.claimId) ||
    typeof value.ownerPrincipalId !== 'string' ||
    !ACCOUNT_PRINCIPAL.test(value.ownerPrincipalId) ||
    typeof value.localDocumentId !== 'string' ||
    !LOCAL_DOCUMENT_ID.test(value.localDocumentId) ||
    (await deriveDocumentClaimId(value.ownerPrincipalId, value.localDocumentId)) !== value.claimId
  ) {
    return null;
  }
  return {
    version: 1,
    claimId: value.claimId,
    ownerPrincipalId: value.ownerPrincipalId,
    localDocumentId: value.localDocumentId,
  };
};

export const parsePublicPolicyReadRequest = async (
  value: unknown,
  expectedClaimId: string,
): Promise<PublicPolicyParseDecision<PublicPolicyReadRequestV1>> => {
  const request = await parseCommonRequest(value, expectedClaimId, [
    'version',
    'claimId',
    'ownerPrincipalId',
    'localDocumentId',
  ]);
  return request ? { ok: true, request } : { ok: false, error: 'invalid-request' };
};

export const parsePublicPolicyUpdateRequest = async (
  value: unknown,
  expectedClaimId: string,
): Promise<PublicPolicyParseDecision<PublicPolicyUpdateRequestV1>> => {
  const request = await parseCommonRequest(value, expectedClaimId, [
    'version',
    'claimId',
    'ownerPrincipalId',
    'localDocumentId',
    'mode',
    'expectedPolicyVersion',
    'mutationId',
  ]);
  if (
    !request ||
    !isRecord(value) ||
    parsePublicAccessMode(value.mode) === null ||
    !isPositiveVersion(value.expectedPolicyVersion) ||
    typeof value.mutationId !== 'string' ||
    !LOWERCASE_UUID_V4.test(value.mutationId)
  ) {
    return { ok: false, error: 'invalid-request' };
  }
  return {
    ok: true,
    request: {
      ...request,
      mode: parsePublicAccessMode(value.mode)!,
      expectedPolicyVersion: value.expectedPolicyVersion,
      mutationId: value.mutationId,
    },
  };
};

export interface PublicPolicyAuthoritySnapshot {
  roomId: string;
  ownerPrincipalId: string;
  shareable: boolean;
}

export interface PublicPolicyState {
  mode: PublicAccessMode;
  policyVersion: number;
  cutoffGeneration: number;
}

export interface PublicPolicyMutationReceipt {
  mutationId: string;
  bodySha256: string;
  ownerPrincipalId: string;
  mode: PublicAccessMode;
  expectedPolicyVersion: number;
  resultMode: PublicAccessMode;
  resultPolicyVersion: number;
  resultCutoffGeneration: number;
  resultChanged: boolean;
  createdAt: string;
}

export interface PublicPolicyStore {
  transaction<T>(callback: () => T): T;
  readAuthority(): PublicPolicyAuthoritySnapshot | null;
  readPolicy(): PublicPolicyState | null;
  readMutation(mutationId: string): PublicPolicyMutationReceipt | null;
  updatePolicy(next: PublicPolicyState, ownerPrincipalId: string, changedAt: string): void;
  createMutation(receipt: PublicPolicyMutationReceipt): void;
}

export type PublicPolicyFailureError =
  | 'claim-not-found'
  | 'claim-conflict'
  | 'owner-mismatch'
  | 'not-shareable'
  | 'policy-conflict'
  | 'replay-detected'
  | 'readback-failed'
  | 'internal-error';

export interface PublicPolicyConflictStateV1 {
  mode: PublicAccessMode;
  policyVersion: number;
  cutoffGeneration: number;
  publicPath: string | null;
  publicProjectionBlocked?: true;
}

interface PublicPolicyBaseFailureV1 {
  ok: false;
  version: 1;
  error: PublicPolicyFailureError;
  retryable: boolean;
}

export type PublicPolicyFailureV1 =
  | (PublicPolicyBaseFailureV1 & {
      error: 'policy-conflict';
      state: PublicPolicyConflictStateV1;
    })
  | (PublicPolicyBaseFailureV1 & {
      error: Exclude<PublicPolicyFailureError, 'policy-conflict'>;
    });

export interface PublicPolicyReadSuccessV1 {
  ok: true;
  version: 1;
  roomId: string;
  ownerPrincipalId: string;
  mode: PublicAccessMode;
  policyVersion: number;
  cutoffGeneration: number;
  publicPath: string | null;
  publicProjectionBlocked?: true;
}

export interface PublicPolicyUpdateSuccessV1 extends PublicPolicyReadSuccessV1 {
  changed: boolean;
}

export type PublicPolicyReadResult = PublicPolicyReadSuccessV1 | PublicPolicyFailureV1;
export type PublicPolicyUpdateResult = PublicPolicyUpdateSuccessV1 | PublicPolicyFailureV1;
export type PublicPolicyRoomResult = PublicPolicyReadResult | PublicPolicyUpdateResult;

const publicPath = (mode: PublicAccessMode, roomId: string) =>
  mode === 'restricted' ? null : `/public/${roomId}`;

const failure = (
  error: Exclude<PublicPolicyFailureError, 'policy-conflict'>,
): PublicPolicyFailureV1 => ({
  ok: false,
  version: 1,
  error,
  retryable: error === 'readback-failed' || error === 'internal-error',
});

const policyConflict = (state: PublicPolicyState, roomId: string): PublicPolicyFailureV1 => ({
  ok: false,
  version: 1,
  error: 'policy-conflict',
  retryable: false,
  state: {
    ...state,
    publicPath: publicPath(state.mode, roomId),
  },
});

const validPolicyState = (value: PublicPolicyState | null): value is PublicPolicyState =>
  value !== null &&
  parsePublicAccessMode(value.mode) !== null &&
  isPositiveVersion(value.policyVersion) &&
  isCutoffGeneration(value.cutoffGeneration);

const validateAuthority = (
  authority: PublicPolicyAuthoritySnapshot | null,
  request: PublicPolicyReadRequestV1,
  roomId: string,
): PublicPolicyFailureV1 | null => {
  if (!authority) return failure('claim-conflict');
  if (
    !DOCUMENT_ROOM_ID.test(authority.roomId) ||
    !ACCOUNT_PRINCIPAL.test(authority.ownerPrincipalId) ||
    typeof authority.shareable !== 'boolean'
  ) {
    return failure('readback-failed');
  }
  if (authority.ownerPrincipalId !== request.ownerPrincipalId) return failure('owner-mismatch');
  if (authority.roomId !== roomId) return failure('claim-conflict');
  return authority.shareable ? null : failure('not-shareable');
};

const success = (
  roomId: string,
  ownerPrincipalId: string,
  state: PublicPolicyState,
): PublicPolicyReadSuccessV1 => ({
  ok: true,
  version: 1,
  roomId,
  ownerPrincipalId,
  mode: state.mode,
  policyVersion: state.policyVersion,
  cutoffGeneration: state.cutoffGeneration,
  publicPath: publicPath(state.mode, roomId),
});

const validReceipt = (receipt: PublicPolicyMutationReceipt) =>
  LOWERCASE_UUID_V4.test(receipt.mutationId) &&
  BASE64URL_SHA256.test(receipt.bodySha256) &&
  ACCOUNT_PRINCIPAL.test(receipt.ownerPrincipalId) &&
  parsePublicAccessMode(receipt.mode) !== null &&
  isPositiveVersion(receipt.expectedPolicyVersion) &&
  parsePublicAccessMode(receipt.resultMode) !== null &&
  isPositiveVersion(receipt.resultPolicyVersion) &&
  isCutoffGeneration(receipt.resultCutoffGeneration) &&
  typeof receipt.resultChanged === 'boolean' &&
  Number.isFinite(Date.parse(receipt.createdAt)) &&
  new Date(receipt.createdAt).toISOString() === receipt.createdAt;

export const readOwnerPublicPolicy = (input: {
  store: PublicPolicyStore;
  request: PublicPolicyReadRequestV1;
  roomId: string;
}): PublicPolicyReadResult => {
  try {
    return input.store.transaction<PublicPolicyReadResult>(() => {
      const invalidAuthority = validateAuthority(
        input.store.readAuthority(),
        input.request,
        input.roomId,
      );
      if (invalidAuthority) return invalidAuthority;
      const state = input.store.readPolicy();
      return validPolicyState(state)
        ? success(input.roomId, input.request.ownerPrincipalId, state)
        : failure('readback-failed');
    });
  } catch {
    return failure('internal-error');
  }
};

class PublicPolicyReadbackError extends Error {}

export const updateOwnerPublicPolicy = (input: {
  store: PublicPolicyStore;
  request: PublicPolicyUpdateRequestV1;
  roomId: string;
  bodySha256: string;
  changedAt: string;
  canShareProjection?: () => boolean;
}): PublicPolicyUpdateResult => {
  if (
    !BASE64URL_SHA256.test(input.bodySha256) ||
    !Number.isFinite(Date.parse(input.changedAt)) ||
    new Date(input.changedAt).toISOString() !== input.changedAt
  ) {
    return failure('internal-error');
  }
  try {
    return input.store.transaction<PublicPolicyUpdateResult>(() => {
      const invalidAuthority = validateAuthority(
        input.store.readAuthority(),
        input.request,
        input.roomId,
      );
      if (invalidAuthority) return invalidAuthority;
      if (input.request.mode !== 'restricted' && input.canShareProjection?.() === false) {
        return failure('not-shareable');
      }
      const current = input.store.readPolicy();
      if (!validPolicyState(current)) return failure('readback-failed');

      const receipt = input.store.readMutation(input.request.mutationId);
      if (receipt) {
        if (
          !validReceipt(receipt) ||
          receipt.bodySha256 !== input.bodySha256 ||
          receipt.ownerPrincipalId !== input.request.ownerPrincipalId ||
          receipt.mode !== input.request.mode ||
          receipt.expectedPolicyVersion !== input.request.expectedPolicyVersion
        ) {
          return failure('replay-detected');
        }
        const receiptState = {
          mode: receipt.resultMode,
          policyVersion: receipt.resultPolicyVersion,
          cutoffGeneration: receipt.resultCutoffGeneration,
        };
        if (!validPolicyState(receiptState)) return failure('replay-detected');
        return {
          ...success(input.roomId, input.request.ownerPrincipalId, receiptState),
          changed: receipt.resultChanged,
        };
      }

      if (current.policyVersion !== input.request.expectedPolicyVersion) {
        return policyConflict(current, input.roomId);
      }
      const changed = current.mode !== input.request.mode;
      const next: PublicPolicyState = changed
        ? {
            mode: input.request.mode,
            policyVersion: current.policyVersion + 1,
            cutoffGeneration: current.cutoffGeneration + 1,
          }
        : current;
      if (!validPolicyState(next)) return failure('readback-failed');

      if (changed) {
        input.store.updatePolicy(next, input.request.ownerPrincipalId, input.changedAt);
        const readback = input.store.readPolicy();
        if (
          !validPolicyState(readback) ||
          readback.mode !== next.mode ||
          readback.policyVersion !== next.policyVersion ||
          readback.cutoffGeneration !== next.cutoffGeneration
        ) {
          throw new PublicPolicyReadbackError('policy readback mismatch');
        }
      }
      const mutation: PublicPolicyMutationReceipt = {
        mutationId: input.request.mutationId,
        bodySha256: input.bodySha256,
        ownerPrincipalId: input.request.ownerPrincipalId,
        mode: input.request.mode,
        expectedPolicyVersion: input.request.expectedPolicyVersion,
        resultMode: next.mode,
        resultPolicyVersion: next.policyVersion,
        resultCutoffGeneration: next.cutoffGeneration,
        resultChanged: changed,
        createdAt: input.changedAt,
      };
      input.store.createMutation(mutation);
      const mutationReadback = input.store.readMutation(input.request.mutationId);
      if (
        !mutationReadback ||
        !validReceipt(mutationReadback) ||
        JSON.stringify(mutationReadback) !== JSON.stringify(mutation)
      ) {
        throw new PublicPolicyReadbackError('mutation readback mismatch');
      }
      return {
        ...success(input.roomId, input.request.ownerPrincipalId, next),
        changed,
      };
    });
  } catch (error) {
    return error instanceof PublicPolicyReadbackError
      ? failure('readback-failed')
      : failure('internal-error');
  }
};
