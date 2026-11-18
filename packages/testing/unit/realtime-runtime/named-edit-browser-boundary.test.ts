import { describe, expect, it, vi } from 'vitest';

import { requestNamedEditSession } from '../../../../apps/web/lib/namedEdit/browserClient';

const roomId = `doc-v1-${'a'.repeat(64)}`;
const actorId = `named-${'a'.repeat(32)}`;

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
            socketUrl: `wss://worker.test/api/realtime/rooms/${unexpectedRoom}/socket?protocolVersion=5&actorId=${actorId}&token=unexpected`,
          },
        }),
      );
      await expect(
        requestNamedEditSession(roomId, new AbortController().signal, fetcher),
      ).resolves.toEqual({
        ok: false,
        retryable: true,
      });
    }
  });
});
