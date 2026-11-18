import type { DocumentClaimPromotionFailureV2, DocumentClaimPromotionResultV2 } from '@lash/types';
import { NextRequest, NextResponse } from 'next/server';
import { Buffer } from 'node:buffer';

import { loadDocumentPromotionConfig } from './config';
import { promoteDocumentSnapshot } from './controlPlane';
import { deriveDocumentPromotionIdempotencyHash } from './crypto';
import {
  parseBrowserPromotionRequest,
  parseCanonicalLocalDocumentId,
  PROMOTION_LIMITS,
} from './validation';
import { requireSupabaseAuthConfig } from '../auth/config';
import { isTrustedSiteRequest, preventAuthResponseCaching } from '../auth/http';
import {
  createRouteSupabaseClientSession,
  type RouteSupabaseClientSession,
} from '../auth/serverClient';
import { requireServerAccountPrincipal } from '../auth/serverPrincipal';

export interface DocumentPromotionRouteDependencies {
  createSession: (request: NextRequest) => RouteSupabaseClientSession;
  requireAuthConfig: typeof requireSupabaseAuthConfig;
  requirePrincipal: typeof requireServerAccountPrincipal;
  loadPromotionConfig: typeof loadDocumentPromotionConfig;
  promote: typeof promoteDocumentSnapshot;
}

const defaultDependencies: DocumentPromotionRouteDependencies = {
  createSession: createRouteSupabaseClientSession,
  requireAuthConfig: requireSupabaseAuthConfig,
  requirePrincipal: requireServerAccountPrincipal,
  loadPromotionConfig: loadDocumentPromotionConfig,
  promote: promoteDocumentSnapshot,
};

const failure = (
  error: DocumentClaimPromotionFailureV2['error'],
  retryable: boolean,
  status: number,
) =>
  NextResponse.json(
    retryable
      ? { ok: false, version: 2, error, retryable: true }
      : { ok: false, version: 2, error, retryable: false },
    { status },
  );

const resultStatus = (result: DocumentClaimPromotionResultV2) => {
  if (result.ok) return 200;
  if (result.retryable) return 503;
  switch (result.error) {
    case 'invalid-request':
      return 400;
    case 'unauthorized':
      return 401;
    case 'promotion-not-found':
      return 404;
    case 'replay-detected':
    case 'owner-mismatch':
    case 'promotion-conflict':
    case 'claim-conflict':
      return 409;
    case 'promotion-disabled':
      return 503;
    case 'upgrade-required':
      return 400;
  }
};

const readBoundedRequestBody = async (request: NextRequest) => {
  const declaredLength = request.headers.get('content-length');
  if (
    declaredLength !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) ||
      Number(declaredLength) > PROMOTION_LIMITS.requestBytes)
  ) {
    return null;
  }
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim();
  if (contentType !== 'application/json' || !request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > PROMOTION_LIMITS.requestBytes) {
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

const sanitizeSuccess = (result: Extract<DocumentClaimPromotionResultV2, { ok: true }>) => ({
  ok: true as const,
  version: 2 as const,
  roomId: result.roomId,
  aclVersion: 1 as const,
  publicPolicy: 'restricted' as const,
  publicPolicyVersion: 1 as const,
  snapshotSha256: result.snapshotSha256,
  created: result.created,
});

export async function handleDocumentPromotion(
  request: NextRequest,
  params: { localDocumentId: string },
  dependencies: DocumentPromotionRouteDependencies = defaultDependencies,
) {
  let provider;
  try {
    provider = dependencies.requireAuthConfig();
  } catch {
    return preventAuthResponseCaching(failure('internal-error', true, 503));
  }
  if (
    request.nextUrl.search !== '' ||
    !isTrustedSiteRequest(request, provider.siteOrigin, { requireOriginHeader: true })
  ) {
    return preventAuthResponseCaching(
      failure('invalid-request', false, request.nextUrl.search ? 400 : 403),
    );
  }

  let localDocumentId: string;
  try {
    localDocumentId = parseCanonicalLocalDocumentId(params.localDocumentId);
  } catch {
    return preventAuthResponseCaching(failure('invalid-request', false, 400));
  }
  if (request.nextUrl.pathname !== `/api/documents/${localDocumentId}/promote`) {
    return preventAuthResponseCaching(failure('invalid-request', false, 400));
  }

  let session: RouteSupabaseClientSession;
  try {
    session = dependencies.createSession(request);
  } catch {
    return preventAuthResponseCaching(failure('internal-error', true, 503));
  }
  const finalize = <Response extends NextResponse>(response: Response) =>
    preventAuthResponseCaching(session.applyTo(response));

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
        ? failure('internal-error', true, 503)
        : failure('unauthorized', false, 401),
    );
  }

  let rawBody: string | null;
  try {
    rawBody = await readBoundedRequestBody(request);
  } catch {
    rawBody = null;
  }
  if (rawBody === null) return finalize(failure('invalid-request', false, 400));

  const parsed = await parseBrowserPromotionRequest(rawBody);
  if (!parsed.ok) return finalize(failure('invalid-request', false, 400));

  let promotionConfig;
  try {
    promotionConfig = dependencies.loadPromotionConfig();
  } catch {
    return finalize(failure('internal-error', true, 503));
  }

  const idempotencyHash = deriveDocumentPromotionIdempotencyHash(
    principal.id,
    localDocumentId,
    parsed.idempotencyKey,
  );
  let result: DocumentClaimPromotionResultV2;
  try {
    result = await dependencies.promote({
      ...promotionConfig,
      principalId: principal.id,
      localDocumentId,
      idempotencyHash,
      snapshot: parsed.snapshot,
    });
  } catch {
    result = { ok: false, version: 2, error: 'internal-error', retryable: true };
  }

  return finalize(
    NextResponse.json(result.ok ? sanitizeSuccess(result) : result, {
      status: resultStatus(result),
    }),
  );
}
