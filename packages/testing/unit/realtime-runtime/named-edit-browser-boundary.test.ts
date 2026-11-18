import { describe, expect, it, vi } from 'vitest';

import {
  requestNamedEditOwner,
  requestNamedEditSession,
} from '../../../../apps/web/lib/namedEdit/browserClient';

const roomId = `doc-v1-${'a'.repeat(64)}`;
const actorId = `named-${'a'.repeat(32)}`;
const inviteId = 'b0a763bd-aced-4ea4-8f28-a1a15548baf8';

const commentSession = () => ({
  roomId,
  actorId,
  source: 'named',
  role: 'comment',
  protocolVersion: 6,
  capabilities: ['doc.read', 'doc.comment', 'doc.suggest'],
  socketProtocol: 'lash-realtime-v6',
  ticketProtocol: `lash-named-comment-ticket.${'f'.repeat(43)}`,
  expiresAt: new Date(Date.now() + 20_000).toISOString(),
  socketUrl: `wss://worker.test/api/realtime/rooms/${roomId}/socket?protocolVersion=6&actorId=${actorId}`,
});

describe('named editor account session', () => {
  it('uses cookies and no incoming bearer when reopening the canonical document', async () => {
    const session = {
      roomId,
      actorId,
      source: 'named',
      role: 'edit',
      protocolVersion: 5,
      capabilities: ['doc.read', 'doc.edit'],
      socketProtocol: 'lash-realtime-v5',
      ticketProtocol: `lash-named-ticket.${'f'.repeat(43)}`,
      expiresAt: new Date(Date.now() + 20_000).toISOString(),
      socketUrl: `wss://worker.test/api/realtime/rooms/${roomId}/socket?protocolVersion=5&actorId=${actorId}`,
    };
    const fetcher = vi.fn(function (this: unknown) {
      expect(this).toBeUndefined();
      return Promise.resolve(Response.json({ ok: true, version: 1, session }));
    });
    await expect(
      requestNamedEditSession(roomId, new AbortController().signal, fetcher),
    ).resolves.toEqual({
      ok: true,
      session,
    });
    expect(fetcher).toHaveBeenCalledWith(
      `/api/documents/${roomId}/named-edit/session`,
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({ version: 1, token: null }),
      }),
    );
  });

  it('fails closed on a ticket for another room or a browser-visible bearer URI', async () => {
    for (const unexpectedRoom of [roomId, `doc-v1-${'b'.repeat(64)}`]) {
      const fetcher = vi.fn(async () =>
        Response.json({
          ok: true,
          version: 1,
          session: {
            roomId: unexpectedRoom,
            actorId,
            source: 'named',
            role: 'edit',
            protocolVersion: 5,
            capabilities: ['doc.read', 'doc.edit'],
            socketProtocol: 'lash-realtime-v5',
            ticketProtocol: `lash-named-ticket.${'f'.repeat(43)}`,
            expiresAt: new Date(Date.now() + 20_000).toISOString(),
            socketUrl: `wss://worker.test/api/realtime/rooms/${unexpectedRoom}/socket?protocolVersion=5&actorId=${actorId}${
              unexpectedRoom === roomId ? '&token=unexpected' : ''
            }`,
          },
        }),
      );
      await expect(
        requestNamedEditSession(roomId, new AbortController().signal, fetcher),
      ).resolves.toEqual({
        ok: false,
        retryable: false,
        protocolInvalid: true,
      });
    }
  });

  it('distinguishes an invalid successful response from HTTP or network unavailability', async () => {
    const request = (fetcher: typeof fetch) =>
      requestNamedEditSession(roomId, new AbortController().signal, fetcher);
    for (const fetcher of [
      async () => new Response('invalid JSON', { status: 200 }),
      async () => Response.json({
        ok: false, version: 1, error: 'invalid-response',
      }, { status: 502 }),
    ]) {
      await expect(request(fetcher)).resolves.toEqual({
        ok: false,
        retryable: false,
        protocolInvalid: true,
      });
    }
    for (const fetcher of [
      async () => new Response('upstream unavailable', { status: 502 }),
      async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"ok":true,'));
          controller.error(new TypeError('Connection reset'));
        },
      }), { status: 200 }),
      async () => Response.json({ ok: false, version: 1, error: 'temporarily-unavailable' }, {
        status: 503,
      }),
      async () => { throw new TypeError('Network unavailable'); },
    ]) {
      await expect(request(fetcher)).resolves.toEqual({ ok: false, retryable: true });
    }
  });

  it('accepts only the exact signed Comment capability and socket combination', async () => {
    const session = commentSession();
    const open = (value: unknown) =>
      requestNamedEditSession(roomId, new AbortController().signal, async () =>
        Response.json({ ok: true, version: 1, session: value }),
      );
    await expect(open(session)).resolves.toEqual({ ok: true, session });
    for (const mixed of [
      { ...session, role: 'edit' },
      { ...session, capabilities: ['doc.read', 'doc.edit'] },
      { ...session, capabilities: [...session.capabilities, 'doc.edit'] },
      { ...session, socketProtocol: 'lash-realtime-v5' },
      { ...session, ticketProtocol: `lash-named-ticket.${'f'.repeat(43)}` },
      {
        ...session,
        socketUrl: session.socketUrl.replace('protocolVersion=6', 'protocolVersion=5'),
      },
      { ...session, socketUrl: `${session.socketUrl}&token=unexpected` },
      { ...session, email: 'address@example.test' },
    ]) {
      await expect(open(mixed)).resolves.toEqual({
        ok: false,
        retryable: false,
        protocolInvalid: true,
      });
    }
  });

  it('does not return an Edit invite after a Comment issue request', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        ok: true,
        version: 1,
        invite: {
          inviteId,
          email: 'recipient@example.test',
          role: 'edit',
          status: 'pending',
          expiresAt: new Date(Date.now() + 20_000).toISOString(),
        },
        token: 'f'.repeat(43),
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    try {
      await expect(
        requestNamedEditOwner(
          roomId,
          'issue',
          {
            inviteId,
            email: 'recipient@example.test',
            role: 'comment',
          },
          new AbortController().signal,
        ),
      ).resolves.toEqual({ ok: false, reason: 'retry' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
