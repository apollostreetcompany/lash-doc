import type { PublicControlSessionRequestV1, PublicControlSessionSuccessV1 } from '@lash/types';
import { NextRequest, NextResponse } from 'next/server';
import { Buffer } from 'node:buffer';

import { loadPublicDocumentSessionConfig } from './config';
import {
  parsePublicDocumentRoomId,
  parsePublicDocumentSessionRequestEnvelope,
  PUBLIC_DOCUMENT_SESSION_LIMITS,
} from './index';
import { derivePublicRateKey } from './rateKey';
import type {
  PublicDocumentBrowserSessionFailureV1,
  PublicDocumentBrowserSessionSuccessV1,
} from './types';
import {
  callWorkerPublicSession,
  type PublicSessionWorkerOutcome,
  type WorkerPublicSessionCall,
} from './workerClient';

export type PublicDocumentSessionRouteDependencies = Readonly<{
  loadConfig: typeof loadPublicDocumentSessionConfig;
  callWorker: (call: WorkerPublicSessionCall) => Promise<PublicSessionWorkerOutcome>;
  now: () => Date;
}>;

const defaultDependencies: PublicDocumentSessionRouteDependencies = {
  loadConfig: loadPublicDocumentSessionConfig,
  callWorker: callWorkerPublicSession,
  now: () => new Date(),
};

const applyPublicResponseHeaders = <Response extends NextResponse>(response: Response) => {
  response.headers.set('cache-control', 'no-store, max-age=0');
  response.headers.set('pragma', 'no-cache');
  response.headers.set('vary', 'Origin');
  response.headers.set('x-robots-tag', 'noindex, nofollow, noarchive');
  response.headers.delete('access-control-allow-origin');
  return response;
};

const failure = (error: PublicDocumentBrowserSessionFailureV1['error'], status: number) => {
  const retryable = error === 'rate-limited' || error === 'temporarily-unavailable';
  const response = NextResponse.json(
    {
      ok: false,
      version: 1,
      error,
      retryable,
    } satisfies PublicDocumentBrowserSessionFailureV1,
    { status },
  );
  if (error === 'rate-limited') response.headers.set('retry-after', '60');
  return applyPublicResponseHeaders(response);
};

const readBoundedRequestBody = async (request: NextRequest) => {
  const declaredLength = request.headers.get('content-length');
  if (
    declaredLength !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) ||
      Number(declaredLength) > PUBLIC_DOCUMENT_SESSION_LIMITS.requestBytes)
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
    if (total > PUBLIC_DOCUMENT_SESSION_LIMITS.requestBytes) {
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

const browserSocketUrl = (workerOrigin: string, path: string) => {
  const url = new URL(path, workerOrigin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
};

const sanitizeSuccess = (
  workerOrigin: string,
  result: PublicControlSessionSuccessV1,
): PublicDocumentBrowserSessionSuccessV1 => ({
  ok: true,
  version: 1,
  authorization: result.authorization,
  grant: result.grant,
  socket: {
    url: browserSocketUrl(workerOrigin, result.socket.path),
    protocol: result.socket.protocol,
    ticketProtocol: result.socket.ticketProtocol,
    expiresAt: result.socket.expiresAt,
  },
});

export async function handlePublicDocumentSession(
  request: NextRequest,
  params: { roomId: string },
  dependencies: PublicDocumentSessionRouteDependencies = defaultDependencies,
) {
  let config;
  try {
    config = dependencies.loadConfig();
  } catch {
    return failure('temporarily-unavailable', 503);
  }

  const roomId = parsePublicDocumentRoomId(params.roomId);
  const rawBody = await readBoundedRequestBody(request);
  const envelope =
    roomId && rawBody !== null
      ? parsePublicDocumentSessionRequestEnvelope({
          method: request.method,
          requestUrl: request.url,
          siteOrigin: config.siteOrigin,
          roomId,
          rawBody,
          headers: {
            origin: request.headers.get('origin'),
            contentType: request.headers.get('content-type'),
            contentEncoding: request.headers.get('content-encoding'),
            contentLength: request.headers.get('content-length'),
            secFetchSite: request.headers.get('sec-fetch-site'),
            secFetchMode: request.headers.get('sec-fetch-mode'),
            secFetchDest: request.headers.get('sec-fetch-dest'),
          },
        })
      : ({ ok: false, error: 'invalid-request' } as const);
  if (!envelope.ok) return failure('invalid-request', 400);

  const rateKey = derivePublicRateKey(
    config.rateKey,
    request.headers.get(config.rateKey.headerName),
  );
  if (!rateKey) return failure('temporarily-unavailable', 503);

  const workerRequest: PublicControlSessionRequestV1 = {
    version: 1,
    roomId: envelope.roomId,
    actorId: envelope.request.actorId,
    protocolVersion: 4,
    browserOrigin: config.siteOrigin,
    rateKey,
  };
  let outcome: PublicSessionWorkerOutcome;
  try {
    outcome = await dependencies.callWorker({
      workerOrigin: config.workerOrigin,
      publicControlSecret: config.publicControlSecret,
      request: workerRequest,
    });
  } catch {
    return failure('temporarily-unavailable', 503);
  }
  if (outcome.kind !== 'verified') return failure('temporarily-unavailable', 503);
  if (outcome.result.ok) {
    return applyPublicResponseHeaders(
      NextResponse.json(sanitizeSuccess(config.workerOrigin, outcome.result), { status: 200 }),
    );
  }
  if (outcome.result.error === 'document-unavailable') {
    return failure('document-unavailable', 404);
  }
  if (outcome.result.error === 'rate-limited') {
    return failure('rate-limited', 429);
  }
  return failure('temporarily-unavailable', 503);
}
