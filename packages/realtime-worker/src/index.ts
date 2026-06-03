import { LashRealtimeRoom } from './room';
import { REALTIME_RUNTIME, parseRealtimeRoute } from './routing';

export { LashRealtimeRoom };
export { REALTIME_RUNTIME, normalizeRoomName, parseRealtimeRoute } from './routing';

const json = (body: unknown, init: ResponseInit = {}) =>
  Response.json(body, {
    ...init,
    headers: {
      'cache-control': 'no-store',
      ...init.headers,
    },
  });

const roomRequest = (request: Request, roomId: string, path: string) => {
  const url = new URL(request.url);
  url.pathname = path;
  url.search = new URLSearchParams({ roomId }).toString();
  return new Request(url, request);
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const route = parseRealtimeRoute(new URL(request.url));

    if (route.kind === 'service-health') {
      return json({
        ok: true,
        runtime: REALTIME_RUNTIME,
        service: 'lash-realtime',
      });
    }

    if (route.kind === 'room-health') {
      const stub = env.LASH_REALTIME_ROOM.getByName(route.roomId);
      return stub.fetch(roomRequest(request, route.roomId, '/__lash-room/health'));
    }

    if (route.kind === 'room-socket') {
      const stub = env.LASH_REALTIME_ROOM.getByName(route.roomId);
      return stub.fetch(roomRequest(request, route.roomId, '/__lash-room/socket'));
    }

    return json({ ok: false, error: 'not_found' }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
