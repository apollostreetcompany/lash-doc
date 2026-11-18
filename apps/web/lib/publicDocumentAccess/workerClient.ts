import {
  canonicalize,
  type PublicControlSessionFailureV1,
  type PublicControlSessionRequestV1,
  type PublicControlSessionResultV1,
  type PublicControlSessionSuccessV1,
} from '@lash/types';
import { Buffer } from 'node:buffer';
import { createHash, createHmac, randomUUID as nodeRandomUUID } from 'node:crypto';

const ASSERTION_DOMAIN = 'lash-worker-public-session:v1';
const ASSERTION_AUDIENCE = 'public-read-session-v1';
const ASSERTION_SERVICE = 'lash-web-bff-v1';
const RESPONSE_BYTES_LIMIT = 16 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;
const TICKET_TTL_MS = 60_000;
const LOWERCASE_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ROOM_ID = /^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u;
const PUBLIC_TICKET_PROTOCOL = /^lash-public-ticket\.[A-Za-z0-9_-]{43}$/u;

export type PublicSessionWorkerOutcome =
  | { kind: 'verified'; result: PublicControlSessionResultV1 }
  | { kind: 'timeout' }
  | { kind: 'unverified-failure' };

export type WorkerPublicSessionCall = Readonly<{
  workerOrigin: string;
  publicControlSecret: string;
  request: PublicControlSessionRequestV1;
}>;

export type WorkerPublicSessionClientDependencies = Readonly<{
  fetchImpl: typeof fetch;
  now: () => Date;
  randomUUID: () => string;
  timeoutMs?: number;
}>;

const defaultDependencies: WorkerPublicSessionClientDependencies = {
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

const isPolicyVersion = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;

const isCutoffGeneration = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

const parseCanonicalFutureDate = (value: unknown, now: Date) => {
  if (typeof value !== 'string') return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value &&
    milliseconds > now.getTime() &&
    milliseconds <= now.getTime() + TICKET_TTL_MS
    ? value
    : null;
};

const parseWorkerResult = (
  value: unknown,
  status: number,
  expected: PublicControlSessionRequestV1,
  observedAt: Date,
): PublicControlSessionResultV1 | null => {
  if (!isPlainObject(value) || value.version !== 1 || typeof value.ok !== 'boolean') return null;
  if (value.ok) {
    if (
      status !== 200 ||
      !hasExactKeys(value, ['ok', 'version', 'authorization', 'grant', 'socket']) ||
      !isPlainObject(value.authorization) ||
      !hasExactKeys(value.authorization, ['roomId', 'mode', 'policyVersion', 'cutoffGeneration']) ||
      value.authorization.roomId !== expected.roomId ||
      !ROOM_ID.test(String(value.authorization.roomId)) ||
      (value.authorization.mode !== 'read' && value.authorization.mode !== 'comment') ||
      !isPolicyVersion(value.authorization.policyVersion) ||
      !isCutoffGeneration(value.authorization.cutoffGeneration) ||
      !isPlainObject(value.grant) ||
      !hasExactKeys(value.grant, ['source', 'capabilities', 'protocolVersion']) ||
      value.grant.source !== 'public' ||
      !Array.isArray(value.grant.capabilities) ||
      value.grant.capabilities.length !== 1 ||
      value.grant.capabilities[0] !== 'doc.read' ||
      value.grant.protocolVersion !== 4 ||
      !isPlainObject(value.socket) ||
      !hasExactKeys(value.socket, ['path', 'protocol', 'ticketProtocol', 'expiresAt']) ||
      value.socket.path !==
        `/api/realtime/rooms/${expected.roomId}/socket?protocolVersion=4&actorId=${expected.actorId}` ||
      value.socket.protocol !== 'lash-realtime-v4' ||
      typeof value.socket.ticketProtocol !== 'string' ||
      !PUBLIC_TICKET_PROTOCOL.test(value.socket.ticketProtocol) ||
      parseCanonicalFutureDate(value.socket.expiresAt, observedAt) === null
    ) {
      return null;
    }
    return value as unknown as PublicControlSessionSuccessV1;
  }

  if (
    !hasExactKeys(value, ['ok', 'version', 'error', 'retryable']) ||
    typeof value.error !== 'string' ||
    typeof value.retryable !== 'boolean'
  ) {
    return null;
  }
  const expectedFailure: Record<string, { status: number; retryable: boolean }> = {
    'invalid-request': { status: 400, retryable: false },
    unauthorized: { status: 401, retryable: false },
    'document-unavailable': { status: 404, retryable: false },
    'replay-detected': { status: 409, retryable: false },
    'protocol-mismatch': { status: 409, retryable: false },
    'rate-limited': { status: 429, retryable: true },
    'readback-failed': { status: 500, retryable: true },
    'internal-error': { status: 500, retryable: true },
  };
  const pair = expectedFailure[value.error];
  return pair?.status === status && pair.retryable === value.retryable
    ? (value as unknown as PublicControlSessionFailureV1)
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

export const callWorkerPublicSession = async (
  call: WorkerPublicSessionCall,
  dependencies: WorkerPublicSessionClientDependencies = defaultDependencies,
): Promise<PublicSessionWorkerOutcome> => {
  const pathname = `/api/public-control/documents/${call.request.roomId}/session`;
  const rawBody = canonicalize(call.request);
  const bodySha256 = createHash('sha256').update(rawBody, 'utf8').digest('base64url');
  const requestId = dependencies.randomUUID();
  if (!LOWERCASE_UUID_V4.test(requestId)) return { kind: 'unverified-failure' };
  const expiresAt = Math.floor(dependencies.now().getTime() / 1000) + 55;
  const assertion = [
    ASSERTION_DOMAIN,
    'POST',
    pathname,
    ASSERTION_AUDIENCE,
    ASSERTION_SERVICE,
    bodySha256,
    requestId,
    String(expiresAt),
  ].join('\n');
  const signature = createHmac('sha256', call.publicControlSecret)
    .update(assertion, 'utf8')
    .digest('base64url');

  const controller = new AbortController();
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error('public-session-worker-timeout'));
    }, dependencies.timeoutMs ?? REQUEST_TIMEOUT_MS);
  });

  const operation = async (): Promise<PublicSessionWorkerOutcome> => {
    const response = await dependencies.fetchImpl(`${call.workerOrigin}${pathname}`, {
      method: 'POST',
      headers: {
        authorization: `Lash-Public-Control v1:${signature}`,
        'content-type': 'application/json',
        'x-lash-control-audience': ASSERTION_AUDIENCE,
        'x-lash-control-service-id': ASSERTION_SERVICE,
        'x-lash-control-body-sha256': bodySha256,
        'x-lash-control-request-id': requestId,
        'x-lash-control-expires-at': String(expiresAt),
      },
      body: rawBody,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'manual',
      signal: controller.signal,
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
    if (response.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/json') {
      return { kind: 'unverified-failure' };
    }
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
  };

  try {
    return await Promise.race([operation(), deadline]);
  } catch {
    return timedOut ? { kind: 'timeout' } : { kind: 'unverified-failure' };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};
