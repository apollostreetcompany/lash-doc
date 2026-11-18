import { canonicalize } from '@lash/types';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  callWorkerOwnerSession,
  type OwnerSessionManagementRequestV1,
} from '../../../../apps/web/lib/documentOwnerSession/workerClient';

const PRINCIPAL_ID = `account:v1:${'a'.repeat(43)}`;
const CLAIM_ID = `claim-v1-${'b'.repeat(64)}`;
const ROOM_ID = `doc-v1-${'c'.repeat(64)}`;
const ALIASED_ROOM_ID = `doc-v0-${'d'.repeat(64)}`;
const SNAPSHOT_SHA256 = 'e'.repeat(43);
const SECRET = 'current-control-secret-with-at-least-32-bytes';
const NOW = new Date('2026-07-30T00:00:00.000Z');
const EXPIRES_AT = '2026-07-30T00:01:00.000Z';
const TICKET_PROTOCOL = `lash-ticket.${'f'.repeat(43)}`;

const managementRequest = (): OwnerSessionManagementRequestV1 => ({
  version: 1,
  claimId: CLAIM_ID,
  ownerPrincipalId: PRINCIPAL_ID,
  localDocumentId: 'weekly-plan',
  actorId: 'writer-1',
  protocolVersion: 3,
});

const success = (roomId = ROOM_ID) => ({
  ok: true as const,
  version: 1 as const,
  claimId: CLAIM_ID,
  roomId,
  ownerPrincipalId: PRINCIPAL_ID,
  promotionSnapshotSha256: SNAPSHOT_SHA256,
  grant: {
    source: 'owner' as const,
    capabilities: ['doc.read', 'doc.edit'] as const,
    aclVersion: 1,
    protocolVersion: 3 as const,
  },
  socket: {
    path: `/api/realtime/rooms/${roomId}/socket?protocolVersion=3&actorId=writer-1`,
    ticket: TICKET_PROTOCOL,
    expiresAt: EXPIRES_AT,
  },
});

const call = (
  response: Response,
  overrides: Partial<{
    fetchImpl: typeof fetch;
    now: () => Date;
    randomUUID: () => string;
    timeoutMs: number;
  }> = {},
) =>
  callWorkerOwnerSession(
    {
      workerOrigin: 'https://worker.example',
      controlSecret: SECRET,
      request: managementRequest(),
    },
    {
      fetchImpl: vi.fn().mockResolvedValue(response),
      now: () => NOW,
      randomUUID,
      ...overrides,
    },
  );

describe('Worker owner-session client', () => {
  it('signs the exact canonical v2 management request and sends no browser credentials', async () => {
    const requestId = randomUUID();
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      const pathname = new URL(url).pathname;
      const rawBody = String(init.body);
      const headers = new Headers(init.headers);
      const bodySha256 = createHash('sha256').update(rawBody).digest('base64url');
      const expectedSignature = createHmac('sha256', SECRET)
        .update(
          [
            'lash-worker-control:v2',
            'POST',
            pathname,
            bodySha256,
            requestId,
            PRINCIPAL_ID,
            headers.get('x-lash-control-expires-at'),
          ].join('\n'),
        )
        .digest('base64url');

      expect(pathname).toBe(`/api/management/document-claims/${CLAIM_ID}/owner-session`);
      expect(rawBody).toBe(canonicalize(managementRequest()));
      expect(headers.get('authorization')).toBe(`Lash-Control v2:${expectedSignature}`);
      expect(headers.get('x-lash-control-body-sha256')).toBe(bodySha256);
      expect(headers.get('x-lash-control-principal-id')).toBe(PRINCIPAL_ID);
      expect(headers.get('x-lash-control-request-id')).toBe(requestId);
      expect(init.credentials).toBe('omit');
      expect(init.redirect).toBe('manual');
      expect(init.cache).toBe('no-store');
      return new Response(JSON.stringify(success()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const result = await callWorkerOwnerSession(
      {
        workerOrigin: 'https://worker.example',
        controlSecret: SECRET,
        request: managementRequest(),
      },
      {
        fetchImpl: fetchImpl as never,
        now: () => NOW,
        randomUUID: () => requestId,
      },
    );

    expect(result).toEqual({ kind: 'verified', result: success() });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('accepts an immutable aliased room independently of the current derivation ring', async () => {
    await expect(
      call(
        new Response(JSON.stringify(success(ALIASED_ROOM_ID)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ).resolves.toEqual({ kind: 'verified', result: success(ALIASED_ROOM_ID) });
  });

  it.each([
    ['claim', { claimId: `claim-v1-${'0'.repeat(64)}` }],
    ['principal', { ownerPrincipalId: `account:v1:${'z'.repeat(43)}` }],
    ['snapshot', { promotionSnapshotSha256: 'z'.repeat(42) }],
    ['room', { roomId: `doc-v01-${'c'.repeat(64)}` }],
    ['ACL', { grant: { ...success().grant, aclVersion: 2 } }],
    ['capability order', { grant: { ...success().grant, capabilities: ['doc.edit', 'doc.read'] } }],
    [
      'capability excess',
      { grant: { ...success().grant, capabilities: ['doc.read', 'doc.edit', 'doc.share'] } },
    ],
    ['protocol', { grant: { ...success().grant, protocolVersion: 2 } }],
    [
      'socket path',
      {
        socket: {
          ...success().socket,
          path: `/api/realtime/rooms/${ROOM_ID}/socket?actorId=writer-1&protocolVersion=3`,
        },
      },
    ],
    ['ticket', { socket: { ...success().socket, ticket: 'lash-ticket.short' } }],
    [
      'ticket in URL',
      {
        socket: { ...success().socket, path: `${success().socket.path}&ticket=${TICKET_PROTOCOL}` },
      },
    ],
    ['expired ticket', { socket: { ...success().socket, expiresAt: NOW.toISOString() } }],
    [
      'overlong ticket TTL',
      { socket: { ...success().socket, expiresAt: '2026-07-30T00:01:01.000Z' } },
    ],
    ['unknown key', { email: 'private@example.com' }],
  ])('rejects a success with a wrong %s', async (_label, mutation) => {
    await expect(
      call(
        new Response(JSON.stringify({ ...success(), ...mutation }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ).resolves.toEqual({ kind: 'unverified-failure' });
  });

  it.each([
    [404, 'claim-not-found', false],
    [409, 'claim-conflict', false],
    [409, 'owner-mismatch', false],
    [409, 'not-shareable', false],
    [500, 'readback-failed', true],
    [500, 'internal-error', true],
    [400, 'invalid-request', false],
    [401, 'unauthorized', false],
    [503, 'promotion-disabled', false],
  ] as const)('accepts exact %i/%s Worker failure', async (status, error, retryable) => {
    const result = { ok: false as const, version: 1 as const, error, retryable };
    await expect(
      call(
        new Response(JSON.stringify(result), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ).resolves.toEqual({ kind: 'verified', result });
  });

  it('classifies only an actual timeout as a retryable transport timeout', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );
    await expect(
      callWorkerOwnerSession(
        {
          workerOrigin: 'https://worker.example',
          controlSecret: SECRET,
          request: managementRequest(),
        },
        {
          fetchImpl: fetchImpl as never,
          now: () => NOW,
          randomUUID,
          timeoutMs: 1,
        },
      ),
    ).resolves.toEqual({ kind: 'timeout' });

    await expect(
      callWorkerOwnerSession(
        {
          workerOrigin: 'https://worker.example',
          controlSecret: SECRET,
          request: managementRequest(),
        },
        {
          fetchImpl: vi.fn().mockRejectedValue(new Error('network failed')),
          now: () => NOW,
          randomUUID,
        },
      ),
    ).resolves.toEqual({ kind: 'unverified-failure' });
  });

  it.each([
    ['redirect', new Response(null, { status: 302 })],
    ['wrong media type', new Response(JSON.stringify(success()), { status: 200 })],
    [
      'malformed JSON',
      new Response('{"ok":', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ],
    [
      'wrong status/result pair',
      new Response(JSON.stringify(success()), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    ],
  ])('rejects an unverified %s response', async (_label, response) => {
    await expect(call(response)).resolves.toEqual({ kind: 'unverified-failure' });
  });
});
