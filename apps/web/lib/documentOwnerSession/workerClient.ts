import {
  canonicalize,
  type OwnerSessionManagementRequestV1,
  type OwnerSessionManagementResultV1,
  type OwnerSessionManagementSuccessV1,
} from '@lash/types';
import { Buffer } from 'node:buffer';
import { createHash, createHmac, randomUUID as nodeRandomUUID } from 'node:crypto';

const MANAGEMENT_ASSERTION_DOMAIN = 'lash-worker-control:v2';
const RESPONSE_BYTES_LIMIT = 16 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;
const TICKET_TTL_MS = 60_000;
const LOWERCASE_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CLAIM_ID = /^claim-v1-[0-9a-f]{64}$/u;
const PRINCIPAL_ID = /^account:v1:[A-Za-z0-9_-]{43}$/u;
const DOCUMENT_ROOM_ID = /^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u;
const BASE64URL_SHA256 = /^[A-Za-z0-9_-]{43}$/u;
const TICKET_PROTOCOL = /^lash-ticket\.[A-Za-z0-9_-]{43}$/u;

export type OwnerSessionBoundaryFailureV1 = {
  ok: false;
  version: 1;
  error: 'invalid-request' | 'unauthorized' | 'promotion-disabled';
  retryable: false;
};

export type VerifiedOwnerSessionResultV1 =
  | OwnerSessionManagementResultV1
  | OwnerSessionBoundaryFailureV1;
export type VerifiedOwnerSessionFailureV1 = Exclude<VerifiedOwnerSessionResultV1, { ok: true }>;

export type OwnerSessionWorkerOutcome =
  | { kind: 'verified'; result: VerifiedOwnerSessionResultV1 }
  | { kind: 'timeout' }
  | { kind: 'unverified-failure' };

export interface WorkerOwnerSessionCall {
  workerOrigin: string;
  controlSecret: string;
  request: OwnerSessionManagementRequestV1;
}

export interface WorkerOwnerSessionClientDependencies {
  fetchImpl: typeof fetch;
  now: () => Date;
  randomUUID: () => string;
  timeoutMs?: number;
}

const defaultDependencies: WorkerOwnerSessionClientDependencies = {
  fetchImpl: fetch,
  now: () => new Date(),
  randomUUID: nodeRandomUUID,
};

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

const parseCanonicalIsoDate = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) return null;
  return milliseconds;
};

const parseWorkerResult = (
  value: unknown,
  status: number,
  expected: OwnerSessionManagementRequestV1,
  observedAt: Date,
): VerifiedOwnerSessionResultV1 | null => {
  if (!isPlainObject(value) || value.version !== 1 || typeof value.ok !== 'boolean') return null;
  if (value.ok) {
    if (
      status !== 200 ||
      !hasExactKeys(value, [
        'ok',
        'version',
        'claimId',
        'roomId',
        'ownerPrincipalId',
        'promotionSnapshotSha256',
        'grant',
        'socket',
      ]) ||
      value.claimId !== expected.claimId ||
      !CLAIM_ID.test(value.claimId) ||
      typeof value.roomId !== 'string' ||
      !DOCUMENT_ROOM_ID.test(value.roomId) ||
      value.ownerPrincipalId !== expected.ownerPrincipalId ||
      !PRINCIPAL_ID.test(value.ownerPrincipalId) ||
      typeof value.promotionSnapshotSha256 !== 'string' ||
      !BASE64URL_SHA256.test(value.promotionSnapshotSha256) ||
      !isPlainObject(value.grant) ||
      !hasExactKeys(value.grant, ['source', 'capabilities', 'aclVersion', 'protocolVersion']) ||
      value.grant.source !== 'owner' ||
      !Array.isArray(value.grant.capabilities) ||
      value.grant.capabilities.length !== 2 ||
      value.grant.capabilities[0] !== 'doc.read' ||
      value.grant.capabilities[1] !== 'doc.edit' ||
      value.grant.aclVersion !== 1 ||
      value.grant.protocolVersion !== 3 ||
      !isPlainObject(value.socket) ||
      !hasExactKeys(value.socket, ['path', 'ticket', 'expiresAt']) ||
      typeof value.socket.path !== 'string' ||
      value.socket.path !==
        `/api/realtime/rooms/${value.roomId}/socket?protocolVersion=3&actorId=${expected.actorId}` ||
      typeof value.socket.ticket !== 'string' ||
      !TICKET_PROTOCOL.test(value.socket.ticket)
    ) {
      return null;
    }
    const expiresAt = parseCanonicalIsoDate(value.socket.expiresAt);
    if (
      expiresAt === null ||
      expiresAt <= observedAt.getTime() ||
      expiresAt > observedAt.getTime() + TICKET_TTL_MS
    ) {
      return null;
    }
    return value as unknown as OwnerSessionManagementSuccessV1;
  }

  if (
    !hasExactKeys(value, ['ok', 'version', 'error', 'retryable']) ||
    typeof value.error !== 'string' ||
    typeof value.retryable !== 'boolean'
  ) {
    return null;
  }
  const expectedPair: Record<string, { status: number; retryable: boolean }> = {
    'claim-not-found': { status: 404, retryable: false },
    'claim-conflict': { status: 409, retryable: false },
    'owner-mismatch': { status: 409, retryable: false },
    'not-shareable': { status: 409, retryable: false },
    'readback-failed': { status: 500, retryable: true },
    'internal-error': { status: 500, retryable: true },
    'invalid-request': { status: 400, retryable: false },
    unauthorized: { status: 401, retryable: false },
    'promotion-disabled': { status: 503, retryable: false },
  };
  const pair = expectedPair[value.error];
  return pair?.status === status && pair.retryable === value.retryable
    ? (value as unknown as VerifiedOwnerSessionFailureV1)
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

export type { OwnerSessionManagementRequestV1 };

export const callWorkerOwnerSession = async (
  call: WorkerOwnerSessionCall,
  dependencies: WorkerOwnerSessionClientDependencies = defaultDependencies,
): Promise<OwnerSessionWorkerOutcome> => {
  const pathname = `/api/management/document-claims/${call.request.claimId}/owner-session`;
  const rawBody = canonicalize(call.request);
  const bodySha256 = createHash('sha256').update(rawBody, 'utf8').digest('base64url');
  const requestId = dependencies.randomUUID();
  if (!LOWERCASE_UUID_V4.test(requestId)) return { kind: 'unverified-failure' };
  const issuedAt = dependencies.now();
  const expiresAt = Math.floor(issuedAt.getTime() / 1000) + 55;
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
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, dependencies.timeoutMs ?? REQUEST_TIMEOUT_MS);
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
    if (response.status >= 300 && response.status < 400) return { kind: 'unverified-failure' };
    const declaredLength = response.headers.get('content-length');
    if (
      declaredLength !== null &&
      (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) ||
        Number(declaredLength) > RESPONSE_BYTES_LIMIT)
    ) {
      return { kind: 'unverified-failure' };
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
    if (contentType !== 'application/json') return { kind: 'unverified-failure' };
    const bytes = await readBoundedResponse(response);
    if (!bytes) return { kind: 'unverified-failure' };
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString('utf8')) as unknown;
    } catch {
      return { kind: 'unverified-failure' };
    }
    const result = parseWorkerResult(value, response.status, call.request, dependencies.now());
    return result ? { kind: 'verified', result } : { kind: 'unverified-failure' };
  } catch {
    return timedOut ? { kind: 'timeout' } : { kind: 'unverified-failure' };
  } finally {
    clearTimeout(timeout);
  }
};
