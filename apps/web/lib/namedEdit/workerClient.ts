import 'server-only';

import { canonicalize } from '@lash/types';
import { createHash, createHmac, randomUUID } from 'node:crypto';

import {
  NAMED_EDIT_INVITE_ID,
  hasKeys,
  isIsoDate,
  isNamedEditStatus,
  isObject,
  validNamedEditGrant,
  type NamedEditOperation,
  type NamedEditInvite,
  type NamedEditSession,
} from './contract';

type WorkerNamedInvite = Omit<NamedEditInvite, 'email'> & { emailCiphertext: string };

type WorkerResult =
  | { ok: true; kind: 'issue' | 'revoke'; invite: WorkerNamedInvite }
  | { ok: true; kind: 'list'; invites: WorkerNamedInvite[] }
  | { ok: true; kind: 'session'; session: Omit<NamedEditSession, 'socketUrl'> }
  | { ok: false; status: 400 | 403 | 404 | 409 | 429 | 502 | 503 };

type WorkerRequest = {
  workerOrigin: string;
  controlSecret: string;
  roomId: string;
  principalId: string;
  operation: NamedEditOperation;
  body: Record<string, unknown>;
};

const workerInvite = (value: unknown): value is WorkerNamedInvite =>
  isObject(value) &&
  hasKeys(value, ['inviteId', 'emailCiphertext', 'role', 'status', 'expiresAt']) &&
  typeof value.inviteId === 'string' &&
  NAMED_EDIT_INVITE_ID.test(value.inviteId) &&
  typeof value.emailCiphertext === 'string' &&
  /^email-v1\.[A-Za-z0-9_-]{39,1015}$/u.test(value.emailCiphertext) &&
  value.role === 'edit' &&
  isNamedEditStatus(value.status) &&
  isIsoDate(value.expiresAt);

const interruptedBody = Symbol('interrupted named edit response body');

export async function readNamedEditJson(
  request: Request | Response,
  limit: number,
): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (
    !request.body ||
    (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > limit))
  ) {
    return null;
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let body = '';
  try {
    while (true) {
      const chunk = await reader.read().catch(() => null);
      if (!chunk) return interruptedBody;
      const { done, value } = chunk;
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode()) as unknown;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

const parseResult = (data: unknown, status: number, request: WorkerRequest): WorkerResult => {
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
    if (status === 429 && data.error === 'rate-limited') return { ok: false, status: 429 };
    return invalidResponse;
  }
  const operation = request.operation;
  if (
    operation === 'session' &&
    hasKeys(data, ['ok', 'version', 'session']) &&
    isObject(data.session) &&
    hasKeys(data.session, [
      'roomId',
      'actorId',
      'source',
      'role',
      'protocolVersion',
      'capabilities',
      'socketProtocol',
      'ticketProtocol',
      'expiresAt',
    ]) &&
    validNamedEditGrant(data.session, request.roomId)
  ) {
    return {
      ok: true,
      kind: 'session',
      session: data.session as Omit<NamedEditSession, 'socketUrl'>,
    };
  }
  if (
    operation === 'list' &&
    hasKeys(data, ['ok', 'version', 'invites']) &&
    Array.isArray(data.invites) &&
    data.invites.length <= 500 &&
    data.invites.every(workerInvite)
  ) {
    return { ok: true, kind: 'list', invites: data.invites };
  }
  if (
    (operation === 'issue' || operation === 'revoke') &&
    hasKeys(data, ['ok', 'version', 'invite']) &&
    workerInvite(data.invite) &&
    request.body.inviteId === data.invite.inviteId &&
    (operation !== 'revoke' || data.invite.status === 'revoked')
  ) {
    return { ok: true, kind: operation, invite: data.invite };
  }
  return invalidResponse;
};

export async function callNamedEditWorker(
  request: WorkerRequest,
  fetcher = fetch,
): Promise<WorkerResult> {
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
      signal: AbortSignal.timeout(8000),
    });
    if (response.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/json') {
      return parseResult(null, response.status, request);
    }
    return parseResult(await readNamedEditJson(response, 640 * 1024), response.status, request);
  } catch {
    return { ok: false, status: 503 };
  }
}
