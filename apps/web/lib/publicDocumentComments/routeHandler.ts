import type {
  PublicCommentCreateRequestV1,
  PublicCommentCreateResultV1,
  PublicCommentListRequestV1,
  PublicCommentModerationRequestV1,
} from '@lash/types';
import { NextRequest, NextResponse } from 'next/server';

import {
  parsePublicCommentAuthoringSessionBody,
  parsePublicCommentCreateBody,
  parsePublicCommentHideBody,
  parsePublicCommentListBody,
  parsePublicCommentRoomId,
  PUBLIC_COMMENT_REQUEST_LIMITS,
  readPublicCommentJsonPost,
} from './boundary';
import { loadPublicDocumentCommentConfig } from './config';
import {
  clearPublicCommentCsrfCookie,
  createPublicCommentCsrfSession,
  derivePublicCommentAlias,
  PUBLIC_COMMENT_CSRF_COOKIE_NAME,
  setPublicCommentCsrfCookie,
  verifyPublicCommentCsrf,
} from './csrf';
import {
  callWorkerPublicCommentModeration,
  callWorkerPublicComments,
  type PublicCommentModerationWorkerCall,
  type PublicCommentModerationWorkerOutcome,
  type PublicCommentWorkerCall,
  type PublicCommentWorkerOutcome,
} from './workerClient';
import {
  createRouteSupabaseClientSession,
  type RouteSupabaseClientSession,
} from '../auth/serverClient';
import {
  requireServerAccountPrincipal,
  resolveServerAccountPrincipal,
} from '../auth/serverPrincipal';
import { loadDocumentPromotionConfig } from '../documentPromotion/config';
import { deriveDocumentClaimId } from '../documentPromotion/crypto';
import { parseCanonicalLocalDocumentId } from '../documentPromotion/validation';
import { derivePublicRateKey } from '../publicDocumentAccess/rateKey';

type FailureError =
  | 'authentication-required'
  | 'comment-conflict'
  | 'document-unavailable'
  | 'invalid-request'
  | 'moderation-conflict'
  | 'public-access-changed'
  | 'rate-limited'
  | 'temporarily-unavailable';

type VaryPolicy = 'origin' | 'account';

const applyPrivateResponseHeaders = <Response extends NextResponse>(
  response: Response,
  vary: VaryPolicy,
) => {
  response.headers.set('cache-control', 'private, no-cache, no-store, must-revalidate, max-age=0');
  response.headers.set('expires', '0');
  response.headers.set('pragma', 'no-cache');
  response.headers.set('referrer-policy', 'no-referrer');
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('vary', vary === 'account' ? 'Cookie, Origin' : 'Origin');
  response.headers.delete('access-control-allow-origin');
  return response;
};

const failure = (error: FailureError, status: number, retryable: boolean, vary: VaryPolicy) => {
  const response = NextResponse.json(
    { ok: false as const, version: 1 as const, error, retryable },
    { status },
  );
  if (error === 'rate-limited') response.headers.set('retry-after', '60');
  return applyPrivateResponseHeaders(response, vary);
};

const boundaryFailure = (status: 400 | 403 | 413, vary: VaryPolicy) =>
  failure('invalid-request', status, false, vary);

const authErrorCode = (error: unknown) =>
  error && typeof error === 'object' && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined;

const readCookie = (headers: Headers, name: string): string | null => {
  const raw = headers.get('cookie');
  if (!raw) return null;
  const values: string[] = [];
  for (const segment of raw.split(';')) {
    const trimmed = segment.trim();
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    if (trimmed.slice(0, separator) === name) values.push(trimmed.slice(separator + 1));
  }
  return values.length === 1 && values[0] ? values[0] : null;
};

const finalizeSessionResponse = <Response extends NextResponse>(input: {
  response: Response;
  session: RouteSupabaseClientSession;
  siteOrigin: string;
  cookie?: { kind: 'set'; value: string } | { kind: 'clear' };
}) => {
  const response = input.session.applyTo(input.response);
  if (input.cookie?.kind === 'set') {
    setPublicCommentCsrfCookie(response.cookies, input.cookie.value, input.siteOrigin);
  } else if (input.cookie?.kind === 'clear') {
    clearPublicCommentCsrfCookie(response.cookies, input.siteOrigin);
  }
  return applyPrivateResponseHeaders(response, 'account');
};

const listResultResponse = (outcome: PublicCommentWorkerOutcome) => {
  if (outcome.kind !== 'verified') {
    return failure('temporarily-unavailable', 503, true, 'origin');
  }
  if (outcome.result.ok) {
    return applyPrivateResponseHeaders(
      NextResponse.json(outcome.result, { status: 200 }),
      'origin',
    );
  }
  if (outcome.result.error === 'public-access-changed') {
    return failure('public-access-changed', 409, false, 'origin');
  }
  if (outcome.result.error === 'rate-limited' && outcome.retryAfter === 60) {
    return failure('rate-limited', 429, true, 'origin');
  }
  return failure('temporarily-unavailable', 503, true, 'origin');
};

const createResultResponse = (outcome: PublicCommentWorkerOutcome) => {
  if (outcome.kind !== 'verified') {
    return failure('temporarily-unavailable', 503, true, 'account');
  }
  const result = outcome.result as PublicCommentCreateResultV1;
  if (result.ok) {
    return applyPrivateResponseHeaders(
      NextResponse.json(result, { status: result.created ? 201 : 200 }),
      'account',
    );
  }
  if (result.error === 'public-access-changed') {
    return failure('public-access-changed', 409, false, 'account');
  }
  if (result.error === 'idempotency-conflict') {
    return failure('comment-conflict', 409, false, 'account');
  }
  if (result.error === 'rate-limited' && outcome.retryAfter === 60) {
    return failure('rate-limited', 429, true, 'account');
  }
  return failure('temporarily-unavailable', 503, true, 'account');
};

export type PublicCommentListRouteDependencies = Readonly<{
  loadConfig: typeof loadPublicDocumentCommentConfig;
  callWorker: (call: PublicCommentWorkerCall) => Promise<PublicCommentWorkerOutcome>;
}>;

const defaultListDependencies: PublicCommentListRouteDependencies = {
  loadConfig: loadPublicDocumentCommentConfig,
  callWorker: callWorkerPublicComments,
};

export async function handlePublicCommentList(
  request: NextRequest,
  params: { roomId: string },
  dependencies: PublicCommentListRouteDependencies = defaultListDependencies,
) {
  let config;
  try {
    config = dependencies.loadConfig();
  } catch {
    return failure('temporarily-unavailable', 503, true, 'origin');
  }
  const roomId = parsePublicCommentRoomId(params.roomId);
  if (!roomId) return boundaryFailure(400, 'origin');
  const path = `/api/public/documents/${roomId}/comments/list`;
  const envelope = await readPublicCommentJsonPost({
    request,
    siteOrigin: config.siteOrigin,
    expectedPath: path,
    maxBytes: PUBLIC_COMMENT_REQUEST_LIMITS.list,
  });
  if (!envelope.ok) return boundaryFailure(envelope.status, 'origin');
  const parsed = parsePublicCommentListBody(envelope.rawBody);
  if (!parsed.ok) return boundaryFailure(400, 'origin');
  const rateKey = derivePublicRateKey(
    config.rateKey,
    request.headers.get(config.rateKey.headerName),
  );
  if (!rateKey) return failure('temporarily-unavailable', 503, true, 'origin');
  const workerRequest: PublicCommentListRequestV1 = {
    ...parsed.request,
    roomId,
    limit: 50,
    rateKey,
  };
  let outcome: PublicCommentWorkerOutcome;
  try {
    outcome = await dependencies.callWorker({
      workerOrigin: config.workerOrigin,
      commentControlSecret: config.commentControlSecret,
      action: 'list',
      request: workerRequest,
    });
  } catch {
    outcome = { kind: 'unverified-failure' };
  }
  return listResultResponse(outcome);
}

export type PublicCommentAuthoringSessionRouteDependencies = Readonly<{
  loadConfig: typeof loadPublicDocumentCommentConfig;
  createSession: (request: NextRequest) => RouteSupabaseClientSession;
  resolvePrincipal: typeof resolveServerAccountPrincipal;
  createCsrf: typeof createPublicCommentCsrfSession;
}>;

const defaultAuthoringDependencies: PublicCommentAuthoringSessionRouteDependencies = {
  loadConfig: loadPublicDocumentCommentConfig,
  createSession: createRouteSupabaseClientSession,
  resolvePrincipal: resolveServerAccountPrincipal,
  createCsrf: createPublicCommentCsrfSession,
};

export async function handlePublicCommentAuthoringSession(
  request: NextRequest,
  params: { roomId: string },
  dependencies: PublicCommentAuthoringSessionRouteDependencies = defaultAuthoringDependencies,
) {
  let config;
  try {
    config = dependencies.loadConfig();
  } catch {
    return failure('temporarily-unavailable', 503, true, 'account');
  }
  const roomId = parsePublicCommentRoomId(params.roomId);
  if (!roomId) return boundaryFailure(400, 'account');
  const envelope = await readPublicCommentJsonPost({
    request,
    siteOrigin: config.siteOrigin,
    expectedPath: `/api/public/documents/${roomId}/comments/authoring-session`,
    maxBytes: PUBLIC_COMMENT_REQUEST_LIMITS.authoringSession,
  });
  if (!envelope.ok) return boundaryFailure(envelope.status, 'account');
  if (!parsePublicCommentAuthoringSessionBody(envelope.rawBody).ok) {
    return boundaryFailure(400, 'account');
  }

  let session: RouteSupabaseClientSession;
  try {
    session = dependencies.createSession(request);
  } catch {
    return failure('temporarily-unavailable', 503, true, 'account');
  }

  let resolution;
  try {
    resolution = await dependencies.resolvePrincipal(session.client);
  } catch {
    return finalizeSessionResponse({
      response: failure('temporarily-unavailable', 503, true, 'account'),
      session,
      siteOrigin: config.siteOrigin,
      cookie: { kind: 'clear' },
    });
  }
  if (resolution.status === 'unavailable') {
    return finalizeSessionResponse({
      response: failure('temporarily-unavailable', 503, true, 'account'),
      session,
      siteOrigin: config.siteOrigin,
      cookie: { kind: 'clear' },
    });
  }
  if (resolution.status !== 'authenticated') {
    return finalizeSessionResponse({
      response: NextResponse.json({
        ok: true as const,
        version: 1 as const,
        authenticated: false as const,
      }),
      session,
      siteOrigin: config.siteOrigin,
      cookie: { kind: 'clear' },
    });
  }

  let csrf;
  try {
    csrf = dependencies.createCsrf({
      roomId,
      principalId: resolution.principal.id,
      principalKey: config.principalKey,
    });
  } catch {
    return finalizeSessionResponse({
      response: failure('temporarily-unavailable', 503, true, 'account'),
      session,
      siteOrigin: config.siteOrigin,
      cookie: { kind: 'clear' },
    });
  }
  return finalizeSessionResponse({
    response: NextResponse.json({
      ok: true as const,
      version: 1 as const,
      authenticated: true as const,
      csrfProof: csrf.csrfProof,
      expiresAt: csrf.expiresAt,
    }),
    session,
    siteOrigin: config.siteOrigin,
    cookie: { kind: 'set', value: csrf.cookieValue },
  });
}

export type PublicCommentCreateRouteDependencies = Readonly<{
  loadConfig: typeof loadPublicDocumentCommentConfig;
  createSession: (request: NextRequest) => RouteSupabaseClientSession;
  requirePrincipal: typeof requireServerAccountPrincipal;
  callWorker: (call: PublicCommentWorkerCall) => Promise<PublicCommentWorkerOutcome>;
  nowSeconds: () => number;
}>;

const defaultCreateDependencies: PublicCommentCreateRouteDependencies = {
  loadConfig: loadPublicDocumentCommentConfig,
  createSession: createRouteSupabaseClientSession,
  requirePrincipal: requireServerAccountPrincipal,
  callWorker: callWorkerPublicComments,
  nowSeconds: () => Math.floor(Date.now() / 1_000),
};

export async function handlePublicCommentCreate(
  request: NextRequest,
  params: { roomId: string },
  dependencies: PublicCommentCreateRouteDependencies = defaultCreateDependencies,
) {
  let config;
  try {
    config = dependencies.loadConfig();
  } catch {
    return failure('temporarily-unavailable', 503, true, 'account');
  }
  const roomId = parsePublicCommentRoomId(params.roomId);
  if (!roomId) return boundaryFailure(400, 'account');
  const envelope = await readPublicCommentJsonPost({
    request,
    siteOrigin: config.siteOrigin,
    expectedPath: `/api/public/documents/${roomId}/comments/create`,
    maxBytes: PUBLIC_COMMENT_REQUEST_LIMITS.create,
  });
  if (!envelope.ok) return boundaryFailure(envelope.status, 'account');
  const parsed = parsePublicCommentCreateBody(envelope.rawBody);
  if (!parsed.ok) return boundaryFailure(400, 'account');

  let session: RouteSupabaseClientSession;
  try {
    session = dependencies.createSession(request);
  } catch {
    return failure('temporarily-unavailable', 503, true, 'account');
  }
  const finalize = <Response extends NextResponse>(response: Response, clearCsrf = false) =>
    finalizeSessionResponse({
      response,
      session,
      siteOrigin: config.siteOrigin,
      ...(clearCsrf ? { cookie: { kind: 'clear' as const } } : {}),
    });

  let principal;
  try {
    principal = await dependencies.requirePrincipal(session.client);
  } catch (error) {
    return finalize(
      authErrorCode(error) === 'auth-provider-unavailable'
        ? failure('temporarily-unavailable', 503, true, 'account')
        : failure('authentication-required', 401, false, 'account'),
      true,
    );
  }
  const validCsrf = verifyPublicCommentCsrf({
    roomId,
    principalId: principal.id,
    principalKey: config.principalKey,
    cookieValue: readCookie(request.headers, PUBLIC_COMMENT_CSRF_COOKIE_NAME),
    csrfProof: request.headers.get('x-lash-csrf-proof'),
    nowSeconds: dependencies.nowSeconds(),
  });
  if (!validCsrf) {
    return finalize(failure('invalid-request', 403, false, 'account'), true);
  }

  const workerRequest: PublicCommentCreateRequestV1 = {
    ...parsed.request,
    roomId,
    commenterPrincipalId: principal.id,
    commenterAlias: derivePublicCommentAlias(config.principalKey, roomId, principal.id),
  };
  let outcome: PublicCommentWorkerOutcome;
  try {
    outcome = await dependencies.callWorker({
      workerOrigin: config.workerOrigin,
      commentControlSecret: config.commentControlSecret,
      action: 'create',
      request: workerRequest,
    });
  } catch {
    outcome = { kind: 'unverified-failure' };
  }
  return finalize(createResultResponse(outcome));
}

export type PublicCommentHideRouteDependencies = Readonly<{
  loadConfig: typeof loadPublicDocumentCommentConfig;
  createSession: (request: NextRequest) => RouteSupabaseClientSession;
  requirePrincipal: typeof requireServerAccountPrincipal;
  loadPromotionConfig: typeof loadDocumentPromotionConfig;
  deriveClaimId: typeof deriveDocumentClaimId;
  callModeration: (
    call: PublicCommentModerationWorkerCall,
  ) => Promise<PublicCommentModerationWorkerOutcome>;
}>;

const defaultHideDependencies: PublicCommentHideRouteDependencies = {
  loadConfig: loadPublicDocumentCommentConfig,
  createSession: createRouteSupabaseClientSession,
  requirePrincipal: requireServerAccountPrincipal,
  loadPromotionConfig: loadDocumentPromotionConfig,
  deriveClaimId: deriveDocumentClaimId,
  callModeration: callWorkerPublicCommentModeration,
};

const moderationResultResponse = (outcome: PublicCommentModerationWorkerOutcome) => {
  if (outcome.kind !== 'verified') {
    return failure('temporarily-unavailable', 503, true, 'account');
  }
  const result = outcome.result;
  if (result.ok) {
    return applyPrivateResponseHeaders(
      NextResponse.json(
        {
          ok: true as const,
          version: 1 as const,
          commentId: result.commentId,
          state: result.state,
          changed: result.changed,
          policyVersion: result.policyVersion,
          cutoffGeneration: result.cutoffGeneration,
          moderatedAt: result.moderatedAt,
        },
        { status: 200 },
      ),
      'account',
    );
  }
  switch (result.error) {
    case 'claim-not-found':
    case 'comment-not-found':
    case 'claim-conflict':
    case 'owner-mismatch':
    case 'not-shareable':
      return failure('document-unavailable', 404, false, 'account');
    case 'policy-conflict':
      return failure('public-access-changed', 409, false, 'account');
    case 'replay-detected':
      return failure('moderation-conflict', 409, false, 'account');
    case 'invalid-request':
    case 'unauthorized':
    case 'promotion-disabled':
    case 'readback-failed':
    case 'internal-error':
      return failure('temporarily-unavailable', 503, true, 'account');
  }
};

export async function handlePublicCommentHide(
  request: NextRequest,
  params: { localDocumentId: string; commentId: string },
  dependencies: PublicCommentHideRouteDependencies = defaultHideDependencies,
) {
  let config;
  try {
    config = dependencies.loadConfig();
  } catch {
    return failure('temporarily-unavailable', 503, true, 'account');
  }
  let localDocumentId: string;
  try {
    localDocumentId = parseCanonicalLocalDocumentId(params.localDocumentId);
  } catch {
    return boundaryFailure(400, 'account');
  }
  const envelope = await readPublicCommentJsonPost({
    request,
    siteOrigin: config.siteOrigin,
    expectedPath: `/api/documents/${localDocumentId}/public-comments/${params.commentId}/hide`,
    maxBytes: PUBLIC_COMMENT_REQUEST_LIMITS.hide,
  });
  if (!envelope.ok) return boundaryFailure(envelope.status, 'account');
  const parsed = parsePublicCommentHideBody(envelope.rawBody, params.commentId);
  if (!parsed.ok) return boundaryFailure(400, 'account');

  let session: RouteSupabaseClientSession;
  try {
    session = dependencies.createSession(request);
  } catch {
    return failure('temporarily-unavailable', 503, true, 'account');
  }
  const finalize = <Response extends NextResponse>(response: Response, clearCsrf = false) =>
    finalizeSessionResponse({
      response,
      session,
      siteOrigin: config.siteOrigin,
      ...(clearCsrf ? { cookie: { kind: 'clear' as const } } : {}),
    });
  let principal;
  try {
    principal = await dependencies.requirePrincipal(session.client);
  } catch (error) {
    return finalize(
      authErrorCode(error) === 'auth-provider-unavailable'
        ? failure('temporarily-unavailable', 503, true, 'account')
        : failure('authentication-required', 401, false, 'account'),
      true,
    );
  }
  let promotion;
  try {
    promotion = dependencies.loadPromotionConfig();
  } catch {
    return finalize(failure('temporarily-unavailable', 503, true, 'account'));
  }
  const workerRequest: PublicCommentModerationRequestV1 = {
    ...parsed.request,
    claimId: dependencies.deriveClaimId(principal.id, localDocumentId),
    ownerPrincipalId: principal.id,
    localDocumentId,
    commentId: params.commentId,
    action: 'hide',
  };
  let outcome: PublicCommentModerationWorkerOutcome;
  try {
    outcome = await dependencies.callModeration({
      workerOrigin: promotion.workerOrigin,
      controlSecret: promotion.controlSecret,
      request: workerRequest,
    });
  } catch {
    outcome = { kind: 'unverified-failure' };
  }
  return finalize(moderationResultResponse(outcome));
}
