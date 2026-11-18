import { NextRequest, NextResponse } from 'next/server';
import { Buffer } from 'node:buffer';

import type {
  PublicAccessBrowserFailureV1,
  PublicAccessBrowserResultV1,
  PublicAccessBrowserSuccessV1,
  PublicAccessStateV1,
  PublicPolicyManagementResultV1,
} from './types';
import { parsePublicAccessPatchBody } from './validation';
import { callWorkerPublicPolicy, type WorkerPublicPolicyCall } from './workerClient';
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

const REQUEST_BYTES_LIMIT = 1024;

export interface DocumentPublicAccessRouteDependencies {
  createSession: (request: NextRequest) => RouteSupabaseClientSession;
  requireAuthConfig: typeof requireSupabaseAuthConfig;
  requirePrincipal: typeof requireServerAccountPrincipal;
  loadWorkerConfig: typeof loadDocumentPromotionConfig;
  deriveClaimId: typeof deriveDocumentClaimId;
  callWorker: (call: WorkerPublicPolicyCall) => Promise<PublicPolicyManagementResultV1>;
}

const defaultDependencies: DocumentPublicAccessRouteDependencies = {
  createSession: createRouteSupabaseClientSession,
  requireAuthConfig: requireSupabaseAuthConfig,
  requirePrincipal: requireServerAccountPrincipal,
  loadWorkerConfig: loadDocumentPromotionConfig,
  deriveClaimId: deriveDocumentClaimId,
  callWorker: callWorkerPublicPolicy,
};

const failure = (
  error: PublicAccessBrowserFailureV1['error'],
  retryable: boolean,
  status: number,
  state?: PublicAccessStateV1,
) =>
  NextResponse.json<PublicAccessBrowserFailureV1>(
    state
      ? { ok: false, version: 1, error, retryable, state }
      : { ok: false, version: 1, error, retryable },
    { status },
  );

const publicState = (
  result:
    | Extract<PublicPolicyManagementResultV1, { ok: true }>
    | { state: NonNullable<Extract<PublicPolicyManagementResultV1, { ok: false }>['state']> },
  siteOrigin: string,
): PublicAccessStateV1 => {
  const state = 'state' in result ? result.state : result;
  return {
    mode: state.mode,
    policyVersion: state.policyVersion,
    cutoffGeneration: state.cutoffGeneration,
    publicUrl:
      state.publicPath && !state.publicProjectionBlocked
        ? new URL(state.publicPath, siteOrigin).toString()
        : null,
    ...(state.publicProjectionBlocked ? { publicProjectionBlocked: true } : {}),
  };
};

const sanitizeSuccess = (
  result: Extract<PublicPolicyManagementResultV1, { ok: true }>,
  siteOrigin: string,
): PublicAccessBrowserSuccessV1 => ({
  ok: true,
  version: 1,
  state: publicState(result, siteOrigin),
  ...(typeof result.changed === 'boolean' ? { changed: result.changed } : {}),
});

const resultResponse = (
  result: PublicPolicyManagementResultV1,
  siteOrigin: string,
): NextResponse<PublicAccessBrowserResultV1> => {
  if (result.ok) {
    return NextResponse.json(sanitizeSuccess(result, siteOrigin), { status: 200 });
  }
  const state = result.state ? publicState({ state: result.state }, siteOrigin) : undefined;
  if (result.retryable) return failure('temporarily-unavailable', true, 503, state);
  switch (result.error) {
    case 'policy-conflict':
    case 'replay-detected':
      return failure('policy-conflict', false, 409, state);
    case 'unauthorized':
      return failure('unauthenticated', false, 401, state);
    case 'invalid-request':
      return failure('invalid-request', false, 400, state);
    case 'promotion-disabled':
    case 'claim-not-found':
    case 'claim-conflict':
    case 'owner-mismatch':
    case 'not-shareable':
      return failure('document-unavailable', false, 404, state);
    case 'readback-failed':
    case 'internal-error':
      return failure('temporarily-unavailable', true, 503, state);
  }
};

const hasTrustedPatchMetadata = (request: NextRequest) =>
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
    (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) || Number(declaredLength) > REQUEST_BYTES_LIMIT)
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
    if (total > REQUEST_BYTES_LIMIT) {
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

export async function handleDocumentPublicAccess(
  request: NextRequest,
  params: { localDocumentId: string },
  dependencies: DocumentPublicAccessRouteDependencies = defaultDependencies,
) {
  let provider;
  try {
    provider = dependencies.requireAuthConfig();
  } catch {
    return preventAuthResponseCaching(failure('temporarily-unavailable', true, 503));
  }
  const mutating = request.method === 'PATCH';
  if (
    request.nextUrl.search !== '' ||
    (request.method !== 'GET' && !mutating) ||
    !isTrustedSiteRequest(request, provider.siteOrigin, { requireOriginHeader: mutating }) ||
    (mutating && (!hasTrustedPatchMetadata(request) || !hasJsonMediaType(request)))
  ) {
    return preventAuthResponseCaching(
      failure(
        'invalid-request',
        false,
        request.method !== 'GET' && !mutating ? 405 : request.nextUrl.search ? 400 : 403,
      ),
    );
  }

  let localDocumentId: string;
  try {
    localDocumentId = parseCanonicalLocalDocumentId(params.localDocumentId);
  } catch {
    return preventAuthResponseCaching(failure('invalid-request', false, 400));
  }
  const pathname = `/api/documents/${localDocumentId}/settings/public-access`;
  if (request.nextUrl.pathname !== pathname) {
    return preventAuthResponseCaching(failure('invalid-request', false, 400));
  }

  let session: RouteSupabaseClientSession;
  try {
    session = dependencies.createSession(request);
  } catch {
    return preventAuthResponseCaching(failure('temporarily-unavailable', true, 503));
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
        ? failure('temporarily-unavailable', true, 503)
        : failure('unauthenticated', false, 401),
    );
  }

  let workerConfig;
  try {
    workerConfig = dependencies.loadWorkerConfig();
  } catch {
    return finalize(failure('temporarily-unavailable', true, 503));
  }
  const base = {
    version: 1 as const,
    claimId: dependencies.deriveClaimId(principal.id, localDocumentId),
    ownerPrincipalId: principal.id,
    localDocumentId,
  };

  let operation: WorkerPublicPolicyCall['operation'] = 'read';
  let managementRequest: WorkerPublicPolicyCall['request'] = base;
  if (mutating) {
    let rawBody: string | null = null;
    try {
      rawBody = await readBoundedRequestBody(request);
    } catch {
      rawBody = null;
    }
    if (rawBody === null) return finalize(failure('invalid-request', false, 400));
    const parsed = parsePublicAccessPatchBody(rawBody);
    if (!parsed.ok) return finalize(failure('invalid-request', false, 400));
    operation = 'update';
    managementRequest = { ...base, ...parsed.request };
  }

  let result: PublicPolicyManagementResultV1;
  try {
    result = await dependencies.callWorker({
      workerOrigin: workerConfig.workerOrigin,
      controlSecret: workerConfig.controlSecret,
      operation,
      request: managementRequest,
    });
  } catch {
    result = { ok: false, version: 1, error: 'internal-error', retryable: true };
  }
  if (
    !result.ok &&
    result.error === 'not-shareable' &&
    'mode' in managementRequest &&
    managementRequest.mode !== 'restricted'
  ) {
    try {
      const refreshed = await dependencies.callWorker({
        workerOrigin: workerConfig.workerOrigin,
        controlSecret: workerConfig.controlSecret,
        operation: 'read',
        request: base,
      });
      if (refreshed.ok && refreshed.publicProjectionBlocked) {
        return finalize(
          failure(
            'public-projection-blocked',
            false,
            409,
            publicState(refreshed, provider.siteOrigin),
          ),
        );
      }
    } catch {
      // Preserve the original denial when the authenticated readback is unavailable.
    }
  }
  return finalize(resultResponse(result, provider.siteOrigin));
}
