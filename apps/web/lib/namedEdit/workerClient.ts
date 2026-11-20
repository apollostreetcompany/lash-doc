import 'server-only';

import { canonicalize } from '@lash/types';
import { createHash, createHmac, randomUUID } from 'node:crypto';

import {
  NAMED_EDIT_INVITE_ID,
  hasKeys,
  isIsoDate,
  isNamedEditStatus,
  isNamedInviteRole,
  isObject,
  namedEditGrantFields,
  validNamedEditGrant,
  type NamedCommentInviteError,
  type NamedEditGrant,
  type NamedEditOperation,
  type NamedEditInvite,
} from './contract';

type WorkerNamedInvite = Omit<NamedEditInvite, 'email'> & { emailCiphertext: string };

type WorkerResult =
  | { ok: true; kind: 'issue' | 'revoke'; invite: WorkerNamedInvite }
  | { ok: true; kind: 'list'; invites: WorkerNamedInvite[] }
  | { ok: true; kind: 'session'; session: NamedEditGrant }
  | {
      ok: false;
      status: 400 | 403 | 404 | 409 | 429 | 502 | 503;
      commentError?: NamedCommentInviteError;
    };

type WorkerAuthority = {
  workerOrigin: string;
  controlSecret: string;
  roomId: string;
  principalId: string;
};
type NamedEditWorkerRequest = WorkerAuthority & {
  operation: NamedEditOperation;
  body: Record<string, unknown>;
};
type RecentWorkerRequest = WorkerAuthority & {
  operation: 'recent';
  body: { version: 1 };
};
type RecentWorkerResult = { ok: true; title: string } | { ok: false; status: 403 | 503 };

const workerInvite = (value: unknown): value is WorkerNamedInvite =>
  isObject(value) &&
  hasKeys(value, ['inviteId', 'emailCiphertext', 'role', 'status', 'expiresAt']) &&
  typeof value.inviteId === 'string' &&
  NAMED_EDIT_INVITE_ID.test(value.inviteId) &&
  typeof value.emailCiphertext === 'string' &&
  /^email-v1\.[A-Za-z0-9_-]{39,1015}$/u.test(value.emailCiphertext) &&
  isNamedInviteRole(value.role) &&
  isNamedEditStatus(value.status) &&
  isIsoDate(value.expiresAt);

const interruptedBody = Symbol('interrupted named edit response body');

export async function readNamedEditJson(
  request: Request | Response,
  limit: number,
  signal?: AbortSignal,
): Promise<unknown> {
  if (signal?.aborted) return interruptedBody;
  const declared = request.headers.get('content-length');
  if (
    !request.body ||
    (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > limit))
  ) {
    return null;
  }
  const reader = request.body.getReader();
  const cancel = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let body = '';
  try {
    while (true) {
      const chunk = await reader.read().catch(() => null);
      if (!chunk || signal?.aborted) return interruptedBody;
      const { done, value } = chunk;
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        cancel();
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode()) as unknown;
  } catch {
    return null;
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

const parseResult = (
  data: unknown,
  status: number,
  request: NamedEditWorkerRequest,
): WorkerResult => {
  if (data === interruptedBody) return { ok: false, status: 503 };
  const invalidResponse = {
    ok: false,
    status: status === 200 && request.operation === 'session' ? 502 : 503,
  } as const;
  if (!isObject(data) || data.version !== 1) return invalidResponse;
  if (status !== 200 || data.ok !== true) {
    if (
      data.ok !== false ||
      !hasKeys(data, ['ok', 'version', 'error', 'retryable']) ||
      typeof data.retryable !== 'boolean'
    )
      return invalidResponse;
    if (
      request.operation === 'session' &&
      status === 503 &&
      data.error === 'named-edit-disabled' &&
      data.retryable === false
    ) {
      return { ok: false, status: 404 };
    }
    if (
      request.operation === 'session' &&
      data.retryable === false &&
      ((status === 400 && data.error === 'invalid-request') ||
        (status === 401 && data.error === 'unauthorized'))
    ) {
      return { ok: false, status: 502 };
    }
    if (status === 403 && data.error === 'forbidden') return { ok: false, status: 403 };
    if (status === 409 && data.error === 'conflict') return { ok: false, status: 409 };
    if (
      status === 400 &&
      data.error === 'invalid-request' &&
      request.operation === 'list' &&
      request.body.includeComment === true
    ) {
      return { ok: false, status: 400 };
    }
    if (status === 409 && data.error === 'comment-projection-unavailable') {
      return { ok: false, status: 409, commentError: data.error };
    }
    if (status === 503 && data.error === 'named-comment-disabled') {
      return { ok: false, status: 503, commentError: data.error };
    }
    if (
      status === 400 &&
      data.error === 'invalid-request' &&
      request.operation === 'issue' &&
      request.body.role === 'comment'
    ) {
      return { ok: false, status: 503, commentError: 'named-comment-disabled' };
    }
    if (status === 429 && data.error === 'rate-limited') return { ok: false, status: 429 };
    return invalidResponse;
  }
  const operation = request.operation;
  if (
    operation === 'session' &&
    hasKeys(data, ['ok', 'version', 'session']) &&
    isObject(data.session) &&
    hasKeys(data.session, namedEditGrantFields) &&
    validNamedEditGrant(data.session, request.roomId)
  ) {
    return {
      ok: true,
      kind: 'session',
      session: data.session,
    };
  }
  if (
    operation === 'list' &&
    hasKeys(data, ['ok', 'version', 'invites']) &&
    Array.isArray(data.invites) &&
    data.invites.length <= 500 &&
    data.invites.every(workerInvite) &&
    (request.body.includeComment === true || data.invites.every((invite) => invite.role === 'edit'))
  ) {
    return { ok: true, kind: 'list', invites: data.invites };
  }
  if (
    (operation === 'issue' || operation === 'revoke') &&
    hasKeys(data, ['ok', 'version', 'invite']) &&
    workerInvite(data.invite) &&
    request.body.inviteId === data.invite.inviteId &&
    data.invite.role === (request.body.role ?? 'edit') &&
    (operation !== 'revoke' || data.invite.status === 'revoked')
  ) {
    return { ok: true, kind: operation, invite: data.invite };
  }
  return invalidResponse;
};

function parseRecentResult(data: unknown, status: number): RecentWorkerResult {
  if (!isObject(data) || data.version !== 1) return { ok: false, status: 503 };
  if (
    status === 403 &&
    hasKeys(data, ['ok', 'version', 'error', 'retryable']) &&
    data.ok === false &&
    data.error === 'forbidden' &&
    data.retryable === false
  ) {
    return { ok: false, status: 403 };
  }
  if (
    status === 200 &&
    hasKeys(data, ['ok', 'version', 'title']) &&
    data.ok === true &&
    typeof data.title === 'string' &&
    data.title.trim() &&
    Buffer.byteLength(data.title, 'utf8') <= 4 * 1024
  ) {
    return { ok: true, title: data.title.trim() };
  }
  return { ok: false, status: 503 };
}

export async function callNamedEditWorker(
  request: NamedEditWorkerRequest,
  fetcher?: typeof fetch,
): Promise<WorkerResult>;
export async function callNamedEditWorker(
  request: RecentWorkerRequest,
  fetcher?: typeof fetch,
): Promise<RecentWorkerResult>;
export async function callNamedEditWorker(
  request: NamedEditWorkerRequest | RecentWorkerRequest,
  fetcher = fetch,
): Promise<WorkerResult | RecentWorkerResult> {
  const pathname = `/api/management/documents/${request.roomId}/named-edit/${request.operation}`;
  const body = canonicalize(request.body);
  const bodyHash = createHash('sha256').update(body).digest('base64url');
  const requestId = randomUUID();
  const expiry = String(Math.floor(Date.now() / 1000) + 55);
  const assertion = [
    'lash-worker-control:v2',
    'POST',
    pathname,
    bodyHash,
    requestId,
    request.principalId,
    expiry,
  ].join('\n');
  const signature = createHmac('sha256', request.controlSecret)
    .update(assertion)
    .digest('base64url');
  const signal = AbortSignal.timeout(8000);
  try {
    const response = await fetcher(request.workerOrigin + pathname, {
      method: 'POST',
      headers: {
        authorization: `Lash-Control v2:${signature}`,
        'content-type': 'application/json',
        'x-lash-control-body-sha256': bodyHash,
        'x-lash-control-expires-at': expiry,
        'x-lash-control-principal-id': request.principalId,
        'x-lash-control-request-id': requestId,
      },
      body,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal,
    });
    const recent = request.operation === 'recent';
    // JSON escaping can expand each byte of a 4 KiB title up to sixfold.
    const responseLimit = recent ? 25 * 1024 : 640 * 1024;
    const data =
      response.headers.get('content-type')?.split(';', 1)[0]?.trim() === 'application/json'
        ? await readNamedEditJson(response, responseLimit, recent ? signal : undefined)
        : null;
    return recent
      ? parseRecentResult(data, response.status)
      : parseResult(data, response.status, request);
  } catch {
    return { ok: false, status: 503 };
  }
}
