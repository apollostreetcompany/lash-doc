import { canonicalize } from '@lash/types';
import { Buffer } from 'node:buffer';
import { createHash, createHmac, randomUUID as nodeRandomUUID } from 'node:crypto';

import type {
  PublicPolicyManagementReadRequestV1,
  PublicPolicyManagementResultV1,
  PublicPolicyManagementUpdateRequestV1,
} from './types';
import { parsePublicPolicyManagementResult } from './validation';

const MANAGEMENT_ASSERTION_DOMAIN = 'lash-worker-control:v2';
const RESPONSE_BYTES_LIMIT = 16 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;
const LOWERCASE_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface WorkerPublicPolicyCall {
  workerOrigin: string;
  controlSecret: string;
  operation: 'read' | 'update';
  request: PublicPolicyManagementReadRequestV1 | PublicPolicyManagementUpdateRequestV1;
}

export interface WorkerPublicPolicyDependencies {
  fetchImpl: typeof fetch;
  now: () => Date;
  randomUUID: () => string;
  timeoutMs?: number;
}

const defaultDependencies: WorkerPublicPolicyDependencies = {
  fetchImpl: fetch,
  now: () => new Date(),
  randomUUID: nodeRandomUUID,
};

const internalFailure = (): PublicPolicyManagementResultV1 => ({
  ok: false,
  version: 1,
  error: 'internal-error',
  retryable: true,
});

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

export const callWorkerPublicPolicy = async (
  call: WorkerPublicPolicyCall,
  dependencies: WorkerPublicPolicyDependencies = defaultDependencies,
): Promise<PublicPolicyManagementResultV1> => {
  const pathname = `/api/management/document-claims/${call.request.claimId}/public-policy/${call.operation}`;
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
    if (response.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/json') {
      return internalFailure();
    }
    const bytes = await readBoundedResponse(response);
    if (!bytes) return internalFailure();
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString('utf8')) as unknown;
    } catch {
      return internalFailure();
    }
    return (
      parsePublicPolicyManagementResult(value, response.status, {
        claimId: call.request.claimId,
        ownerPrincipalId: call.request.ownerPrincipalId,
        operation: call.operation,
      }) ?? internalFailure()
    );
  } catch {
    return internalFailure();
  } finally {
    clearTimeout(timeout);
  }
};
