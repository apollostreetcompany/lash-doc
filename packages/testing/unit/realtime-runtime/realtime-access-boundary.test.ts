import { describe, expect, it } from 'vitest';

import {
  createRealtimeSessionToken,
  verifyRealtimeSessionToken,
} from '../../../realtime-worker/src/access';
import { parseRealtimeRoute } from '../../../realtime-worker/src/routing';

const secret = 'unit-test-secret';
const now = '2026-06-03T17:45:00.000Z';

describe('realtime actor access boundary', () => {
  it('parses the room session endpoint without exposing room access', () => {
    expect(
      parseRealtimeRoute(new URL('https://lash.test/api/realtime/rooms/Doc Alpha/session')),
    ).toEqual({
      kind: 'room-session',
      roomId: 'doc-alpha',
    });
  });

  it('accepts only signed actor grants for the matching document and capability', async () => {
    const token = await createRealtimeSessionToken(
      {
        actorId: 'actor-a',
        documentId: 'doc-alpha',
        capabilities: ['doc.read', 'doc.edit'],
        issuedAt: now,
        expiresAt: '2026-06-03T18:45:00.000Z',
      },
      secret,
    );

    await expect(
      verifyRealtimeSessionToken(token, secret, {
        documentId: 'doc-alpha',
        capability: 'doc.edit',
        now,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        grant: expect.objectContaining({ actorId: 'actor-a', documentId: 'doc-alpha' }),
      }),
    );

    await expect(
      verifyRealtimeSessionToken(token, secret, {
        documentId: 'doc-beta',
        capability: 'doc.edit',
        now,
      }),
    ).resolves.toEqual({ ok: false, reason: 'document-mismatch' });

    await expect(
      verifyRealtimeSessionToken(`${token.slice(0, -2)}xx`, secret, {
        documentId: 'doc-alpha',
        capability: 'doc.edit',
        now,
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid' });
  });

  it('denies expired grants and grants without the required capability', async () => {
    const readOnly = await createRealtimeSessionToken(
      {
        actorId: 'actor-readonly',
        documentId: 'doc-alpha',
        capabilities: ['doc.read'],
        issuedAt: now,
        expiresAt: '2026-06-03T18:45:00.000Z',
      },
      secret,
    );
    const expired = await createRealtimeSessionToken(
      {
        actorId: 'actor-expired',
        documentId: 'doc-alpha',
        capabilities: ['doc.read', 'doc.edit'],
        issuedAt: '2026-06-03T16:00:00.000Z',
        expiresAt: '2026-06-03T17:00:00.000Z',
      },
      secret,
    );

    await expect(
      verifyRealtimeSessionToken(readOnly, secret, {
        documentId: 'doc-alpha',
        capability: 'doc.edit',
        now,
      }),
    ).resolves.toEqual({ ok: false, reason: 'scope-mismatch' });

    await expect(
      verifyRealtimeSessionToken(expired, secret, {
        documentId: 'doc-alpha',
        capability: 'doc.edit',
        now,
      }),
    ).resolves.toEqual({ ok: false, reason: 'expired' });
  });
});
