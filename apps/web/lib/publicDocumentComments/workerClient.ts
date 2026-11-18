import {
  canonicalize,
  type PublicCommentCreateRequestV1,
  type PublicCommentCreateResultV1,
  type PublicCommentDtoV1,
  type PublicCommentListRequestV1,
  type PublicCommentListResultV1,
  type PublicCommentModerationRequestV1,
  type PublicCommentModerationResultV1,
} from '@lash/types';
import { createHash, createHmac, randomUUID as nodeRandomUUID } from 'node:crypto';

import { canonicalPublicCommentBody } from './boundary';

const COMMENT_ASSERTION_DOMAIN = 'lash-worker-public-comment:v1';
const COMMENT_LIST_AUDIENCE = 'public-comment-list-v1';
const COMMENT_CREATE_AUDIENCE = 'public-comment-create-v1';
const COMMENT_SERVICE = 'lash-web-bff-v1';
const MANAGEMENT_ASSERTION_DOMAIN = 'lash-worker-control:v2';
const REQUEST_TIMEOUT_MS = 8_000;
const RESPONSE_BYTES_LIMIT = 256 * 1_024;
const LOWERCASE_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ROOM_ID = /^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u;
const CLAIM_ID = /^claim-v1-[0-9a-f]{64}$/u;
const COMMENT_ID = /^pc-v1-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const COMMENT_ALIAS = /^Commenter [A-Za-z0-9_-]{6}$/u;

export type PublicCommentWorkerOutcome =
  | Readonly<{
      kind: 'verified';
      status: number;
      result: PublicCommentListResultV1 | PublicCommentCreateResultV1;
      retryAfter?: 60;
    }>
  | Readonly<{ kind: 'timeout' | 'unverified-failure' }>;

export type PublicCommentModerationWorkerOutcome =
  | Readonly<{
      kind: 'verified';
      status: number;
      result: PublicCommentModerationResultV1;
    }>
  | Readonly<{ kind: 'timeout' | 'unverified-failure' }>;

export type PublicCommentWorkerCall =
  | Readonly<{
      action: 'list';
      workerOrigin: string;
      commentControlSecret: string;
      request: PublicCommentListRequestV1;
    }>
  | Readonly<{
      action: 'create';
      workerOrigin: string;
      commentControlSecret: string;
      request: PublicCommentCreateRequestV1;
    }>;

export type PublicCommentModerationWorkerCall = Readonly<{
  workerOrigin: string;
  controlSecret: string;
  request: PublicCommentModerationRequestV1;
}>;

export type PublicCommentWorkerDependencies = Readonly<{
  fetchImpl: typeof fetch;
  now: () => Date;
  randomUUID: () => string;
  timeoutMs?: number;
}>;

const defaultDependencies: PublicCommentWorkerDependencies = {
  fetchImpl: fetch,
  now: () => new Date(),
  randomUUID: nodeRandomUUID,
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
};

const positiveInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;

const cutoffGeneration = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

const canonicalDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;

const parseCommentDto = (value: unknown): PublicCommentDtoV1 | null => {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ['id', 'sequence', 'anchor', 'body', 'author', 'createdAt']) ||
    typeof value.id !== 'string' ||
    !COMMENT_ID.test(value.id) ||
    !positiveInteger(value.sequence) ||
    typeof value.body !== 'string' ||
    canonicalPublicCommentBody(value.body) !== value.body ||
    !canonicalDate(value.createdAt) ||
    !isPlainObject(value.anchor) ||
    !hasExactKeys(value.anchor, ['kind']) ||
    value.anchor.kind !== 'document' ||
    !isPlainObject(value.author) ||
    !hasExactKeys(value.author, ['label']) ||
    typeof value.author.label !== 'string' ||
    !COMMENT_ALIAS.test(value.author.label)
  ) {
    return null;
  }
  return value as unknown as PublicCommentDtoV1;
};

const parseAuthorization = (
  value: unknown,
  expected: {
    roomId: string;
    expectedPolicyVersion: number;
    expectedCutoffGeneration: number;
  },
) =>
  isPlainObject(value) &&
  hasExactKeys(value, ['roomId', 'mode', 'policyVersion', 'cutoffGeneration']) &&
  value.roomId === expected.roomId &&
  value.mode === 'comment' &&
  value.policyVersion === expected.expectedPolicyVersion &&
  value.cutoffGeneration === expected.expectedCutoffGeneration;

const publicFailurePairs: Record<string, { status: number; retryable: boolean }> = {
  'invalid-request': { status: 400, retryable: false },
  unauthorized: { status: 401, retryable: false },
  'public-comment-disabled': { status: 503, retryable: false },
  'replay-detected': { status: 409, retryable: false },
  'public-access-changed': { status: 409, retryable: false },
  'idempotency-conflict': { status: 409, retryable: false },
  'rate-limited': { status: 429, retryable: true },
  'readback-failed': { status: 500, retryable: true },
  'internal-error': { status: 500, retryable: true },
};

const parsePublicCommentResult = (
  value: unknown,
  status: number,
  action: 'list' | 'create',
  expected: PublicCommentListRequestV1 | PublicCommentCreateRequestV1,
): PublicCommentListResultV1 | PublicCommentCreateResultV1 | null => {
  if (!isPlainObject(value) || value.version !== 1 || typeof value.ok !== 'boolean') return null;
  if (!value.ok) {
    if (
      !hasExactKeys(value, ['ok', 'version', 'error', 'retryable']) ||
      typeof value.error !== 'string' ||
      typeof value.retryable !== 'boolean'
    ) {
      return null;
    }
    const pair = publicFailurePairs[value.error];
    return pair?.status === status && pair.retryable === value.retryable
      ? (value as unknown as PublicCommentListResultV1 | PublicCommentCreateResultV1)
      : null;
  }
  if (
    !parseAuthorization(value.authorization, expected) ||
    (action === 'list'
      ? status !== 200 ||
        !hasExactKeys(value, [
          'ok',
          'version',
          'authorization',
          'comments',
          'nextBeforeSequence',
        ]) ||
        !Array.isArray(value.comments) ||
        value.comments.length > 50 ||
        value.comments.some((comment) => parseCommentDto(comment) === null) ||
        !(value.nextBeforeSequence === null || positiveInteger(value.nextBeforeSequence))
      : !hasExactKeys(value, ['ok', 'version', 'created', 'authorization', 'comment']) ||
        typeof value.created !== 'boolean' ||
        status !== (value.created ? 201 : 200) ||
        parseCommentDto(value.comment) === null)
  ) {
    return null;
  }
  return value as unknown as PublicCommentListResultV1 | PublicCommentCreateResultV1;
};

const moderationFailurePairs: Record<string, { status: number; retryable: boolean }> = {
  'invalid-request': { status: 400, retryable: false },
  unauthorized: { status: 401, retryable: false },
  'promotion-disabled': { status: 503, retryable: false },
  'claim-not-found': { status: 404, retryable: false },
  'comment-not-found': { status: 404, retryable: false },
  'claim-conflict': { status: 409, retryable: false },
  'owner-mismatch': { status: 409, retryable: false },
  'not-shareable': { status: 409, retryable: false },
  'replay-detected': { status: 409, retryable: false },
  'policy-conflict': { status: 409, retryable: false },
  'readback-failed': { status: 500, retryable: true },
  'internal-error': { status: 500, retryable: true },
};

const parseModerationResult = (
  value: unknown,
  status: number,
  expected: PublicCommentModerationRequestV1,
): PublicCommentModerationResultV1 | null => {
  if (!isPlainObject(value) || value.version !== 1 || typeof value.ok !== 'boolean') return null;
  if (value.ok) {
    if (
      status !== 200 ||
      !hasExactKeys(value, [
        'ok',
        'version',
        'claimId',
        'roomId',
        'commentId',
        'state',
        'changed',
        'policyVersion',
        'cutoffGeneration',
        'moderatedAt',
      ]) ||
      value.claimId !== expected.claimId ||
      typeof value.roomId !== 'string' ||
      !ROOM_ID.test(value.roomId) ||
      value.commentId !== expected.commentId ||
      value.state !== 'hidden' ||
      typeof value.changed !== 'boolean' ||
      value.policyVersion !== expected.expectedPolicyVersion ||
      value.cutoffGeneration !== expected.expectedCutoffGeneration ||
      !canonicalDate(value.moderatedAt)
    ) {
      return null;
    }
    return value as unknown as PublicCommentModerationResultV1;
  }
  if (
    typeof value.error !== 'string' ||
    typeof value.retryable !== 'boolean' ||
    !moderationFailurePairs[value.error] ||
    moderationFailurePairs[value.error]?.status !== status ||
    moderationFailurePairs[value.error]?.retryable !== value.retryable
  ) {
    return null;
  }
  if (value.error !== 'policy-conflict') {
    return hasExactKeys(value, ['ok', 'version', 'error', 'retryable'])
      ? (value as unknown as PublicCommentModerationResultV1)
      : null;
  }
  if (
    !hasExactKeys(value, ['ok', 'version', 'error', 'retryable', 'state']) ||
    !isPlainObject(value.state) ||
    !hasExactKeys(value.state, ['mode', 'policyVersion', 'cutoffGeneration', 'publicPath']) ||
    (value.state.mode !== 'restricted' &&
      value.state.mode !== 'read' &&
      value.state.mode !== 'comment') ||
    !positiveInteger(value.state.policyVersion) ||
    !cutoffGeneration(value.state.cutoffGeneration) ||
    !(
      value.state.publicPath === null ||
      (typeof value.state.publicPath === 'string' &&
        /^\/public\/doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u.test(value.state.publicPath))
    )
  ) {
    return null;
  }
  return value as unknown as PublicCommentModerationResultV1;
};

const readBoundedJson = async (response: Response) => {
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) || Number(declaredLength) > RESPONSE_BYTES_LIMIT)
  ) {
    return null;
  }
  if (
    response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !==
      'application/json' ||
    !response.body
  ) {
    return null;
  }
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
  if (declaredLength !== null && Number(declaredLength) !== total) return null;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return null;
  }
};

const executeWithDeadline = async <Outcome>(input: {
  operation(signal: AbortSignal): Promise<Outcome>;
  timeoutMs: number;
  timeoutOutcome: Outcome;
  failureOutcome: Outcome;
}): Promise<Outcome> => {
  const controller = new AbortController();
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error('public-comment-worker-timeout'));
    }, input.timeoutMs);
  });
  try {
    return await Promise.race([input.operation(controller.signal), deadline]);
  } catch {
    return timedOut ? input.timeoutOutcome : input.failureOutcome;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const safeOrigin = (raw: string) => {
  try {
    const url = new URL(raw);
    return (url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        (url.hostname === 'localhost' ||
          url.hostname === '127.0.0.1' ||
          url.hostname === '[::1]'))) &&
      url.origin === raw &&
      url.username === '' &&
      url.password === '' &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === ''
      ? url.origin
      : null;
  } catch {
    return null;
  }
};

export const callWorkerPublicComments = async (
  call: PublicCommentWorkerCall,
  dependencies: PublicCommentWorkerDependencies = defaultDependencies,
): Promise<PublicCommentWorkerOutcome> => {
  const workerOrigin = safeOrigin(call.workerOrigin);
  if (!workerOrigin || new TextEncoder().encode(call.commentControlSecret).byteLength < 32) {
    return { kind: 'unverified-failure' };
  }
  const pathname = `/api/public-comment-control/documents/${call.request.roomId}/comments/${call.action}`;
  const rawBody = canonicalize(call.request);
  const bodySha256 = createHash('sha256').update(rawBody, 'utf8').digest('base64url');
  const audience = call.action === 'list' ? COMMENT_LIST_AUDIENCE : COMMENT_CREATE_AUDIENCE;
  const assertedPrincipal = call.action === 'create' ? call.request.commenterPrincipalId : null;
  const fetchImpl = dependencies.fetchImpl;
  const now = dependencies.now;
  const randomUUID = dependencies.randomUUID;

  const attempt = () =>
    executeWithDeadline<PublicCommentWorkerOutcome>({
      timeoutMs: dependencies.timeoutMs ?? REQUEST_TIMEOUT_MS,
      timeoutOutcome: { kind: 'timeout' },
      failureOutcome: { kind: 'unverified-failure' },
      operation: async (signal) => {
        const requestId = randomUUID();
        if (!LOWERCASE_UUID_V4.test(requestId)) return { kind: 'unverified-failure' };
        const expiresAt = Math.floor(now().getTime() / 1_000) + 55;
        const canonical = [
          COMMENT_ASSERTION_DOMAIN,
          'POST',
          pathname,
          audience,
          COMMENT_SERVICE,
          assertedPrincipal ?? '-',
          bodySha256,
          requestId,
          String(expiresAt),
        ].join('\n');
        const signature = createHmac('sha256', call.commentControlSecret)
          .update(canonical, 'utf8')
          .digest('base64url');
        const response = await fetchImpl(`${workerOrigin}${pathname}`, {
          method: 'POST',
          headers: {
            authorization: `Lash-Public-Comment-Control v1:${signature}`,
            'content-type': 'application/json',
            'x-lash-control-audience': audience,
            'x-lash-control-service-id': COMMENT_SERVICE,
            'x-lash-control-body-sha256': bodySha256,
            'x-lash-control-request-id': requestId,
            'x-lash-control-expires-at': String(expiresAt),
            ...(assertedPrincipal ? { 'x-lash-control-principal-id': assertedPrincipal } : {}),
          },
          body: rawBody,
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'manual',
          signal,
        });
        if (response.status >= 300 && response.status < 400) {
          return { kind: 'unverified-failure' };
        }
        const value = await readBoundedJson(response);
        const result = parsePublicCommentResult(value, response.status, call.action, call.request);
        if (!result) return { kind: 'unverified-failure' };
        if (!result.ok && result.error === 'rate-limited') {
          return response.headers.get('retry-after') === '60'
            ? { kind: 'verified', status: response.status, result, retryAfter: 60 }
            : { kind: 'unverified-failure' };
        }
        return { kind: 'verified', status: response.status, result };
      },
    });

  const first = await attempt();
  return first.kind === 'verified' && !first.result.ok && first.result.error === 'replay-detected'
    ? attempt()
    : first;
};

export const callWorkerPublicCommentModeration = async (
  call: PublicCommentModerationWorkerCall,
  dependencies: PublicCommentWorkerDependencies = defaultDependencies,
): Promise<PublicCommentModerationWorkerOutcome> => {
  const workerOrigin = safeOrigin(call.workerOrigin);
  if (
    !workerOrigin ||
    !CLAIM_ID.test(call.request.claimId) ||
    new TextEncoder().encode(call.controlSecret).byteLength < 32
  ) {
    return { kind: 'unverified-failure' };
  }
  const pathname = `/api/management/document-claims/${call.request.claimId}/public-comments/moderate`;
  const rawBody = canonicalize(call.request);
  const bodySha256 = createHash('sha256').update(rawBody, 'utf8').digest('base64url');
  const fetchImpl = dependencies.fetchImpl;
  const now = dependencies.now;
  const randomUUID = dependencies.randomUUID;

  const attempt = () =>
    executeWithDeadline<PublicCommentModerationWorkerOutcome>({
      timeoutMs: dependencies.timeoutMs ?? REQUEST_TIMEOUT_MS,
      timeoutOutcome: { kind: 'timeout' },
      failureOutcome: { kind: 'unverified-failure' },
      operation: async (signal) => {
        const requestId = randomUUID();
        if (!LOWERCASE_UUID_V4.test(requestId)) return { kind: 'unverified-failure' };
        const expiresAt = Math.floor(now().getTime() / 1_000) + 55;
        const canonical = [
          MANAGEMENT_ASSERTION_DOMAIN,
          'POST',
          pathname,
          bodySha256,
          requestId,
          call.request.ownerPrincipalId,
          String(expiresAt),
        ].join('\n');
        const signature = createHmac('sha256', call.controlSecret)
          .update(canonical, 'utf8')
          .digest('base64url');
        const response = await fetchImpl(`${workerOrigin}${pathname}`, {
          method: 'POST',
          headers: {
            authorization: `Lash-Control v2:${signature}`,
            'content-type': 'application/json',
            'x-lash-control-body-sha256': bodySha256,
            'x-lash-control-request-id': requestId,
            'x-lash-control-principal-id': call.request.ownerPrincipalId,
            'x-lash-control-expires-at': String(expiresAt),
          },
          body: rawBody,
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'manual',
          signal,
        });
        if (response.status >= 300 && response.status < 400) {
          return { kind: 'unverified-failure' };
        }
        const value = await readBoundedJson(response);
        const result = parseModerationResult(value, response.status, call.request);
        return result
          ? { kind: 'verified', status: response.status, result }
          : { kind: 'unverified-failure' };
      },
    });

  const first = await attempt();
  return first.kind === 'verified' && !first.result.ok && first.result.error === 'replay-detected'
    ? attempt()
    : first;
};
