import {
  PUBLIC_ACCESS_MODES,
  type PublicAccessMode,
  type PublicPolicyManagementResultV1,
} from './types';

const LOWERCASE_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DOCUMENT_ROOM_ID = /^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u;
const CLAIM_ID = /^claim-v1-[0-9a-f]{64}$/u;
const PRINCIPAL_ID = /^account:v1:[A-Za-z0-9_-]{43}$/u;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
};

export const hasValidPublicProjection = (
  value: Record<string, unknown>,
  pathKey: 'publicPath' | 'publicUrl',
  keys: readonly string[],
) => {
  if (!Object.hasOwn(value, 'publicProjectionBlocked')) return hasExactKeys(value, keys);
  return (
    value.publicProjectionBlocked === true &&
    value[pathKey] === null &&
    hasExactKeys(value, [...keys, 'publicProjectionBlocked'])
  );
};

export const isPublicAccessMode = (value: unknown): value is PublicAccessMode =>
  typeof value === 'string' && PUBLIC_ACCESS_MODES.includes(value as PublicAccessMode);

const isPositiveVersion = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;

const isCutoff = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

export const parsePublicAccessPatchBody = (
  raw: string,
):
  | {
      ok: true;
      request: {
        version: 1;
        mode: PublicAccessMode;
        expectedPolicyVersion: number;
        mutationId: string;
      };
    }
  | { ok: false } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false };
  }
  if (
    !isPlainObject(parsed) ||
    !hasExactKeys(parsed, ['version', 'mode', 'expectedPolicyVersion', 'mutationId']) ||
    parsed.version !== 1 ||
    !isPublicAccessMode(parsed.mode) ||
    !isPositiveVersion(parsed.expectedPolicyVersion) ||
    typeof parsed.mutationId !== 'string' ||
    !LOWERCASE_UUID_V4.test(parsed.mutationId)
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    request: {
      version: 1,
      mode: parsed.mode,
      expectedPolicyVersion: parsed.expectedPolicyVersion,
      mutationId: parsed.mutationId,
    },
  };
};

const isPublicPath = (value: unknown, roomId: string) =>
  value === null || value === `/public/${roomId}`;

const isCanonicalPublicPath = (value: unknown) =>
  typeof value === 'string' &&
  value.startsWith('/public/') &&
  DOCUMENT_ROOM_ID.test(value.slice('/public/'.length));

export const parsePublicPolicyManagementResult = (
  value: unknown,
  status: number,
  expected: {
    claimId: string;
    ownerPrincipalId: string;
    operation: 'read' | 'update';
  },
): PublicPolicyManagementResultV1 | null => {
  if (!isPlainObject(value) || value.version !== 1 || typeof value.ok !== 'boolean') return null;
  if (value.ok) {
    const expectedKeys =
      expected.operation === 'update'
        ? [
            'ok',
            'version',
            'claimId',
            'roomId',
            'ownerPrincipalId',
            'mode',
            'policyVersion',
            'cutoffGeneration',
            'publicPath',
            'changed',
          ]
        : [
            'ok',
            'version',
            'claimId',
            'roomId',
            'ownerPrincipalId',
            'mode',
            'policyVersion',
            'cutoffGeneration',
            'publicPath',
          ];
    if (
      status !== 200 ||
      !hasValidPublicProjection(value, 'publicPath', expectedKeys) ||
      value.claimId !== expected.claimId ||
      !CLAIM_ID.test(String(value.claimId)) ||
      typeof value.roomId !== 'string' ||
      !DOCUMENT_ROOM_ID.test(value.roomId) ||
      value.ownerPrincipalId !== expected.ownerPrincipalId ||
      !PRINCIPAL_ID.test(String(value.ownerPrincipalId)) ||
      !isPublicAccessMode(value.mode) ||
      !isPositiveVersion(value.policyVersion) ||
      !isCutoff(value.cutoffGeneration) ||
      !isPublicPath(value.publicPath, value.roomId) ||
      (expected.operation === 'update' && typeof value.changed !== 'boolean')
    ) {
      return null;
    }
    return value as unknown as PublicPolicyManagementResultV1;
  }

  const baseKeys = ['ok', 'version', 'error', 'retryable'];
  const hasState = Object.prototype.hasOwnProperty.call(value, 'state');
  if (
    !hasExactKeys(value, hasState ? [...baseKeys, 'state'] : baseKeys) ||
    typeof value.error !== 'string' ||
    typeof value.retryable !== 'boolean'
  ) {
    return null;
  }
  const statuses: Record<string, { status: number; retryable: boolean }> = {
    'invalid-request': { status: 400, retryable: false },
    unauthorized: { status: 401, retryable: false },
    'promotion-disabled': { status: 503, retryable: false },
    'claim-not-found': { status: 404, retryable: false },
    'claim-conflict': { status: 409, retryable: false },
    'owner-mismatch': { status: 409, retryable: false },
    'not-shareable': { status: 409, retryable: false },
    'policy-conflict': { status: 409, retryable: false },
    'replay-detected': { status: 409, retryable: false },
    'readback-failed': { status: 500, retryable: true },
    'internal-error': { status: 500, retryable: true },
  };
  const pair = statuses[value.error];
  if (!pair || pair.status !== status || pair.retryable !== value.retryable) return null;
  if (hasState) {
    const state = value.state;
    if (
      !isPlainObject(state) ||
      !hasValidPublicProjection(state, 'publicPath', [
        'mode',
        'policyVersion',
        'cutoffGeneration',
        'publicPath',
      ]) ||
      !isPublicAccessMode(state.mode) ||
      !isPositiveVersion(state.policyVersion) ||
      !isCutoff(state.cutoffGeneration) ||
      (state.publicPath !== null && !isCanonicalPublicPath(state.publicPath))
    ) {
      return null;
    }
  }
  return value as unknown as PublicPolicyManagementResultV1;
};
