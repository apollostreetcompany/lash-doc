import type {
  DocumentClaimPromotionResultV2,
  OwnerSessionManagementResultV1,
  PublicCommentModerationResultV1,
  PublicControlSessionResultV1,
} from '@lash/types';

import {
  REALTIME_PROTOCOL_VERSION,
  createDefaultRealtimeGrant,
  createRealtimeGrantFromInviteToken,
  createRealtimeSessionToken,
  normalizeActorId,
  verifyRealtimeSessionToken,
  type RealtimeAccessFailure,
  type RealtimeSessionGrant,
} from './access';
import { LashDocumentClaim } from './claimCoordinator';
import { parsePublicAccessMode } from './documentAuthority';
import { parseDocumentClaimPromotionRequest } from './documentClaim';
import { verifyManagementAssertion, type ManagementAuthEnvironment } from './managementAuth';
import {
  NAMED_COMMENT_PROTOCOL_VERSION,
  NAMED_COMMENT_SOCKET_PROTOCOL,
  NAMED_EDIT_PROTOCOL_VERSION,
  NAMED_EDIT_REQUEST_LIMIT,
  NAMED_EDIT_SOCKET_PROTOCOL,
  isNamedEditActorId,
  isNamedEditOrigin,
  isNamedEditRoomId,
  namedCommentEnabled,
  namedEditEnabled,
  namedEditFailure,
  namedEditResponse,
  parseNamedCommentSocketProtocols,
  parseNamedEditCommand,
  parseNamedEditSocketProtocols,
} from './namedEdit';
import {
  OWNER_REALTIME_PROTOCOL_VERSION,
  OWNER_SOCKET_PROTOCOL,
  isCanonicalOwnerActorId,
  parseOwnerSessionManagementRequest,
  parseOwnerSocketProtocols,
} from './ownerSession';
import { readPromotionBody } from './promotion';
import {
  parsePublicCommentCreateRequest,
  parsePublicCommentListRequest,
  parsePublicCommentModerationRequest,
} from './publicComment';
import {
  verifyPublicCommentAssertion,
  type PublicCommentAuthEnvironment,
} from './publicCommentAuth';
import {
  verifyPublicControlAssertion,
  type PublicControlAuthEnvironment,
} from './publicControlAuth';
import {
  parsePublicPolicyReadRequest,
  parsePublicPolicyUpdateRequest,
  type PublicPolicyFailureV1,
  type PublicPolicyReadSuccessV1,
  type PublicPolicyUpdateSuccessV1,
} from './publicPolicy';
import {
  PUBLIC_REALTIME_PROTOCOL_VERSION,
  PUBLIC_SOCKET_PROTOCOL,
  parsePublicControlSessionRequest,
  parsePublicSocketProtocols,
} from './publicSession';
import { LashRealtimeRoom } from './room';
import {
  REALTIME_RUNTIME,
  isLocalRealtimeFallbackHost,
  namedSocketVersion,
  parseRealtimeRoute,
} from './routing';

export { LashDocumentClaim, LashRealtimeRoom };
export { REALTIME_RUNTIME, normalizeRoomName, parseRealtimeRoute } from './routing';
export {
  createDefaultRealtimeGrant,
  createRealtimeGrantFromInviteToken,
  realtimeCapabilitiesForScope,
  createRealtimeSessionToken,
  verifyRealtimeInviteToken,
  verifyRealtimeSessionToken,
} from './access';

const json = (body: unknown, init: ResponseInit = {}) =>
  Response.json(body, {
    ...init,
    headers: {
      'access-control-allow-headers': 'authorization, cache-control, content-type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
      ...init.headers,
    },
  });

const withCors = (response: Response) => {
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-headers', 'authorization, cache-control, content-type');
  headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  headers.set('access-control-allow-origin', '*');
  headers.set('cache-control', 'no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const managementJson = (body: unknown, init: ResponseInit = {}) =>
  Response.json(body, {
    ...init,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...init.headers,
    },
  });

const LOCAL_DEV_SESSION_SECRET = 'lash-local-realtime-development-secret';
const LOCAL_DEV_INVITE_SECRET = 'lash-local-invite-secret';
const MAX_SESSION_BODY_BYTES = 16_384;
const MAX_SESSION_ACTOR_LENGTH = 256;
const MAX_INVITE_TOKEN_LENGTH = 12_288;

type SessionRequestBody = {
  actorId: string;
  inviteToken: string | null;
};

type SessionBodyDecision =
  | { ok: true; body: SessionRequestBody }
  | { ok: false; status: 400 | 413 | 415 };

const sessionSecret = (env: Env & { LASH_REALTIME_SESSION_SECRET?: string }) => {
  const configured = env.LASH_REALTIME_SESSION_SECRET;
  return {
    secret: configured || LOCAL_DEV_SESSION_SECRET,
    usingLocalFallback: !configured,
  };
};

const inviteSecret = (
  env: Env & { LASH_REALTIME_INVITE_SECRET?: string; LASH_REALTIME_SESSION_SECRET?: string },
) => env.LASH_REALTIME_INVITE_SECRET || env.LASH_REALTIME_SESSION_SECRET || LOCAL_DEV_INVITE_SECRET;

const accessTokenFor = (request: Request, url: URL) => {
  const header = request.headers.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) {
    return header.slice('bearer '.length).trim();
  }
  return url.searchParams.get('accessToken');
};

const deny = (reason: RealtimeAccessFailure) =>
  json({ ok: false, error: 'forbidden', reason, retryable: false }, { status: 403 });

const rejectSession = (
  error: 'invalid-request' | 'method-not-allowed' | 'protocol-mismatch',
  status: 400 | 405 | 409 | 413 | 415,
) => json({ ok: false, error, retryable: false }, { status });

const inviteAuthorityUnavailable = () =>
  json(
    {
      ok: false,
      error: 'invite-authority-unavailable',
      retryable: false,
    },
    { status: 503 },
  );

const readSessionBody = async (request: Request): Promise<SessionBodyDecision> => {
  const contentEncoding = request.headers.get('content-encoding')?.trim().toLowerCase();
  if (contentEncoding && contentEncoding !== 'identity') {
    return { ok: false, status: 415 };
  }

  const [mediaType, ...parameters] = (request.headers.get('content-type') ?? '')
    .split(';')
    .map((part) => part.trim());
  if (
    mediaType.toLowerCase() !== 'application/json' ||
    parameters.some((parameter) => !/^charset\s*=\s*utf-8$/iu.test(parameter))
  ) {
    return { ok: false, status: 415 };
  }

  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      return { ok: false, status: 400 };
    }
    if (parsedLength > MAX_SESSION_BODY_BYTES) {
      return { ok: false, status: 413 };
    }
  }

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, status: 400 };
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > MAX_SESSION_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413 };
      }
      chunks.push(chunk.value);
    }
  } catch {
    return { ok: false, status: 400 };
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    return { ok: false, status: 400 };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, status: 400 };
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== 'actorId' || keys[1] !== 'inviteToken') {
    return { ok: false, status: 400 };
  }
  if (
    typeof record.actorId !== 'string' ||
    record.actorId.length > MAX_SESSION_ACTOR_LENGTH ||
    !/[a-z0-9]/iu.test(record.actorId)
  ) {
    return { ok: false, status: 400 };
  }
  if (
    record.inviteToken !== null &&
    (typeof record.inviteToken !== 'string' ||
      record.inviteToken.length === 0 ||
      record.inviteToken.length > MAX_INVITE_TOKEN_LENGTH)
  ) {
    return { ok: false, status: 400 };
  }

  return {
    ok: true,
    body: {
      actorId: normalizeActorId(record.actorId),
      inviteToken: record.inviteToken,
    },
  };
};

const roomRequest = (
  request: Request,
  roomId: string,
  path: string,
  grant: RealtimeSessionGrant,
) => {
  const url = new URL(request.url);
  url.pathname = path;
  url.search = new URLSearchParams({
    actorId: grant.actorId,
    roomId,
    capabilities: grant.capabilities.join(','),
    protocolVersion: String(grant.protocolVersion),
    ...(grant.scope ? { scope: grant.scope } : {}),
  }).toString();
  return new Request(url, request);
};

const ownerSocketRequest = (request: Request, roomId: string, actorId: string) => {
  const url = new URL(request.url);
  url.pathname = '/__lash-room/socket';
  url.search = new URLSearchParams([
    ['protocolVersion', String(OWNER_REALTIME_PROTOCOL_VERSION)],
    ['actorId', actorId],
    ['roomId', roomId],
  ]).toString();
  return new Request(url, request);
};

const publicSocketRequest = (request: Request, roomId: string, actorId: string) => {
  const url = new URL(request.url);
  url.pathname = '/__lash-room/socket';
  url.search = new URLSearchParams([
    ['protocolVersion', String(PUBLIC_REALTIME_PROTOCOL_VERSION)],
    ['actorId', actorId],
    ['roomId', roomId],
  ]).toString();
  return new Request(url, request);
};

const namedSocketRequest = (
  request: Request,
  roomId: string,
  actorId: string,
  protocolVersion: typeof NAMED_EDIT_PROTOCOL_VERSION | typeof NAMED_COMMENT_PROTOCOL_VERSION,
) => {
  const url = new URL(request.url);
  url.pathname = '/__lash-room/socket';
  url.search = new URLSearchParams([
    ['protocolVersion', String(protocolVersion)],
    ['actorId', actorId],
    ['roomId', roomId],
  ]).toString();
  return new Request(url, request);
};

const exactObjectKeys = (value: Record<string, unknown>, expected: string[]) => {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
};

const isBoundedOwnerTicketExpiry = (value: unknown) => {
  if (typeof value !== 'string') return false;
  const expiresAt = Date.parse(value);
  const now = Date.now();
  return (
    Number.isFinite(expiresAt) &&
    new Date(expiresAt).toISOString() === value &&
    expiresAt > now &&
    expiresAt <= now + 60_000
  );
};

const isCanonicalBrowserOrigin = (value: string | null) => {
  if (!value || value.includes(',')) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.origin === value &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === '' &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
};

const isClaimPromotionResult = (value: unknown): value is DocumentClaimPromotionResultV2 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (result.version !== 2 || typeof result.ok !== 'boolean') return false;
  if (result.ok) {
    return (
      exactObjectKeys(result, [
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
      ]) &&
      /^claim-v1-[0-9a-f]{64}$/u.test(String(result.claimId)) &&
      typeof result.roomId === 'string' &&
      /^account:v1:[A-Za-z0-9_-]{43}$/u.test(String(result.ownerPrincipalId)) &&
      result.aclVersion === 1 &&
      result.publicPolicy === 'restricted' &&
      result.publicPolicyVersion === 1 &&
      /^[A-Za-z0-9_-]{43}$/u.test(String(result.snapshotSha256)) &&
      typeof result.created === 'boolean'
    );
  }
  if (
    !exactObjectKeys(result, ['ok', 'version', 'error', 'retryable']) ||
    typeof result.error !== 'string' ||
    typeof result.retryable !== 'boolean'
  ) {
    return false;
  }
  return result.retryable
    ? result.error === 'readback-failed' || result.error === 'internal-error'
    : [
        'promotion-disabled',
        'invalid-request',
        'unauthorized',
        'upgrade-required',
        'replay-detected',
        'promotion-not-found',
        'owner-mismatch',
        'promotion-conflict',
        'claim-conflict',
      ].includes(result.error);
};

const claimPromotionStatus = (result: DocumentClaimPromotionResultV2) => {
  if (result.ok) return 200;
  if (result.error === 'promotion-disabled') return 503;
  if (result.error === 'unauthorized') return 401;
  if (result.error === 'promotion-not-found') return 404;
  if (
    result.error === 'claim-conflict' ||
    result.error === 'promotion-conflict' ||
    result.error === 'owner-mismatch' ||
    result.error === 'replay-detected'
  ) {
    return 409;
  }
  return result.retryable ? 500 : 400;
};

const isOwnerSessionResult = (value: unknown): value is OwnerSessionManagementResultV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (result.version !== 1 || typeof result.ok !== 'boolean') return false;
  if (!result.ok) {
    return (
      exactObjectKeys(result, ['ok', 'version', 'error', 'retryable']) &&
      typeof result.error === 'string' &&
      typeof result.retryable === 'boolean' &&
      (result.retryable
        ? result.error === 'readback-failed' || result.error === 'internal-error'
        : ['claim-not-found', 'claim-conflict', 'owner-mismatch', 'not-shareable'].includes(
            result.error,
          ))
    );
  }
  if (
    !exactObjectKeys(result, [
      'ok',
      'version',
      'claimId',
      'roomId',
      'ownerPrincipalId',
      'promotionSnapshotSha256',
      'grant',
      'socket',
    ]) ||
    !/^claim-v1-[0-9a-f]{64}$/u.test(String(result.claimId)) ||
    !/^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u.test(String(result.roomId)) ||
    !/^account:v1:[A-Za-z0-9_-]{43}$/u.test(String(result.ownerPrincipalId)) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(String(result.promotionSnapshotSha256)) ||
    !result.grant ||
    typeof result.grant !== 'object' ||
    Array.isArray(result.grant) ||
    !result.socket ||
    typeof result.socket !== 'object' ||
    Array.isArray(result.socket)
  ) {
    return false;
  }
  const grant = result.grant as Record<string, unknown>;
  const socket = result.socket as Record<string, unknown>;
  return (
    exactObjectKeys(grant, ['source', 'capabilities', 'aclVersion', 'protocolVersion']) &&
    grant.source === 'owner' &&
    Array.isArray(grant.capabilities) &&
    grant.capabilities.length === 2 &&
    grant.capabilities[0] === 'doc.read' &&
    grant.capabilities[1] === 'doc.edit' &&
    Number.isSafeInteger(grant.aclVersion) &&
    Number(grant.aclVersion) > 0 &&
    grant.protocolVersion === OWNER_REALTIME_PROTOCOL_VERSION &&
    exactObjectKeys(socket, ['path', 'ticket', 'expiresAt']) &&
    typeof socket.path === 'string' &&
    typeof socket.ticket === 'string' &&
    /^lash-ticket\.[A-Za-z0-9_-]{43}$/u.test(socket.ticket) &&
    isBoundedOwnerTicketExpiry(socket.expiresAt)
  );
};

const ownerSessionStatus = (result: OwnerSessionManagementResultV1) => {
  if (result.ok) return 200;
  if (result.error === 'claim-not-found') return 404;
  if (
    result.error === 'claim-conflict' ||
    result.error === 'owner-mismatch' ||
    result.error === 'not-shareable'
  ) {
    return 409;
  }
  return 500;
};

type ClaimPublicPolicyReadSuccessV1 = PublicPolicyReadSuccessV1 & { claimId: string };
type ClaimPublicPolicyUpdateSuccessV1 = PublicPolicyUpdateSuccessV1 & { claimId: string };
type PublicPolicyManagementFailureV1 =
  | PublicPolicyFailureV1
  | {
      ok: false;
      version: 1;
      error: 'invalid-request' | 'unauthorized' | 'promotion-disabled';
      retryable: false;
    };
type ClaimPublicPolicyResultV1 =
  | ClaimPublicPolicyReadSuccessV1
  | ClaimPublicPolicyUpdateSuccessV1
  | PublicPolicyManagementFailureV1;

const isPublicPolicyConflictState = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  const mode = parsePublicAccessMode(state.mode);
  const blocked = state.publicProjectionBlocked === true;
  return (
    exactObjectKeys(state, [
      'mode',
      'policyVersion',
      'cutoffGeneration',
      'publicPath',
      ...(blocked ? ['publicProjectionBlocked'] : []),
    ]) &&
    mode !== null &&
    Number.isSafeInteger(state.policyVersion) &&
    Number(state.policyVersion) >= 1 &&
    Number.isSafeInteger(state.cutoffGeneration) &&
    Number(state.cutoffGeneration) >= 0 &&
    state.publicPath ===
      (mode === 'restricted' || blocked
        ? null
        : typeof state.publicPath === 'string' &&
            /^\/public\/doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u.test(state.publicPath)
          ? state.publicPath
          : undefined)
  );
};

const isClaimPublicPolicyResult = (
  value: unknown,
  action: 'read' | 'update',
): value is ClaimPublicPolicyResultV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (result.version !== 1 || typeof result.ok !== 'boolean') return false;
  if (!result.ok) {
    if (result.error === 'policy-conflict') {
      return (
        exactObjectKeys(result, ['ok', 'version', 'error', 'retryable', 'state']) &&
        result.retryable === false &&
        isPublicPolicyConflictState(result.state)
      );
    }
    return (
      exactObjectKeys(result, ['ok', 'version', 'error', 'retryable']) &&
      typeof result.error === 'string' &&
      typeof result.retryable === 'boolean' &&
      (result.retryable
        ? result.error === 'readback-failed' || result.error === 'internal-error'
        : [
            'invalid-request',
            'unauthorized',
            'promotion-disabled',
            'claim-not-found',
            'claim-conflict',
            'owner-mismatch',
            'not-shareable',
            'replay-detected',
          ].includes(result.error))
    );
  }
  const expectedKeys = [
    'ok',
    'version',
    'claimId',
    'roomId',
    'ownerPrincipalId',
    'mode',
    'policyVersion',
    'cutoffGeneration',
    'publicPath',
    ...(result.publicProjectionBlocked === true ? ['publicProjectionBlocked'] : []),
    ...(action === 'update' ? ['changed'] : []),
  ];
  const mode = parsePublicAccessMode(result.mode);
  return (
    exactObjectKeys(result, expectedKeys) &&
    typeof result.claimId === 'string' &&
    /^claim-v1-[0-9a-f]{64}$/u.test(result.claimId) &&
    typeof result.roomId === 'string' &&
    /^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u.test(result.roomId) &&
    typeof result.ownerPrincipalId === 'string' &&
    /^account:v1:[A-Za-z0-9_-]{43}$/u.test(result.ownerPrincipalId) &&
    mode !== null &&
    Number.isSafeInteger(result.policyVersion) &&
    Number(result.policyVersion) >= 1 &&
    Number.isSafeInteger(result.cutoffGeneration) &&
    Number(result.cutoffGeneration) >= 0 &&
    result.publicPath ===
      (mode === 'restricted' || result.publicProjectionBlocked === true
        ? null
        : `/public/${String(result.roomId)}`) &&
    (action === 'read' || typeof result.changed === 'boolean')
  );
};

const publicPolicyStatus = (result: ClaimPublicPolicyResultV1) => {
  if (result.ok) return 200;
  if (result.error === 'promotion-disabled') return 503;
  if (result.error === 'unauthorized') return 401;
  if (result.error === 'claim-not-found') return 404;
  if (
    result.error === 'claim-conflict' ||
    result.error === 'owner-mismatch' ||
    result.error === 'not-shareable' ||
    result.error === 'policy-conflict' ||
    result.error === 'replay-detected'
  ) {
    return 409;
  }
  return result.retryable ? 500 : 400;
};

const isPublicControlSessionResult = (
  value: unknown,
  expected: { roomId: string; actorId: string },
): value is PublicControlSessionResultV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (result.version !== 1 || typeof result.ok !== 'boolean') return false;
  if (!result.ok) {
    return (
      exactObjectKeys(result, ['ok', 'version', 'error', 'retryable']) &&
      typeof result.error === 'string' &&
      typeof result.retryable === 'boolean' &&
      (result.retryable
        ? ['rate-limited', 'readback-failed', 'internal-error'].includes(result.error)
        : [
            'invalid-request',
            'unauthorized',
            'document-unavailable',
            'replay-detected',
            'protocol-mismatch',
          ].includes(result.error))
    );
  }
  if (
    !exactObjectKeys(result, ['ok', 'version', 'authorization', 'grant', 'socket']) ||
    !result.authorization ||
    typeof result.authorization !== 'object' ||
    Array.isArray(result.authorization) ||
    !result.grant ||
    typeof result.grant !== 'object' ||
    Array.isArray(result.grant) ||
    !result.socket ||
    typeof result.socket !== 'object' ||
    Array.isArray(result.socket)
  ) {
    return false;
  }
  const authorization = result.authorization as Record<string, unknown>;
  const grant = result.grant as Record<string, unknown>;
  const socket = result.socket as Record<string, unknown>;
  return (
    exactObjectKeys(authorization, ['roomId', 'mode', 'policyVersion', 'cutoffGeneration']) &&
    authorization.roomId === expected.roomId &&
    (authorization.mode === 'read' || authorization.mode === 'comment') &&
    Number.isSafeInteger(authorization.policyVersion) &&
    Number(authorization.policyVersion) >= 1 &&
    Number.isSafeInteger(authorization.cutoffGeneration) &&
    Number(authorization.cutoffGeneration) >= 0 &&
    exactObjectKeys(grant, ['source', 'capabilities', 'protocolVersion']) &&
    grant.source === 'public' &&
    Array.isArray(grant.capabilities) &&
    grant.capabilities.length === 1 &&
    grant.capabilities[0] === 'doc.read' &&
    grant.protocolVersion === PUBLIC_REALTIME_PROTOCOL_VERSION &&
    exactObjectKeys(socket, ['path', 'protocol', 'ticketProtocol', 'expiresAt']) &&
    socket.path ===
      `/api/realtime/rooms/${expected.roomId}/socket?protocolVersion=4&actorId=${encodeURIComponent(expected.actorId)}` &&
    socket.protocol === PUBLIC_SOCKET_PROTOCOL &&
    typeof socket.ticketProtocol === 'string' &&
    /^lash-public-ticket\.[A-Za-z0-9_-]{43}$/u.test(socket.ticketProtocol) &&
    typeof socket.expiresAt === 'string' &&
    Number.isFinite(Date.parse(socket.expiresAt)) &&
    new Date(socket.expiresAt).toISOString() === socket.expiresAt
  );
};

const publicControlSessionStatus = (result: PublicControlSessionResultV1) => {
  if (result.ok) return 200;
  if (result.error === 'invalid-request') return 400;
  if (result.error === 'unauthorized') return 401;
  if (result.error === 'document-unavailable') return 404;
  if (result.error === 'replay-detected' || result.error === 'protocol-mismatch') return 409;
  if (result.error === 'rate-limited') return 429;
  return 500;
};

const publicCommentStatus = (result: Record<string, unknown>, action: 'list' | 'create') => {
  if (result.ok === true) return action === 'create' && result.created === true ? 201 : 200;
  if (result.error === 'invalid-request') return 400;
  if (result.error === 'unauthorized') return 401;
  if (result.error === 'public-comment-disabled') return 503;
  if (
    result.error === 'replay-detected' ||
    result.error === 'public-access-changed' ||
    result.error === 'idempotency-conflict'
  ) {
    return 409;
  }
  if (result.error === 'rate-limited') return 429;
  return 500;
};

const isPublicCommentDto = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const comment = value as Record<string, unknown>;
  if (
    !exactObjectKeys(comment, ['id', 'sequence', 'anchor', 'body', 'author', 'createdAt']) ||
    typeof comment.id !== 'string' ||
    !/^pc-v1-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      comment.id,
    ) ||
    !Number.isSafeInteger(comment.sequence) ||
    Number(comment.sequence) < 1 ||
    typeof comment.body !== 'string' ||
    typeof comment.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(comment.createdAt)) ||
    new Date(comment.createdAt).toISOString() !== comment.createdAt ||
    !comment.anchor ||
    typeof comment.anchor !== 'object' ||
    Array.isArray(comment.anchor) ||
    !exactObjectKeys(comment.anchor as Record<string, unknown>, ['kind']) ||
    (comment.anchor as Record<string, unknown>).kind !== 'document' ||
    !comment.author ||
    typeof comment.author !== 'object' ||
    Array.isArray(comment.author) ||
    !exactObjectKeys(comment.author as Record<string, unknown>, ['label']) ||
    typeof (comment.author as Record<string, unknown>).label !== 'string' ||
    !/^Commenter [A-Za-z0-9_-]{6}$/u.test(String((comment.author as Record<string, unknown>).label))
  ) {
    return false;
  }
  return true;
};

const isPublicCommentResult = (value: unknown, action: 'list' | 'create', roomId: string) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (result.version !== 1 || typeof result.ok !== 'boolean') return false;
  if (!result.ok) {
    return (
      exactObjectKeys(result, ['ok', 'version', 'error', 'retryable']) &&
      typeof result.error === 'string' &&
      typeof result.retryable === 'boolean' &&
      (result.retryable
        ? ['rate-limited', 'readback-failed', 'internal-error'].includes(result.error)
        : [
            'invalid-request',
            'unauthorized',
            'public-comment-disabled',
            'replay-detected',
            'public-access-changed',
            'idempotency-conflict',
          ].includes(result.error))
    );
  }
  const expected =
    action === 'list'
      ? ['ok', 'version', 'authorization', 'comments', 'nextBeforeSequence']
      : ['ok', 'version', 'created', 'authorization', 'comment'];
  if (
    !exactObjectKeys(result, expected) ||
    !result.authorization ||
    typeof result.authorization !== 'object' ||
    Array.isArray(result.authorization)
  ) {
    return false;
  }
  const authorization = result.authorization as Record<string, unknown>;
  if (
    !exactObjectKeys(authorization, ['roomId', 'mode', 'policyVersion', 'cutoffGeneration']) ||
    authorization.roomId !== roomId ||
    authorization.mode !== 'comment' ||
    !Number.isSafeInteger(authorization.policyVersion) ||
    Number(authorization.policyVersion) < 1 ||
    !Number.isSafeInteger(authorization.cutoffGeneration) ||
    Number(authorization.cutoffGeneration) < 0
  ) {
    return false;
  }
  return action === 'list'
    ? Array.isArray(result.comments) &&
        result.comments.length <= 50 &&
        result.comments.every(isPublicCommentDto) &&
        result.comments.every(
          (comment, index, comments) =>
            index === 0 ||
            Number((comments[index - 1] as Record<string, unknown>).sequence) <
              Number((comment as Record<string, unknown>).sequence),
        ) &&
        (result.nextBeforeSequence === null ||
          (Number.isSafeInteger(result.nextBeforeSequence) &&
            Number(result.nextBeforeSequence) >= 1))
    : typeof result.created === 'boolean' && isPublicCommentDto(result.comment);
};

const publicCommentModerationStatus = (result: PublicCommentModerationResultV1) => {
  if (result.ok) return 200;
  if (result.error === 'invalid-request') return 400;
  if (result.error === 'unauthorized') return 401;
  if (result.error === 'promotion-disabled') return 503;
  if (result.error === 'claim-not-found' || result.error === 'comment-not-found') return 404;
  if (
    result.error === 'claim-conflict' ||
    result.error === 'owner-mismatch' ||
    result.error === 'not-shareable' ||
    result.error === 'policy-conflict' ||
    result.error === 'replay-detected'
  ) {
    return 409;
  }
  return 500;
};

const isPublicCommentModerationResult = (
  value: unknown,
): value is PublicCommentModerationResultV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (result.version !== 1 || typeof result.ok !== 'boolean') return false;
  if (!result.ok) {
    if (result.error === 'policy-conflict') {
      if (
        !exactObjectKeys(result, ['ok', 'version', 'error', 'retryable', 'state']) ||
        result.retryable !== false ||
        !result.state ||
        typeof result.state !== 'object' ||
        Array.isArray(result.state)
      ) {
        return false;
      }
      const state = result.state as Record<string, unknown>;
      return (
        exactObjectKeys(state, ['mode', 'policyVersion', 'cutoffGeneration', 'publicPath']) &&
        (state.mode === 'restricted' || state.mode === 'read' || state.mode === 'comment') &&
        Number.isSafeInteger(state.policyVersion) &&
        Number(state.policyVersion) >= 1 &&
        Number.isSafeInteger(state.cutoffGeneration) &&
        Number(state.cutoffGeneration) >= 0 &&
        state.publicPath ===
          (state.mode === 'restricted'
            ? null
            : typeof state.publicPath === 'string' &&
                /^\/public\/doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u.test(state.publicPath)
              ? state.publicPath
              : undefined)
      );
    }
    return (
      exactObjectKeys(result, ['ok', 'version', 'error', 'retryable']) &&
      typeof result.error === 'string' &&
      typeof result.retryable === 'boolean' &&
      (result.retryable
        ? result.error === 'readback-failed' || result.error === 'internal-error'
        : [
            'invalid-request',
            'unauthorized',
            'promotion-disabled',
            'claim-not-found',
            'comment-not-found',
            'claim-conflict',
            'owner-mismatch',
            'not-shareable',
            'replay-detected',
          ].includes(result.error))
    );
  }
  return (
    exactObjectKeys(result, [
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
    ]) &&
    typeof result.claimId === 'string' &&
    /^claim-v1-[0-9a-f]{64}$/u.test(result.claimId) &&
    typeof result.roomId === 'string' &&
    /^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u.test(result.roomId) &&
    typeof result.commentId === 'string' &&
    /^pc-v1-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      result.commentId,
    ) &&
    result.state === 'hidden' &&
    typeof result.changed === 'boolean' &&
    Number.isSafeInteger(result.policyVersion) &&
    Number(result.policyVersion) >= 1 &&
    Number.isSafeInteger(result.cutoffGeneration) &&
    Number(result.cutoffGeneration) >= 0 &&
    typeof result.moderatedAt === 'string' &&
    Number.isFinite(Date.parse(result.moderatedAt)) &&
    new Date(result.moderatedAt).toISOString() === result.moderatedAt
  );
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const route = parseRealtimeRoute(url);
    const { secret, usingLocalFallback } = sessionSecret(env);
    const namedEditEnv = env as Env & Parameters<typeof namedEditEnabled>[0];

    if (route.kind === 'management-named-edit') {
      if (!namedEditEnabled(namedEditEnv)) {
        return namedEditResponse(namedEditFailure('named-edit-disabled'));
      }
      if (request.method !== 'POST' || request.headers.has('origin')) {
        return namedEditResponse(namedEditFailure('unauthorized'));
      }
      if (request.headers.has('content-encoding')) {
        return namedEditResponse(namedEditFailure('invalid-request'));
      }
      const body = await readPromotionBody(request, NAMED_EDIT_REQUEST_LIMIT);
      if (!body.ok) return namedEditResponse(namedEditFailure('invalid-request'));
      const auth = await verifyManagementAssertion({
        request,
        body: body.body,
        environment: env as Env & ManagementAuthEnvironment,
      });
      if (!auth.ok) return namedEditResponse(namedEditFailure('unauthorized'));
      if (!parseNamedEditCommand(route.action, body.value)) {
        return namedEditResponse(namedEditFailure('invalid-request'));
      }

      const internalUrl = new URL(request.url);
      internalUrl.pathname = `/__lash-room/named-edit/${route.roomId}/${route.action}`;
      try {
        return await env.LASH_REALTIME_ROOM.getByName(route.roomId).fetch(
          new Request(internalUrl, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-lash-internal-management': 'named-edit-v1',
              'x-lash-control-principal-id': auth.principalId,
              'x-lash-control-request-id': auth.requestId,
            },
            body: body.body as BodyInit,
          }),
        );
      } catch {
        return namedEditResponse(namedEditFailure('internal-error'));
      }
    }

    if (route.kind === 'public-comment-control') {
      const maxBytes = route.action === 'list' ? 1_024 : 8_192;
      if (request.method !== 'POST') {
        return managementJson(
          { ok: false, version: 1, error: 'unauthorized', retryable: false },
          { status: 401 },
        );
      }
      if (
        request.headers.get('content-type') !== 'application/json' ||
        request.headers.has('content-encoding')
      ) {
        return managementJson(
          { ok: false, version: 1, error: 'invalid-request', retryable: false },
          { status: 400 },
        );
      }
      const declaredLength = request.headers.get('content-length');
      if (
        declaredLength !== null &&
        (/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) ? Number(declaredLength) > maxBytes : true)
      ) {
        return managementJson(
          { ok: false, version: 1, error: 'invalid-request', retryable: false },
          { status: 413 },
        );
      }
      const body = await readPromotionBody(request);
      if (!body.ok || body.body.byteLength > maxBytes) {
        return managementJson(
          { ok: false, version: 1, error: 'invalid-request', retryable: false },
          { status: body.ok && body.body.byteLength > maxBytes ? 413 : 400 },
        );
      }
      const auth = await verifyPublicCommentAssertion({
        request,
        body: body.body,
        environment: env as Env & PublicCommentAuthEnvironment,
        expectedAction: route.action,
      });
      if (!auth.ok) {
        return managementJson(
          { ok: false, version: 1, error: auth.error, retryable: false },
          { status: auth.error === 'public-comment-disabled' ? 503 : 401 },
        );
      }
      const parsed =
        route.action === 'list'
          ? parsePublicCommentListRequest(body.value, route.roomId)
          : parsePublicCommentCreateRequest(body.value, route.roomId, auth.principalId ?? '');
      if (!parsed.ok) {
        return managementJson(
          { ok: false, version: 1, error: 'invalid-request', retryable: false },
          { status: 400 },
        );
      }
      if (!env.LASH_REALTIME_ROOM) {
        return managementJson(
          { ok: false, version: 1, error: 'internal-error', retryable: true },
          { status: 500 },
        );
      }
      const internalUrl = new URL(request.url);
      internalUrl.pathname = `/__lash-room/public-comments/${route.action}`;
      internalUrl.search = '';
      let response: Response;
      try {
        response = await env.LASH_REALTIME_ROOM.getByName(route.roomId).fetch(
          new Request(internalUrl, {
            method: 'POST',
            headers: {
              'content-type': 'application/json; charset=utf-8',
              'content-encoding': 'identity',
              'x-lash-internal-management': 'public-comment-v1',
            },
            body: JSON.stringify({
              version: 1,
              requestId: auth.requestId,
              bodySha256: auth.bodySha256,
              publicComment: parsed.request,
            }),
          }),
        );
      } catch {
        return managementJson(
          { ok: false, version: 1, error: 'internal-error', retryable: true },
          { status: 500 },
        );
      }
      const resultValue = await response.json().catch(() => null);
      if (
        !isPublicCommentResult(resultValue, route.action, route.roomId) ||
        response.status !==
          publicCommentStatus(resultValue as Record<string, unknown>, route.action)
      ) {
        return managementJson(
          { ok: false, version: 1, error: 'internal-error', retryable: true },
          { status: 500 },
        );
      }
      const headers = new Headers();
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        if (!retryAfter || !/^(?:[1-9][0-9]{0,4})$/u.test(retryAfter)) {
          return managementJson(
            { ok: false, version: 1, error: 'internal-error', retryable: true },
            { status: 500 },
          );
        }
        headers.set('retry-after', retryAfter);
      }
      return managementJson(resultValue, { status: response.status, headers });
    }

    if (route.kind === 'management-document-claim-public-comment-moderate') {
      if (request.method !== 'POST') {
        return managementJson(
          { ok: false, version: 1, error: 'unauthorized', retryable: false },
          { status: 401 },
        );
      }
      if (
        request.headers.get('content-type') !== 'application/json' ||
        request.headers.has('content-encoding')
      ) {
        return managementJson(
          { ok: false, version: 1, error: 'invalid-request', retryable: false },
          { status: 400 },
        );
      }
      if (
        request.headers.has('x-lash-control-audience') ||
        request.headers.has('x-lash-control-service-id')
      ) {
        return managementJson(
          { ok: false, version: 1, error: 'unauthorized', retryable: false },
          { status: 401 },
        );
      }
      const body = await readPromotionBody(request);
      if (!body.ok || body.body.byteLength > 4_096) {
        return managementJson(
          { ok: false, version: 1, error: 'invalid-request', retryable: false },
          { status: body.ok && body.body.byteLength > 4_096 ? 413 : 400 },
        );
      }
      const auth = await verifyManagementAssertion({
        request,
        body: body.body,
        environment: env as Env & ManagementAuthEnvironment,
      });
      if (!auth.ok) {
        return managementJson(
          { ok: false, version: 1, error: auth.error, retryable: false },
          { status: auth.error === 'promotion-disabled' ? 503 : 401 },
        );
      }
      const parsed = await parsePublicCommentModerationRequest(
        body.value,
        route.claimId,
        auth.principalId,
      );
      if (!parsed.ok) {
        return managementJson(
          { ok: false, version: 1, error: 'invalid-request', retryable: false },
          { status: 400 },
        );
      }
      if (!env.LASH_DOCUMENT_CLAIM) {
        return managementJson(
          { ok: false, version: 1, error: 'internal-error', retryable: true },
          { status: 500 },
        );
      }
      const internalUrl = new URL(request.url);
      internalUrl.pathname = '/__lash-document-claim/public-comments/moderate';
      internalUrl.search = '';
      let response: Response;
      try {
        response = await env.LASH_DOCUMENT_CLAIM.getByName(route.claimId).fetch(
          new Request(internalUrl, {
            method: 'POST',
            headers: {
              'content-type': 'application/json; charset=utf-8',
              'content-encoding': 'identity',
              'x-lash-internal-management': 'public-comment-moderation-v1',
            },
            body: JSON.stringify({
              version: 1,
              requestId: auth.requestId,
              bodySha256: auth.bodySha256,
              publicComment: parsed.request,
            }),
          }),
        );
      } catch {
        return managementJson(
          { ok: false, version: 1, error: 'internal-error', retryable: true },
          { status: 500 },
        );
      }
      const value = await response.json().catch(() => null);
      if (
        !isPublicCommentModerationResult(value) ||
        response.status !== publicCommentModerationStatus(value)
      ) {
        return managementJson(
          { ok: false, version: 1, error: 'internal-error', retryable: true },
          { status: 500 },
        );
      }
      if (
        value.ok &&
        (value.claimId !== route.claimId || value.commentId !== parsed.request.commentId)
      ) {
        return managementJson(
          { ok: false, version: 1, error: 'internal-error', retryable: true },
          { status: 500 },
        );
      }
      return managementJson(value, {
        status: publicCommentModerationStatus(value),
      });
    }

    if (route.kind === 'public-control-document-session') {
      if (request.method !== 'POST') {
        return managementJson(
          { ok: false, version: 1, error: 'unauthorized', retryable: false },
          { status: 401 },
        );
      }
      const declaredLength = request.headers.get('content-length');
      if (
        declaredLength !== null &&
        (/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) ? Number(declaredLength) > 2048 : true)
      ) {
        return managementJson(
          { ok: false, version: 1, error: 'invalid-request', retryable: false },
          { status: 400 },
        );
      }
      const body = await readPromotionBody(request);
      if (!body.ok || body.body.byteLength > 2048) {
        return managementJson(
          { ok: false, version: 1, error: 'invalid-request', retryable: false },
          { status: 400 },
        );
      }
      const auth = await verifyPublicControlAssertion({
        request,
        body: body.body,
        environment: env as Env & PublicControlAuthEnvironment,
      });
      if (!auth.ok) {
        return managementJson(
          { ok: false, version: 1, error: 'unauthorized', retryable: false },
          { status: 401 },
        );
      }
      const parsed = parsePublicControlSessionRequest(body.value, route.roomId);
      if (!parsed.ok) {
        return managementJson(
          { ok: false, version: 1, error: 'invalid-request', retryable: false },
          { status: 400 },
        );
      }
      if (!env.LASH_REALTIME_ROOM) {
        return managementJson(
          { ok: false, version: 1, error: 'internal-error', retryable: true },
          { status: 500 },
        );
      }
      const internalUrl = new URL(request.url);
      internalUrl.pathname = '/__lash-room/public-session';
      internalUrl.search = '';
      let internalResponse: Response;
      try {
        internalResponse = await env.LASH_REALTIME_ROOM.getByName(route.roomId).fetch(
          new Request(internalUrl, {
            method: 'POST',
            headers: {
              'content-type': 'application/json; charset=utf-8',
              'content-encoding': 'identity',
              'x-lash-internal-management': 'public-session-v1',
            },
            body: JSON.stringify({
              version: 1,
              requestId: auth.requestId,
              bodySha256: auth.bodySha256,
              publicSession: parsed.request,
            }),
          }),
        );
      } catch {
        return managementJson(
          { ok: false, version: 1, error: 'internal-error', retryable: true },
          { status: 500 },
        );
      }
      const result = await internalResponse.json().catch(() => null);
      if (
        !isPublicControlSessionResult(result, {
          roomId: route.roomId,
          actorId: parsed.request.actorId,
        }) ||
        internalResponse.status !== publicControlSessionStatus(result)
      ) {
        return managementJson(
          { ok: false, version: 1, error: 'internal-error', retryable: true },
          { status: 500 },
        );
      }
      return managementJson(result, { status: publicControlSessionStatus(result) });
    }

    if (route.kind === 'management-document-claim-public-policy') {
      if (request.method !== 'POST') {
        return managementJson(
          { ok: false, version: 1, error: 'unauthorized', retryable: false },
          { status: 401 },
        );
      }
      const declaredLength = request.headers.get('content-length');
      if (
        declaredLength !== null &&
        (/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) ? Number(declaredLength) > 4096 : true)
      ) {
        return managementJson(
          { ok: false, version: 1, error: 'invalid-request', retryable: false },
          { status: 413 },
        );
      }
      const bodyDecision = await readPromotionBody(request);
      if (!bodyDecision.ok || bodyDecision.body.byteLength > 4096) {
        return managementJson(
          { ok: false, version: 1, error: 'invalid-request', retryable: false },
          { status: bodyDecision.ok ? 413 : bodyDecision.status },
        );
      }
      const auth = await verifyManagementAssertion({
        request,
        body: bodyDecision.body,
        environment: env as Env & ManagementAuthEnvironment,
      });
      if (!auth.ok) {
        return managementJson(
          { ok: false, version: 1, error: auth.error, retryable: false },
          { status: auth.error === 'promotion-disabled' ? 503 : 401 },
        );
      }
      const parsed =
        route.action === 'read'
          ? await parsePublicPolicyReadRequest(bodyDecision.value, route.claimId)
          : await parsePublicPolicyUpdateRequest(bodyDecision.value, route.claimId);
      if (!parsed.ok) {
        return managementJson(
          { ok: false, version: 1, error: 'invalid-request', retryable: false },
          { status: 400 },
        );
      }
      if (parsed.request.ownerPrincipalId !== auth.principalId) {
        return managementJson(
          { ok: false, version: 1, error: 'unauthorized', retryable: false },
          { status: 401 },
        );
      }
      const claimNamespace = (
        env as Env & { LASH_DOCUMENT_CLAIM: DurableObjectNamespace<LashDocumentClaim> }
      ).LASH_DOCUMENT_CLAIM;
      if (!claimNamespace) {
        return managementJson(
          { ok: false, version: 1, error: 'internal-error', retryable: true },
          { status: 500 },
        );
      }
      const internalUrl = new URL(request.url);
      internalUrl.pathname = `/__lash-document-claim/public-policy/${route.action}`;
      internalUrl.search = '';
      let internalResponse: Response;
      try {
        internalResponse = await claimNamespace.getByName(route.claimId).fetch(
          new Request(internalUrl, {
            method: 'POST',
            headers: {
              'content-type': 'application/json; charset=utf-8',
              'content-encoding': 'identity',
              'x-lash-internal-management': 'public-policy-v1',
            },
            body: JSON.stringify({
              version: 1,
              requestId: auth.requestId,
              bodySha256: auth.bodySha256,
              publicPolicy: parsed.request,
            }),
          }),
        );
      } catch {
        return managementJson(
          { ok: false, version: 1, error: 'internal-error', retryable: true },
          { status: 500 },
        );
      }
      const result = await internalResponse.json().catch(() => null);
      if (
        !isClaimPublicPolicyResult(result, route.action) ||
        internalResponse.status !== publicPolicyStatus(result)
      ) {
        return managementJson(
          { ok: false, version: 1, error: 'internal-error', retryable: true },
          { status: 500 },
        );
      }
      if (
        result.ok &&
        (result.claimId !== route.claimId ||
          result.ownerPrincipalId !== auth.principalId ||
          result.publicPath !==
            (result.mode === 'restricted' || result.publicProjectionBlocked
              ? null
              : `/public/${result.roomId}`))
      ) {
        return managementJson(
          { ok: false, version: 1, error: 'internal-error', retryable: true },
          { status: 500 },
        );
      }
      return managementJson(result, { status: publicPolicyStatus(result) });
    }

    if (route.kind === 'management-document-claim-owner-session') {
      if (request.method !== 'POST') {
        return managementJson(
          { ok: false, version: 1, error: 'unauthorized', retryable: false },
          { status: 401 },
        );
      }
      const declaredLength = request.headers.get('content-length');
      if (
        declaredLength !== null &&
        (/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) ? Number(declaredLength) > 4096 : true)
      ) {
        return managementJson(
          { ok: false, version: 1, error: 'invalid-request', retryable: false },
          { status: 413 },
        );
      }
      const bodyDecision = await readPromotionBody(request);
      if (!bodyDecision.ok || bodyDecision.body.byteLength > 4096) {
        return managementJson(
          { ok: false, version: 1, error: 'invalid-request', retryable: false },
          { status: bodyDecision.ok ? 413 : bodyDecision.status },
        );
      }
      const auth = await verifyManagementAssertion({
        request,
        body: bodyDecision.body,
        environment: env as Env & ManagementAuthEnvironment,
      });
      if (!auth.ok) {
        return managementJson(
          { ok: false, version: 1, error: auth.error, retryable: false },
          { status: auth.error === 'promotion-disabled' ? 503 : 401 },
        );
      }
      const parsed = await parseOwnerSessionManagementRequest(bodyDecision.value, route.claimId);
      if (!parsed.ok) {
        return managementJson(
          { ok: false, version: 1, error: 'invalid-request', retryable: false },
          { status: 400 },
        );
      }
      if (parsed.request.ownerPrincipalId !== auth.principalId) {
        return managementJson(
          { ok: false, version: 1, error: 'unauthorized', retryable: false },
          { status: 401 },
        );
      }
      const claimNamespace = (
        env as Env & { LASH_DOCUMENT_CLAIM: DurableObjectNamespace<LashDocumentClaim> }
      ).LASH_DOCUMENT_CLAIM;
      if (!claimNamespace) {
        return managementJson(
          { ok: false, version: 1, error: 'internal-error', retryable: true },
          { status: 500 },
        );
      }
      const internalUrl = new URL(request.url);
      internalUrl.pathname = '/__lash-document-claim/owner-session';
      internalUrl.search = '';
      let internalResponse: Response;
      try {
        internalResponse = await claimNamespace.getByName(route.claimId).fetch(
          new Request(internalUrl, {
            method: 'POST',
            headers: {
              'content-type': 'application/json; charset=utf-8',
              'content-encoding': 'identity',
              'x-lash-internal-management': 'owner-session-v1',
            },
            body: JSON.stringify({
              version: 1,
              requestId: auth.requestId,
              bodySha256: auth.bodySha256,
              ownerSession: parsed.request,
            }),
          }),
        );
      } catch {
        return managementJson(
          { ok: false, version: 1, error: 'internal-error', retryable: true },
          { status: 500 },
        );
      }
      const result = await internalResponse.json().catch(() => null);
      if (!isOwnerSessionResult(result) || internalResponse.status !== ownerSessionStatus(result)) {
        return managementJson(
          { ok: false, version: 1, error: 'internal-error', retryable: true },
          { status: 500 },
        );
      }
      if (
        result.ok &&
        (result.claimId !== route.claimId ||
          result.ownerPrincipalId !== auth.principalId ||
          result.socket.path !==
            `/api/realtime/rooms/${result.roomId}/socket?protocolVersion=3&actorId=${parsed.request.actorId}`)
      ) {
        return managementJson(
          { ok: false, version: 1, error: 'internal-error', retryable: true },
          { status: 500 },
        );
      }
      return managementJson(result, { status: ownerSessionStatus(result) });
    }

    if (route.kind === 'management-document-claim-promotion') {
      if (request.method !== 'POST') {
        return managementJson(
          { ok: false, version: 2, error: 'unauthorized', retryable: false },
          { status: 401 },
        );
      }
      const bodyDecision = await readPromotionBody(request);
      if (!bodyDecision.ok) {
        return managementJson(
          { ok: false, version: 2, error: 'invalid-request', retryable: false },
          { status: bodyDecision.status },
        );
      }
      const auth = await verifyManagementAssertion({
        request,
        body: bodyDecision.body,
        environment: env as Env & ManagementAuthEnvironment,
      });
      if (!auth.ok) {
        return managementJson(
          { ok: false, version: 2, error: auth.error, retryable: false },
          { status: auth.error === 'promotion-disabled' ? 503 : 401 },
        );
      }
      const parsed = await parseDocumentClaimPromotionRequest(bodyDecision.value, route.claimId);
      if (!parsed.ok) {
        return managementJson(
          { ok: false, version: 2, error: 'invalid-request', retryable: false },
          { status: 400 },
        );
      }
      if (parsed.request.ownerPrincipalId !== auth.principalId) {
        return managementJson(
          { ok: false, version: 2, error: 'unauthorized', retryable: false },
          { status: 401 },
        );
      }
      const claimNamespace = (
        env as Env & { LASH_DOCUMENT_CLAIM: DurableObjectNamespace<LashDocumentClaim> }
      ).LASH_DOCUMENT_CLAIM;
      if (!claimNamespace) {
        return managementJson(
          { ok: false, version: 2, error: 'internal-error', retryable: true },
          { status: 500 },
        );
      }
      const internalUrl = new URL(request.url);
      internalUrl.pathname = '/__lash-document-claim/promote';
      internalUrl.search = '';
      let internalResponse: Response;
      try {
        internalResponse = await claimNamespace.getByName(route.claimId).fetch(
          new Request(internalUrl, {
            method: 'POST',
            headers: {
              'content-type': 'application/json; charset=utf-8',
              'content-encoding': 'identity',
              'x-lash-internal-management': 'document-claim-v2',
            },
            body: JSON.stringify({
              version: 2,
              requestId: auth.requestId,
              bodySha256: auth.bodySha256,
              promotion: parsed.request,
            }),
          }),
        );
      } catch {
        return managementJson(
          { ok: false, version: 2, error: 'internal-error', retryable: true },
          { status: 500 },
        );
      }
      const result = await internalResponse.json().catch(() => null);
      if (
        !isClaimPromotionResult(result) ||
        internalResponse.status !== claimPromotionStatus(result)
      ) {
        return managementJson(
          { ok: false, version: 2, error: 'internal-error', retryable: true },
          { status: 500 },
        );
      }
      if (
        result.ok &&
        (result.claimId !== route.claimId ||
          result.ownerPrincipalId !== auth.principalId ||
          result.snapshotSha256 !== parsed.request.snapshot.snapshotSha256)
      ) {
        return managementJson(
          { ok: false, version: 2, error: 'internal-error', retryable: true },
          { status: 500 },
        );
      }
      return managementJson(result, { status: claimPromotionStatus(result) });
    }

    if (route.kind === 'management-document-promotion') {
      if (request.method === 'OPTIONS') {
        return managementJson(
          { ok: false, version: 1, error: 'unauthorized', retryable: false },
          { status: 401 },
        );
      }
      if (request.method !== 'POST') {
        return managementJson(
          { ok: false, version: 1, error: 'unauthorized', retryable: false },
          { status: 401 },
        );
      }
      const bodyDecision = await readPromotionBody(request);
      if (!bodyDecision.ok) {
        return managementJson(
          { ok: false, version: 1, error: 'invalid-request', retryable: false },
          { status: bodyDecision.status },
        );
      }
      const auth = await verifyManagementAssertion({
        request,
        body: bodyDecision.body,
        environment: env as Env & ManagementAuthEnvironment,
      });
      if (!auth.ok) {
        return managementJson(
          {
            ok: false,
            version: 1,
            error: auth.error,
            retryable: false,
          },
          { status: auth.error === 'promotion-disabled' ? 503 : 401 },
        );
      }
      return managementJson(
        { ok: false, version: 1, error: 'upgrade-required', retryable: false },
        { status: 409 },
      );
    }

    if (url.pathname.startsWith('/api/management/')) {
      return managementJson(
        { ok: false, version: 1, error: 'invalid-request', retryable: false },
        { status: 404 },
      );
    }

    if (url.pathname.startsWith('/api/public-control/')) {
      return managementJson(
        { ok: false, version: 1, error: 'invalid-request', retryable: false },
        { status: 404 },
      );
    }

    if (url.pathname.startsWith('/api/public-comment-control/')) {
      return managementJson(
        { ok: false, version: 1, error: 'invalid-request', retryable: false },
        { status: 404 },
      );
    }

    if (request.method === 'OPTIONS') {
      return route.kind === 'not-found'
        ? json({ ok: false, error: 'not_found' }, { status: 404 })
        : new Response(null, {
            status: 204,
            headers: {
              'access-control-allow-headers': 'authorization, cache-control, content-type',
              'access-control-allow-methods': 'GET, POST, OPTIONS',
              'access-control-allow-origin': '*',
              'cache-control': 'no-store',
            },
          });
    }

    if (route.kind === 'service-health') {
      if (request.method !== 'GET') {
        return rejectSession('method-not-allowed', 405);
      }
      return json({
        ok: true,
        runtime: REALTIME_RUNTIME,
        service: 'lash-realtime',
      });
    }

    if (route.kind === 'room-session') {
      if (isNamedEditRoomId(route.roomId)) return deny('invalid');
      let actorId: string;
      let inviteToken: string | null;

      if (request.method === 'GET') {
        if (url.searchParams.has('inviteToken')) {
          return rejectSession('method-not-allowed', 405);
        }
        const queryKeys = [...url.searchParams.keys()];
        if (
          !usingLocalFallback ||
          !isLocalRealtimeFallbackHost(url) ||
          queryKeys.some((key) => key !== 'actorId') ||
          url.searchParams.getAll('actorId').length > 1
        ) {
          return rejectSession('method-not-allowed', 405);
        }
        const rawActorId = url.searchParams.get('actorId');
        if (
          rawActorId !== null &&
          (rawActorId.length > MAX_SESSION_ACTOR_LENGTH || !/[a-z0-9]/iu.test(rawActorId))
        ) {
          return rejectSession('invalid-request', 400);
        }
        actorId = normalizeActorId(rawActorId);
        inviteToken = null;
      } else if (request.method === 'POST') {
        if ([...url.searchParams.keys()].length > 0) {
          return rejectSession('invalid-request', 400);
        }
        const bodyDecision = await readSessionBody(request);
        if (!bodyDecision.ok) {
          return rejectSession('invalid-request', bodyDecision.status);
        }
        actorId = bodyDecision.body.actorId;
        inviteToken = bodyDecision.body.inviteToken;
      } else {
        return rejectSession('method-not-allowed', 405);
      }

      // SECURITY: when no session secret is configured we run on PUBLIC dev
      // fallback secrets (LOCAL_DEV_SESSION_SECRET / LOCAL_DEV_INVITE_SECRET),
      // so any token — invite or session — would be forgeable. Refuse to serve a
      // non-local host entirely in that mode rather than honoring invite tokens
      // signed with a public secret. (Do NOT move this gate into the no-token
      // branch: that lets dev-secret-forged invite tokens through — see
      // codex:rescue review of F-C21-03.)
      if (usingLocalFallback && !isLocalRealtimeFallbackHost(url)) {
        return deny('invalid');
      }
      if (!usingLocalFallback && !isLocalRealtimeFallbackHost(url) && inviteToken) {
        return inviteAuthorityUnavailable();
      }
      let grant: RealtimeSessionGrant;
      if (inviteToken) {
        const inviteDecision = await createRealtimeGrantFromInviteToken(
          actorId,
          route.roomId,
          inviteToken,
          inviteSecret(env),
        );
        if (!inviteDecision.ok) return deny(inviteDecision.reason);
        grant = inviteDecision.grant;
      } else if (usingLocalFallback) {
        grant = createDefaultRealtimeGrant(actorId, route.roomId);
      } else {
        return deny('invalid');
      }
      const accessToken = await createRealtimeSessionToken(grant, secret);
      return json({
        ok: true,
        accessToken,
        grant,
        inviteRequired: !usingLocalFallback,
        protocolVersion: REALTIME_PROTOCOL_VERSION,
      });
    }

    if (route.kind === 'room-health') {
      if (isNamedEditRoomId(route.roomId)) return deny('invalid');
      if (request.method !== 'GET') {
        return rejectSession('method-not-allowed', 405);
      }
      const decision = await verifyRealtimeSessionToken(accessTokenFor(request, url), secret, {
        documentId: route.roomId,
        capability: 'doc.read',
      });
      if (!decision.ok) return deny(decision.reason);
      const stub = env.LASH_REALTIME_ROOM.getByName(route.roomId);
      return withCors(
        await stub.fetch(roomRequest(request, route.roomId, '/__lash-room/health', decision.grant)),
      );
    }

    if (route.kind === 'room-socket') {
      if (request.method !== 'GET') {
        return rejectSession('method-not-allowed', 405);
      }
      const namedVersion = namedSocketVersion(url);
      if (namedVersion !== null) {
        const comment = namedVersion === NAMED_COMMENT_PROTOCOL_VERSION;
        const enabled = comment
          ? namedCommentEnabled(namedEditEnv)
          : namedEditEnabled(namedEditEnv);
        const socketProtocol = comment ? NAMED_COMMENT_SOCKET_PROTOCOL : NAMED_EDIT_SOCKET_PROTOCOL;
        const parseProtocols = comment
          ? parseNamedCommentSocketProtocols
          : parseNamedEditSocketProtocols;
        const entries = [...url.searchParams.entries()];
        const actorId = url.searchParams.get('actorId');
        if (
          !enabled ||
          !isNamedEditRoomId(route.roomId) ||
          url.pathname !== `/api/realtime/rooms/${route.roomId}/socket` ||
          entries.length !== 2 ||
          entries[0]?.[0] !== 'protocolVersion' ||
          entries[1]?.[0] !== 'actorId' ||
          !isNamedEditActorId(actorId) ||
          !parseProtocols(request.headers.get('sec-websocket-protocol')) ||
          !isNamedEditOrigin(request.headers.get('origin')) ||
          request.headers.get('upgrade')?.toLowerCase() !== 'websocket' ||
          request.headers.has('authorization')
        ) {
          return namedEditResponse(namedEditFailure('forbidden'));
        }
        const response = await env.LASH_REALTIME_ROOM.getByName(route.roomId).fetch(
          namedSocketRequest(request, route.roomId, actorId, namedVersion),
        );
        if (
          response.status === 101 &&
          response.headers.get('sec-websocket-protocol') !== socketProtocol
        ) {
          return namedEditResponse(namedEditFailure('forbidden'));
        }
        return response;
      }
      if (url.searchParams.get('protocolVersion') === String(PUBLIC_REALTIME_PROTOCOL_VERSION)) {
        const entries = [...url.searchParams.entries()];
        const actorId = url.searchParams.get('actorId');
        const protocols = parsePublicSocketProtocols(request.headers.get('sec-websocket-protocol'));
        if (
          entries.length !== 2 ||
          entries[0]?.[0] !== 'protocolVersion' ||
          entries[0]?.[1] !== String(PUBLIC_REALTIME_PROTOCOL_VERSION) ||
          entries[1]?.[0] !== 'actorId' ||
          entries[1]?.[1] !== actorId ||
          typeof actorId !== 'string' ||
          !/^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/u.test(actorId) ||
          !protocols.ok ||
          !isCanonicalBrowserOrigin(request.headers.get('origin')) ||
          request.headers.get('upgrade')?.toLowerCase() !== 'websocket' ||
          request.headers.has('authorization')
        ) {
          return deny('invalid');
        }
        const response = await env.LASH_REALTIME_ROOM.getByName(route.roomId).fetch(
          publicSocketRequest(request, route.roomId, actorId),
        );
        if (response.status === 101) {
          const selected = response.headers.get('sec-websocket-protocol');
          if (selected !== PUBLIC_SOCKET_PROTOCOL || selected.includes('lash-public-ticket.')) {
            return deny('invalid');
          }
        }
        return response;
      }
      if (url.searchParams.get('protocolVersion') === String(OWNER_REALTIME_PROTOCOL_VERSION)) {
        const entries = [...url.searchParams.entries()];
        const actorId = url.searchParams.get('actorId');
        const protocols = parseOwnerSocketProtocols(request.headers.get('sec-websocket-protocol'));
        if (
          entries.length !== 2 ||
          entries[0]?.[0] !== 'protocolVersion' ||
          entries[0]?.[1] !== String(OWNER_REALTIME_PROTOCOL_VERSION) ||
          entries[1]?.[0] !== 'actorId' ||
          entries[1]?.[1] !== actorId ||
          !isCanonicalOwnerActorId(actorId) ||
          !protocols.ok ||
          request.headers.get('upgrade')?.toLowerCase() !== 'websocket'
        ) {
          return deny('invalid');
        }
        const stub = env.LASH_REALTIME_ROOM.getByName(route.roomId);
        const response = await stub.fetch(ownerSocketRequest(request, route.roomId, actorId));
        if (response.status === 101) {
          const selected = response.headers.get('sec-websocket-protocol');
          if (selected !== OWNER_SOCKET_PROTOCOL || selected.includes('lash-ticket.')) {
            return deny('invalid');
          }
        }
        return response;
      }
      if (isNamedEditRoomId(route.roomId)) return deny('invalid');
      const decision = await verifyRealtimeSessionToken(accessTokenFor(request, url), secret, {
        documentId: route.roomId,
        capability: 'doc.read',
      });
      if (!decision.ok) return deny(decision.reason);
      if (
        url.searchParams.getAll('protocolVersion').length !== 1 ||
        url.searchParams.get('protocolVersion') !== String(REALTIME_PROTOCOL_VERSION)
      ) {
        return rejectSession('protocol-mismatch', 409);
      }
      const stub = env.LASH_REALTIME_ROOM.getByName(route.roomId);
      return stub.fetch(roomRequest(request, route.roomId, '/__lash-room/socket', decision.grant));
    }

    if (route.kind === 'room-restore') {
      if (isNamedEditRoomId(route.roomId)) return deny('invalid');
      if (request.method !== 'POST') {
        return rejectSession('method-not-allowed', 405);
      }
      const decision = await verifyRealtimeSessionToken(accessTokenFor(request, url), secret, {
        documentId: route.roomId,
        capability: 'doc.edit',
      });
      if (!decision.ok) return deny(decision.reason);
      const stub = env.LASH_REALTIME_ROOM.getByName(route.roomId);
      return withCors(
        await stub.fetch(
          roomRequest(request, route.roomId, '/__lash-room/restore', decision.grant),
        ),
      );
    }

    return json({ ok: false, error: 'not_found' }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
