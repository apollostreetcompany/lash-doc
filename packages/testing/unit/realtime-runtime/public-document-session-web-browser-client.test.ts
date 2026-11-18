import { describe, expect, it, vi } from 'vitest';

import { requestPublicDocumentSession } from '../../../../apps/web/lib/publicDocumentAccess/browserClient';

const ROOM_ID = `doc-v1-${'c'.repeat(64)}`;
const NOW = new Date('2026-07-30T00:00:00.000Z');
const TICKET = `lash-public-ticket.${'f'.repeat(43)}`;
const success = () => ({
  ok: true,
  version: 1,
  authorization: {
    roomId: ROOM_ID,
    mode: 'read',
    policyVersion: 4,
    cutoffGeneration: 2,
  },
  grant: {
    source: 'public',
    capabilities: ['doc.read'],
    protocolVersion: 4,
  },
  socket: {
    url: `wss://worker.example/api/realtime/rooms/${ROOM_ID}/socket?protocolVersion=4&actorId=public-reader-7`,
    protocol: 'lash-realtime-v4',
    ticketProtocol: TICKET,
    expiresAt: '2026-07-30T00:01:00.000Z',
  },
});

describe('public document browser session client', () => {
  it('calls a receiver-sensitive browser fetch without binding the dependency object', async () => {
    const observedReceivers: unknown[] = [];
    const fetcher = vi.fn(function (this: unknown) {
      observedReceivers.push(this);
      if (this !== undefined) throw new TypeError('Illegal invocation');
      return Promise.resolve(Response.json(success()));
    });

    await expect(
      requestPublicDocumentSession(
        {
          roomId: ROOM_ID,
          actorId: 'public-reader-7',
        },
        {
          fetcher: fetcher as never,
          now: () => NOW,
        },
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(observedReceivers).toEqual([undefined]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('posts the exact same-origin body and returns a bound in-memory provider session', async () => {
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(`/api/public/documents/${ROOM_ID}/session`);
      expect(init).toMatchObject({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        body: JSON.stringify({ version: 1, actorId: 'public-reader-7' }),
      });
      expect(new Headers(init.headers).get('content-type')).toBe('application/json');
      return Response.json(success());
    });
    await expect(
      requestPublicDocumentSession(
        {
          roomId: ROOM_ID,
          actorId: 'public-reader-7',
        },
        {
          fetcher: fetcher as never,
          now: () => NOW,
        },
      ),
    ).resolves.toEqual({
      ok: true,
      session: {
        authorization: success().authorization,
        actorId: 'public-reader-7',
        socketUrl: success().socket.url,
        socketProtocol: 'lash-realtime-v4',
        ticketProtocol: TICKET,
      },
    });
  });

  it.each([
    ['room', { authorization: { ...success().authorization, roomId: `doc-v1-${'d'.repeat(64)}` } }],
    ['mode', { authorization: { ...success().authorization, mode: 'edit' } }],
    ['capability', { grant: { ...success().grant, capabilities: ['doc.edit'] } }],
    ['socket protocol', { socket: { ...success().socket, protocol: 'lash-realtime-v3' } }],
    ['ticket', { socket: { ...success().socket, ticketProtocol: 'lash-public-ticket.short' } }],
    [
      'query bearer',
      { socket: { ...success().socket, url: `${success().socket.url}&ticket=${TICKET}` } },
    ],
    ['expiry', { socket: { ...success().socket, expiresAt: NOW.toISOString() } }],
    ['extra key', { title: 'must not arrive before hydration' }],
  ])('denies malformed success %s', async (_label, mutation) => {
    await expect(
      requestPublicDocumentSession(
        { roomId: ROOM_ID, actorId: 'public-reader-7' },
        {
          fetcher: vi.fn().mockResolvedValue(Response.json({ ...success(), ...mutation })) as never,
          now: () => NOW,
        },
      ),
    ).resolves.toEqual({
      ok: false,
      error: 'document-unavailable',
      retryable: false,
    });
  });

  it('preserves only the exact generic BFF failure vocabulary', async () => {
    await expect(
      requestPublicDocumentSession(
        { roomId: ROOM_ID, actorId: 'public-reader-7' },
        {
          fetcher: vi.fn().mockResolvedValue(
            Response.json(
              {
                ok: false,
                version: 1,
                error: 'document-unavailable',
                retryable: false,
              },
              { status: 404 },
            ),
          ) as never,
          now: () => NOW,
        },
      ),
    ).resolves.toEqual({
      ok: false,
      error: 'document-unavailable',
      retryable: false,
    });
  });
});
