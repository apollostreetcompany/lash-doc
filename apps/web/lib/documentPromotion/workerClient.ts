import {
  canonicalize,
  type DocumentClaimPromotionFailureV2,
  type DocumentClaimPromotionRequestV2,
  type DocumentClaimPromotionResultV2,
  type DocumentClaimPromotionSuccessV2,
} from '@lash/types';
import { createHash, createHmac, randomUUID as nodeRandomUUID } from 'node:crypto';

const MANAGEMENT_ASSERTION_DOMAIN = 'lash-worker-control:v2';
const RESPONSE_BYTES_LIMIT = 32 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;
const LOWERCASE_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DOCUMENT_ROOM_ID = /^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u;

export interface WorkerPromotionCall {
  workerOrigin: string;
  controlSecret: string;
  request: DocumentClaimPromotionRequestV2;
}

export interface WorkerPromotionClientDependencies {
  fetchImpl: typeof fetch;
  now: () => Date;
  randomUUID: () => string;
  timeoutMs?: number;
}

const defaultDependencies: WorkerPromotionClientDependencies = {
  fetchImpl: fetch,
  now: () => new Date(),
  randomUUID: nodeRandomUUID,
};

const internalFailure = (): DocumentClaimPromotionFailureV2 => ({
  ok: false,
  version: 2,
  error: 'internal-error',
  retryable: true,
});

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
};

const parseWorkerResult = (
  value: unknown,
  status: number,
  expected: DocumentClaimPromotionRequestV2,
): DocumentClaimPromotionResultV2 | null => {
  if (!isPlainObject(value) || value.version !== 2 || typeof value.ok !== 'boolean') return null;
  if (value.ok) {
    if (
      status !== 200 ||
      !hasExactKeys(value, [
        'ok',
        'version',
        'claimId',
        'roomId',
        'ownerPrincipalId',
        'aclVersion',
        'publicPolicy',
        'publicPolicyVersion',
        'snapshotSha256',
        'created',
      ]) ||
      value.claimId !== expected.claimId ||
      typeof value.roomId !== 'string' ||
      !DOCUMENT_ROOM_ID.test(value.roomId) ||
      value.ownerPrincipalId !== expected.ownerPrincipalId ||
      value.aclVersion !== 1 ||
      value.publicPolicy !== 'restricted' ||
      value.publicPolicyVersion !== 1 ||
      value.snapshotSha256 !== expected.snapshot.snapshotSha256 ||
      typeof value.created !== 'boolean'
    ) {
      return null;
    }
    return value as unknown as DocumentClaimPromotionSuccessV2;
  }

  if (
    !hasExactKeys(value, ['ok', 'version', 'error', 'retryable']) ||
    typeof value.error !== 'string' ||
    typeof value.retryable !== 'boolean'
  ) {
    return null;
  }
  const expectedPair: Record<string, { status: number; retryable: boolean }> = {
    'invalid-request': { status: 400, retryable: false },
    unauthorized: { status: 401, retryable: false },
    'upgrade-required': { status: 400, retryable: false },
    'promotion-not-found': { status: 404, retryable: false },
    'replay-detected': { status: 409, retryable: false },
    'owner-mismatch': { status: 409, retryable: false },
    'promotion-conflict': { status: 409, retryable: false },
    'claim-conflict': { status: 409, retryable: false },
    'promotion-disabled': { status: 503, retryable: false },
    'readback-failed': { status: 500, retryable: true },
    'internal-error': { status: 500, retryable: true },
  };
  const pair = expectedPair[value.error];
  return pair?.status === status && pair.retryable === value.retryable
    ? (value as unknown as DocumentClaimPromotionFailureV2)
    : null;
};

const readBoundedResponse = async (response: Response) => {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > RESPONSE_BYTES_LIMIT) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
};

export const callWorkerPromotion = async (
  call: WorkerPromotionCall,
  dependencies: WorkerPromotionClientDependencies = defaultDependencies,
): Promise<DocumentClaimPromotionResultV2> => {
  const pathname = `/api/management/document-claims/${call.request.claimId}/promote`;
  const rawBody = canonicalize(call.request);
  const bodySha256 = createHash('sha256').update(rawBody, 'utf8').digest('base64url');
  const requestId = dependencies.randomUUID();
  if (!LOWERCASE_UUID_V4.test(requestId)) return internalFailure();
  const expiresAt = Math.floor(dependencies.now().getTime() / 1000) + 55;
  const assertion = [
    MANAGEMENT_ASSERTION_DOMAIN,
    'POST',
    pathname,
    bodySha256,
    requestId,
    call.request.ownerPrincipalId,
    String(expiresAt),
  ].join('\n');
  const signature = createHmac('sha256', call.controlSecret)
    .update(assertion, 'utf8')
    .digest('base64url');

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), dependencies.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const response = await dependencies.fetchImpl(`${call.workerOrigin}${pathname}`, {
      method: 'POST',
      headers: {
        authorization: `Lash-Control v2:${signature}`,
        'content-type': 'application/json',
        'x-lash-control-body-sha256': bodySha256,
        'x-lash-control-expires-at': String(expiresAt),
        'x-lash-control-principal-id': call.request.ownerPrincipalId,
        'x-lash-control-request-id': requestId,
      },
      body: rawBody,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'manual',
      signal: abort.signal,
    });
    if (response.status >= 300 && response.status < 400) return internalFailure();
    const declaredLength = response.headers.get('content-length');
    if (
      declaredLength !== null &&
      (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) ||
        Number(declaredLength) > RESPONSE_BYTES_LIMIT)
    ) {
      return internalFailure();
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
    if (contentType !== 'application/json') return internalFailure();
    const bytes = await readBoundedResponse(response);
    if (!bytes) return internalFailure();
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString('utf8')) as unknown;
    } catch {
      return internalFailure();
    }
    return parseWorkerResult(value, response.status, call.request) ?? internalFailure();
  } catch {
    return internalFailure();
  } finally {
    clearTimeout(timeout);
  }
};
