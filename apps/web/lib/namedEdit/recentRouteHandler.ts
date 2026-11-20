import 'server-only';

import type { NextRequest } from 'next/server';

import { NAMED_EDIT_ROOM_ID, hasKeys, isObject } from './contract';
import {
  isNamedEditJsonRequest,
  isTrustedNamedEditRequest,
  loadNamedEditRouteConfig,
  namedEditRouteFailure,
  namedEditRouteResponse,
} from './routeHandler';
import { decryptNamedEditValue } from './serverCrypto';
import { callNamedEditWorker, readNamedEditJson } from './workerClient';
import { verifyPassiveRouteAccount } from '../auth/serverClient';

const bookmarkSyntax = /^[A-Za-z0-9_-]{39,1015}$/u;
const maxBookmarks = 8;
const maxRequestBytes = 8192;

function parseBookmarks(value: unknown): string[] | null {
  if (
    !isObject(value) ||
    !hasKeys(value, ['version', 'bookmarks']) ||
    value.version !== 1 ||
    !Array.isArray(value.bookmarks) ||
    value.bookmarks.length > maxBookmarks
  ) {
    return null;
  }
  return value.bookmarks.every(
    (bookmark): bookmark is string =>
      typeof bookmark === 'string' && bookmarkSyntax.exec(bookmark)?.[0] === bookmark,
  )
    ? value.bookmarks
    : null;
}

export async function handleRecentNamedDocuments(request: NextRequest) {
  if (process.env.LASH_NAMED_EDIT_PHASE !== 'enabled') return namedEditRouteFailure(404);
  if (
    request.method !== 'POST' ||
    request.nextUrl.pathname !== '/api/documents/recent' ||
    request.nextUrl.search
  ) {
    return namedEditRouteFailure(400);
  }
  let config: ReturnType<typeof loadNamedEditRouteConfig>;
  try {
    config = loadNamedEditRouteConfig();
  } catch {
    return namedEditRouteFailure(503);
  }
  const { worker, siteOrigin, key } = config;
  if (!isTrustedNamedEditRequest(request, siteOrigin)) return namedEditRouteFailure(403);
  if (!isNamedEditJsonRequest(request)) return namedEditRouteFailure(400);

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
  const bookmarks = parseBookmarks(await readNamedEditJson(request, maxRequestBytes, signal));
  if (!bookmarks) return namedEditRouteFailure(400);

  const account = await verifyPassiveRouteAccount(request);
  if (account.status === 'anonymous') return namedEditRouteFailure(401);
  if (account.status === 'refresh-required') {
    return namedEditRouteResponse({ ok: false, error: 'session-refresh-required' }, 409);
  }
  if (account.status !== 'authenticated') return namedEditRouteFailure(503);
  const { principal } = account;

  const roomIds = new Set<string>();
  for (const bookmark of new Set(bookmarks)) {
    const roomId = decryptNamedEditValue(key, 'recent', bookmark, principal.id, siteOrigin);
    if (roomId && NAMED_EDIT_ROOM_ID.exec(roomId)?.[0] === roomId) roomIds.add(roomId);
  }
  const results = await Promise.all(
    Array.from(roomIds, async (id) => ({
      id,
      result: await callNamedEditWorker({
        workerOrigin: worker.workerOrigin,
        controlSecret: worker.controlSecret,
        roomId: id,
        principalId: principal.id,
        operation: 'recent',
        body: { version: 1 },
      }),
    })),
  );
  // An inconclusive reply cannot establish that a room is gone.
  if (results.some(({ result }) => !result.ok && result.status === 503)) {
    return namedEditRouteFailure(503);
  }
  const documents = results.flatMap(({ id, result }) =>
    result.ok ? [{ id, title: result.title }] : [],
  );
  return namedEditRouteResponse({ ok: true, documents });
}
