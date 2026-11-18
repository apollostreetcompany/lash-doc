import type { OwnerSessionManagementSuccessV1 } from '@lash/types';
import { NextRequest, NextResponse } from 'next/server';
import { Buffer } from 'node:buffer';

import type { OwnerSessionBrowserFailureV1, OwnerSessionBrowserSuccessV1 } from './types';
import { OWNER_SESSION_LIMITS, parseBrowserOwnerSessionRequest } from './validation';
import {
  callWorkerOwnerSession,
  type OwnerSessionWorkerOutcome,
  type VerifiedOwnerSessionFailureV1,
  type WorkerOwnerSessionCall,
} from './workerClient';
import { requireSupabaseAuthConfig } from '../auth/config';
import { isTrustedSiteRequest, preventAuthResponseCaching } from '../auth/http';
import {
  createRouteSupabaseClientSession,
  type RouteSupabaseClientSession,
} from '../auth/serverClient';
import { requireServerAccountPrincipal } from '../auth/serverPrincipal';
import { loadDocumentPromotionConfig } from '../documentPromotion/config';
import { deriveDocumentClaimId } from '../documentPromotion/crypto';
import { parseCanonicalLocalDocumentId } from '../documentPromotion/validation';

export interface DocumentOwnerSessionRouteDependencies {
  createSession: (request: NextRequest) => RouteSupabaseClientSession;
  requireAuthConfig: typeof requireSupabaseAuthConfig;
  requirePrincipal: typeof requireServerAccountPrincipal;
  loadWorkerConfig: typeof loadDocumentPromotionConfig;
  deriveClaimId: typeof deriveDocumentClaimId;
  callWorker: (call: WorkerOwnerSessionCall) => Promise<OwnerSessionWorkerOutcome>;
}

const defaultDependencies: DocumentOwnerSessionRouteDependencies = {
  createSession: createRouteSupabaseClientSession,
  requireAuthConfig: requireSupabaseAuthConfig,
  requirePrincipal: requireServerAccountPrincipal,
  loadWorkerConfig: loadDocumentPromotionConfig,
  deriveClaimId: deriveDocumentClaimId,
  callWorker: callWorkerOwnerSession,
};

const failure = (
  error: OwnerSessionBrowserFailureV1['error'],
  status: number,
): NextResponse<OwnerSessionBrowserFailureV1> => {
  const body: OwnerSessionBrowserFailureV1 =
    error === 'temporarily-unavailable'
      ? { ok: false, version: 1, error, retryable: true }
      : { ok: false, version: 1, error, retryable: false };
  return NextResponse.json(body, { status });
};

const applyOwnerSessionResponseHeaders = <Response extends NextResponse>(response: Response) => {
  const finalized = preventAuthResponseCaching(response);
  const vary = new Set(
    (finalized.headers.get('vary') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value && !/^(?:cookie|origin)$/iu.test(value)),
  );
  vary.add('Cookie');
  vary.add('Origin');
  finalized.headers.set('vary', [...vary].join(', '));
  return finalized;
};

const finalizeResponse = <Response extends NextResponse>(
  response: Response,
  session: RouteSupabaseClientSession,
) => applyOwnerSessionResponseHeaders(session.applyTo(response));

const hasTrustedFetchMetadata = (request: NextRequest) =>
  request.headers.get('sec-fetch-site') === 'same-origin' &&
  request.headers.get('sec-fetch-mode') === 'cors' &&
  request.headers.get('sec-fetch-dest') === 'empty';

const hasJsonMediaType = (request: NextRequest) => {
  const contentType = request.headers.get('content-type');
  if (contentType === null || contentType.includes(',')) return false;
  const [mediaType, ...parameters] = contentType.split(';').map((value) => value.trim());
  return (
    mediaType.toLowerCase() === 'application/json' &&
    parameters.length <= 1 &&
    parameters.every((parameter) => /^charset=utf-8$/iu.test(parameter.replace(/\s+/gu, ''))) &&
    request.headers.get('content-encoding') === null
  );
};

const readBoundedRequestBody = async (request: NextRequest) => {
  const declaredLength = request.headers.get('content-length');
  if (
    declaredLength !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) ||
      Number(declaredLength) > OWNER_SESSION_LIMITS.requestBytes)
  ) {
    return null;
  }
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > OWNER_SESSION_LIMITS.requestBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total));
  } catch {
    return null;
  }
};

const socketUrl = (workerOrigin: string, path: string) => {
  const url = new URL(path, workerOrigin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
};

const sanitizeSuccess = (
  localDocumentId: string,
  workerOrigin: string,
  result: OwnerSessionManagementSuccessV1,
): OwnerSessionBrowserSuccessV1 => ({
  ok: true as const,
  version: 1 as const,
  localDocumentId,
  remoteDocumentId: result.roomId,
  promotionSnapshotSha256: result.promotionSnapshotSha256,
  access: {
    source: 'owner' as const,
    capabilities: ['doc.read', 'doc.edit'] as const,
    protocolVersion: 3 as const,
  },
  socket: {
    url: socketUrl(workerOrigin, result.socket.path),
    protocol: 'lash-realtime-v3' as const,
    ticketProtocol: result.socket.ticket,
    expiresAt: result.socket.expiresAt,
  },
});

const isTransientWorkerFailure = (
  result: VerifiedOwnerSessionFailureV1,
): result is VerifiedOwnerSessionFailureV1 & { retryable: true } =>
  result.retryable && (result.error === 'readback-failed' || result.error === 'internal-error');

export async function handleDocumentOwnerSession(
  request: NextRequest,
  params: { localDocumentId: string },
  dependencies: DocumentOwnerSessionRouteDependencies = defaultDependencies,
) {
  let provider;
  try {
    provider = dependencies.requireAuthConfig();
  } catch {
    return applyOwnerSessionResponseHeaders(failure('document-unavailable', 503));
  }

  if (request.nextUrl.search !== '') {
    return applyOwnerSessionResponseHeaders(failure('invalid-request', 400));
  }
  if (!isTrustedSiteRequest(request, provider.siteOrigin, { requireOriginHeader: true })) {
    return applyOwnerSessionResponseHeaders(failure('invalid-request', 403));
  }
  if (!hasTrustedFetchMetadata(request) || !hasJsonMediaType(request)) {
    return applyOwnerSessionResponseHeaders(failure('invalid-request', 400));
  }

  let localDocumentId: string;
  try {
    localDocumentId = parseCanonicalLocalDocumentId(params.localDocumentId);
  } catch {
    return applyOwnerSessionResponseHeaders(failure('invalid-request', 400));
  }
  if (request.nextUrl.pathname !== `/api/documents/${localDocumentId}/owner-session`) {
    return applyOwnerSessionResponseHeaders(failure('invalid-request', 400));
  }

  let session: RouteSupabaseClientSession;
  try {
    session = dependencies.createSession(request);
  } catch {
    return applyOwnerSessionResponseHeaders(failure('document-unavailable', 503));
  }
  const finalize = <Response extends NextResponse>(response: Response) =>
    finalizeResponse(response, session);

  let principal;
  try {
    principal = await dependencies.requirePrincipal(session.client);
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? (error as { code?: unknown }).code
        : undefined;
    return finalize(
      code === 'auth-provider-unavailable'
        ? failure('temporarily-unavailable', 503)
        : failure('unauthenticated', 401),
    );
  }

  let rawBody: string | null;
  try {
    rawBody = await readBoundedRequestBody(request);
  } catch {
    rawBody = null;
  }
  if (rawBody === null) return finalize(failure('invalid-request', 400));
  const parsed = parseBrowserOwnerSessionRequest(rawBody);
  if (!parsed.ok) return finalize(failure('invalid-request', 400));

  let workerConfig;
  try {
    workerConfig = dependencies.loadWorkerConfig();
  } catch {
    return finalize(failure('document-unavailable', 503));
  }

  let outcome: OwnerSessionWorkerOutcome;
  try {
    outcome = await dependencies.callWorker({
      workerOrigin: workerConfig.workerOrigin,
      controlSecret: workerConfig.controlSecret,
      request: {
        version: 1,
        claimId: dependencies.deriveClaimId(principal.id, localDocumentId),
        ownerPrincipalId: principal.id,
        localDocumentId,
        actorId: parsed.request.actorId,
        protocolVersion: 3,
      },
    });
  } catch {
    outcome = { kind: 'unverified-failure' };
  }

  if (outcome.kind === 'timeout') {
    return finalize(failure('temporarily-unavailable', 503));
  }
  if (outcome.kind === 'unverified-failure') {
    return finalize(failure('document-unavailable', 503));
  }
  if (!outcome.result.ok) {
    return finalize(
      isTransientWorkerFailure(outcome.result)
        ? failure('temporarily-unavailable', 503)
        : failure(
            'document-unavailable',
            outcome.result.error === 'claim-not-found' ||
              outcome.result.error === 'claim-conflict' ||
              outcome.result.error === 'owner-mismatch' ||
              outcome.result.error === 'not-shareable'
              ? 404
              : 503,
          ),
    );
  }

  return finalize(
    NextResponse.json(sanitizeSuccess(localDocumentId, workerConfig.workerOrigin, outcome.result), {
      status: 200,
    }),
  );
}
