import {
  createDefaultRealtimeGrant,
  createRealtimeSessionToken,
  normalizeActorId,
  verifyRealtimeSessionToken,
  type RealtimeAccessFailure,
  type RealtimeSessionGrant,
} from './access';
import { LashRealtimeRoom } from './room';
import { REALTIME_RUNTIME, parseRealtimeRoute } from './routing';

export { LashRealtimeRoom };
export { REALTIME_RUNTIME, normalizeRoomName, parseRealtimeRoute } from './routing';
export {
  createDefaultRealtimeGrant,
  createRealtimeSessionToken,
  verifyRealtimeSessionToken,
} from './access';

const json = (body: unknown, init: ResponseInit = {}) =>
  Response.json(body, {
    ...init,
    headers: {
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
      ...init.headers,
    },
  });

const withCors = (response: Response) => {
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-headers', 'authorization, content-type');
  headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  headers.set('access-control-allow-origin', '*');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const LOCAL_DEV_SESSION_SECRET = 'lash-local-realtime-development-secret';

const sessionSecret = (env: Env & { LASH_REALTIME_SESSION_SECRET?: string }) =>
  env.LASH_REALTIME_SESSION_SECRET || LOCAL_DEV_SESSION_SECRET;

const accessTokenFor = (request: Request, url: URL) => {
  const header = request.headers.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) {
    return header.slice('bearer '.length).trim();
  }
  return url.searchParams.get('accessToken');
};

const deny = (reason: RealtimeAccessFailure) =>
  json({ ok: false, error: 'forbidden', reason }, { status: 403 });

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
  }).toString();
  return new Request(url, request);
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const route = parseRealtimeRoute(url);
    const secret = sessionSecret(env);

    if (request.method === 'OPTIONS') {
      return json({ ok: true });
    }

    if (route.kind === 'service-health') {
      return json({
        ok: true,
        runtime: REALTIME_RUNTIME,
        service: 'lash-realtime',
      });
    }

    if (route.kind === 'room-session') {
      const actorId = normalizeActorId(url.searchParams.get('actorId'));
      const grant = createDefaultRealtimeGrant(actorId, route.roomId);
      const accessToken = await createRealtimeSessionToken(grant, secret);
      return json({
        ok: true,
        accessToken,
        grant,
      });
    }

    if (route.kind === 'room-health') {
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
      const decision = await verifyRealtimeSessionToken(accessTokenFor(request, url), secret, {
        documentId: route.roomId,
        capability: 'doc.edit',
      });
      if (!decision.ok) return deny(decision.reason);
      const stub = env.LASH_REALTIME_ROOM.getByName(route.roomId);
      return stub.fetch(roomRequest(request, route.roomId, '/__lash-room/socket', decision.grant));
    }

    if (route.kind === 'room-restore') {
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
