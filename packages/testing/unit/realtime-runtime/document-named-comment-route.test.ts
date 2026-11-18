import { describe, expect, it, vi } from 'vitest';

import realtimeWorker from '../../../realtime-worker/src/index';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {},
}));

const roomId = `doc-v1-${'a'.repeat(64)}`;
const actorId = `named-${'c'.repeat(32)}`;
const origin = 'https://lash.example.test';
const bearer = 'd'.repeat(43);
const commentProtocols = `lash-realtime-v6, lash-named-comment-ticket.${bearer}`;
const editProtocols = `lash-realtime-v5, lash-named-ticket.${bearer}`;

const socketRequest = (protocols: string, query: string) =>
  new Request(`https://worker.example.test/api/realtime/rooms/${roomId}/socket?${query}`, {
    headers: {
      'sec-websocket-protocol': protocols,
      origin,
      upgrade: 'websocket',
    },
  });

const makeWorker = (commentPhase: 'enabled' | 'disabled') => {
  const forward = vi.fn(
    async (request: Request) =>
      ({
        status: 101,
        headers: new Headers({
          'sec-websocket-protocol':
            request.headers.get('sec-websocket-protocol')?.split(',')[0] ?? '',
        }),
      }) as Response,
  );
  const getByName = vi.fn(() => ({ fetch: forward }));
  const env = {
    LASH_REALTIME_ROOM: { getByName },
    LASH_SHARE_PHASE: 'enabled',
    LASH_NAMED_EDIT_PHASE: 'enabled',
    LASH_NAMED_COMMENT_PHASE: commentPhase,
  } as unknown as Parameters<typeof realtimeWorker.fetch>[1];
  return {
    forward,
    getByName,
    fetch: (request: Request) => realtimeWorker.fetch(request, env),
  };
};

describe('named Comment socket front door', () => {
  it('forwards the v6 credential binding and keeps the v5 socket route compatible', async () => {
    const worker = makeWorker('enabled');
    for (const [version, protocols] of [
      [5, editProtocols],
      [6, commentProtocols],
    ] as const) {
      const response = await worker.fetch(
        socketRequest(protocols, `protocolVersion=${version}&actorId=${actorId}`),
      );
      expect(response.status).toBe(101);
      const request = worker.forward.mock.lastCall?.[0];
      expect(request?.url).toBe(
        `https://worker.example.test/__lash-room/socket?protocolVersion=${version}&actorId=${actorId}&roomId=${roomId}`,
      );
      expect(request?.headers.get('origin')).toBe(origin);
      expect(request?.headers.get('sec-websocket-protocol')).toBe(protocols);
    }
    expect(worker.getByName).toHaveBeenCalledTimes(2);
    expect(worker.getByName).toHaveBeenCalledWith(roomId);
  });

  it('refuses a room upgrade without the requested Comment subprotocol', async () => {
    const worker = makeWorker('enabled');
    worker.forward.mockResolvedValueOnce({
      status: 101,
      headers: new Headers({ 'sec-websocket-protocol': 'lash-realtime-v5' }),
    } as Response);
    const response = await worker.fetch(
      socketRequest(commentProtocols, `protocolVersion=6&actorId=${actorId}`),
    );
    expect(response.status).toBe(403);
  });

  it('rejects disabled, cross-role, or over-specified socket requests before reaching the room', async () => {
    const active = makeWorker('enabled');
    const inactive = makeWorker('disabled');
    const v5 = `protocolVersion=5&actorId=${actorId}`;
    const v6 = `protocolVersion=6&actorId=${actorId}`;
    const requests = [
      active.fetch(socketRequest(commentProtocols, v5)),
      active.fetch(socketRequest(editProtocols, v6)),
      active.fetch(socketRequest(commentProtocols, `${v6}&actorId=${actorId}`)),
      inactive.fetch(socketRequest(commentProtocols, v6)),
    ];
    for (const result of await Promise.all(requests)) expect(result.status).toBe(403);
    expect(active.forward).not.toHaveBeenCalled();
    expect(inactive.forward).not.toHaveBeenCalled();
  });
});
