import { DurableObject } from 'cloudflare:workers';

import { REALTIME_RUNTIME, normalizeRoomName } from './routing';

const PROTOCOL_VERSION = 1;

type SocketAttachment = {
  actorId: string;
  roomId: string;
  connectedAt: number;
};

type ClientMessage = {
  type?: string;
  requestId?: string;
  payload?: unknown;
  update?: unknown;
};

const json = (body: unknown, init: ResponseInit = {}) =>
  Response.json(body, {
    ...init,
    headers: {
      'cache-control': 'no-store',
      ...init.headers,
    },
  });

const readAttachment = (ws: WebSocket): SocketAttachment => {
  const value = ws.deserializeAttachment() as unknown;
  if (value && typeof value === 'object') {
    const attachment = value as Partial<SocketAttachment>;
    if (
      typeof attachment.actorId === 'string' &&
      typeof attachment.roomId === 'string' &&
      typeof attachment.connectedAt === 'number'
    ) {
      return {
        actorId: attachment.actorId,
        roomId: attachment.roomId,
        connectedAt: attachment.connectedAt,
      };
    }
  }

  return { actorId: 'unknown-actor', roomId: 'unknown-room', connectedAt: Date.now() };
};

const parseClientMessage = (message: string | ArrayBuffer): ClientMessage | null => {
  if (typeof message !== 'string') {
    return { type: 'binary', payload: message.byteLength };
  }

  try {
    const parsed = JSON.parse(message) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as ClientMessage;
  } catch {
    return null;
  }
};

export class LashRealtimeRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const actorId = normalizeRoomName(url.searchParams.get('actorId')) ?? null;
    const roomId = normalizeRoomName(url.searchParams.get('roomId')) ?? 'unknown-room';
    if (!actorId) {
      return json({ ok: false, error: 'forbidden', reason: 'missing-actor' }, { status: 403 });
    }

    if (url.pathname === '/__lash-room/health') {
      return json({
        ok: true,
        actorId,
        roomId,
        runtime: REALTIME_RUNTIME,
        protocolVersion: PROTOCOL_VERSION,
        connections: this.ctx.getWebSockets().length,
      });
    }

    if (url.pathname === '/__lash-room/socket') {
      return this.acceptSocket(request, roomId, actorId);
    }

    return json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = readAttachment(ws);
    const parsed = parseClientMessage(message);
    if (!parsed) {
      ws.send(
        JSON.stringify({
          type: 'error',
          roomId: attachment.roomId,
          code: 'invalid_json',
        }),
      );
      return;
    }

    if (parsed.type === 'ping') {
      ws.send(
        JSON.stringify({
          type: 'pong',
          requestId: parsed.requestId ?? null,
          actorId: attachment.actorId,
          roomId: attachment.roomId,
          protocolVersion: PROTOCOL_VERSION,
          connections: this.ctx.getWebSockets().length,
        }),
      );
      return;
    }

    if (parsed.type === 'broadcast') {
      const payload = JSON.stringify({
        type: 'broadcast',
        actorId: attachment.actorId,
        requestId: parsed.requestId ?? null,
        roomId: attachment.roomId,
        payload: parsed.payload ?? null,
      });
      for (const peer of this.ctx.getWebSockets()) {
        peer.send(payload);
      }
      return;
    }

    if (parsed.type === 'yjs-update') {
      if (typeof parsed.update !== 'string') {
        ws.send(
          JSON.stringify({
            type: 'error',
            roomId: attachment.roomId,
            code: 'invalid_yjs_update',
          }),
        );
        return;
      }
      const payload = JSON.stringify({
        type: 'yjs-update',
        actorId: attachment.actorId,
        roomId: attachment.roomId,
        update: parsed.update,
      });
      for (const peer of this.ctx.getWebSockets()) {
        if (peer !== ws) {
          peer.send(payload);
        }
      }
      return;
    }

    ws.send(
      JSON.stringify({
        type: 'error',
        roomId: attachment.roomId,
        code: 'unknown_message_type',
      }),
    );
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    ws.close(code, reason);
  }

  private acceptSocket(request: Request, roomId: string, actorId: string): Response {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return json({ ok: false, error: 'expected_websocket' }, { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      actorId,
      roomId,
      connectedAt: Date.now(),
    } satisfies SocketAttachment);
    server.send(
      JSON.stringify({
        type: 'room-ready',
        actorId,
        roomId,
        runtime: REALTIME_RUNTIME,
        protocolVersion: PROTOCOL_VERSION,
        connections: this.ctx.getWebSockets().length,
      }),
    );

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
}
