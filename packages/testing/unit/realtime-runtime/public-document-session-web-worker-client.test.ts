import { canonicalize, type PublicControlSessionRequestV1 } from '@lash/types';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { callWorkerPublicSession } from '../../../../apps/web/lib/publicDocumentAccess/workerClient';

const ROOM_ID = `doc-v1-${'c'.repeat(64)}`;
const SECRET = 'public-control-secret-with-at-least-32-bytes';
const NOW = new Date('2026-07-30T00:00:00.000Z');
const EXPIRES_AT = '2026-07-30T00:01:00.000Z';
const TICKET_PROTOCOL = `lash-public-ticket.${'f'.repeat(43)}`;

const controlRequest = (): PublicControlSessionRequestV1 => ({
  version: 1,
  roomId: ROOM_ID,
  actorId: 'public-reader-7',
  protocolVersion: 4,
  browserOrigin: 'https://lash.example',
  rateKey: `rate-v1-${'r'.repeat(43)}`,
});

const success = () => ({
  ok: true as const,
  version: 1 as const,
  authorization: {
    roomId: ROOM_ID,
    mode: 'read' as const,
    policyVersion: 3,
    cutoffGeneration: 2,
  },
  grant: {
    source: 'public' as const,
    capabilities: ['doc.read'] as ['doc.read'],
    protocolVersion: 4 as const,
  },
  socket: {
    path: `/api/realtime/rooms/${ROOM_ID}/socket?protocolVersion=4&actorId=public-reader-7`,
    protocol: 'lash-realtime-v4' as const,
    ticketProtocol: TICKET_PROTOCOL,
    expiresAt: EXPIRES_AT,
  },
});

const response = (value: unknown, status: number) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('public document Worker session client', () => {
  it('signs exact public-control assertion bytes with no principal or browser credentials', async () => {
    const requestId = randomUUID();
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      const pathname = new URL(url).pathname;
      const rawBody = String(init.body);
      const headers = new Headers(init.headers);
      const bodySha256 = createHash('sha256').update(rawBody).digest('base64url');
      const expectedSignature = createHmac('sha256', SECRET)
        .update(
          [
            'lash-worker-public-session:v1',
            'POST',
            pathname,
            'public-read-session-v1',
            'lash-web-bff-v1',
            bodySha256,
            requestId,
            headers.get('x-lash-control-expires-at'),
          ].join('\n'),
        )
        .digest('base64url');

      expect(url).toBe(`https://worker.example${pathname}`);
      expect(pathname).toBe(`/api/public-control/documents/${ROOM_ID}/session`);
      expect(rawBody).toBe(canonicalize(controlRequest()));
      expect(headers.get('authorization')).toBe(`Lash-Public-Control v1:${expectedSignature}`);
      expect(headers.get('x-lash-control-audience')).toBe('public-read-session-v1');
      expect(headers.get('x-lash-control-service-id')).toBe('lash-web-bff-v1');
      expect(headers.get('x-lash-control-body-sha256')).toBe(bodySha256);
      expect(headers.get('x-lash-control-request-id')).toBe(requestId);
      expect(headers.has('x-lash-control-principal-id')).toBe(false);
      expect(init.credentials).toBe('omit');
      expect(init.redirect).toBe('manual');
      expect(init.cache).toBe('no-store');
      return response(success(), 200);
    });

    await expect(
      callWorkerPublicSession(
        {
          workerOrigin: 'https://worker.example',
          publicControlSecret: SECRET,
          request: controlRequest(),
        },
        {
          fetchImpl: fetchImpl as never,
          now: () => NOW,
          randomUUID: () => requestId,
        },
      ),
    ).resolves.toEqual({ kind: 'verified', result: success() });
  });

  it.each([
    ['room', { authorization: { ...success().authorization, roomId: `doc-v1-${'d'.repeat(64)}` } }],
    ['mode', { authorization: { ...success().authorization, mode: 'edit' } }],
    ['policy version', { authorization: { ...success().authorization, policyVersion: 0 } }],
    ['cutoff', { authorization: { ...success().authorization, cutoffGeneration: -1 } }],
    ['capability', { grant: { ...success().grant, capabilities: ['doc.edit'] } }],
    ['protocol', { grant: { ...success().grant, protocolVersion: 3 } }],
    ['socket protocol', { socket: { ...success().socket, protocol: 'lash-realtime-v3' } }],
    ['ticket', { socket: { ...success().socket, ticketProtocol: 'lash-public-ticket.short' } }],
    [
      'query bearer',
      {
        socket: { ...success().socket, path: `${success().socket.path}&ticket=${TICKET_PROTOCOL}` },
      },
    ],
    ['expiry', { socket: { ...success().socket, expiresAt: NOW.toISOString() } }],
    ['unknown key', { email: 'private@example.com' }],
  ])('rejects success with wrong %s', async (_label, mutation) => {
    await expect(
      callWorkerPublicSession(
        {
          workerOrigin: 'https://worker.example',
          publicControlSecret: SECRET,
          request: controlRequest(),
        },
        {
          fetchImpl: vi.fn().mockResolvedValue(response({ ...success(), ...mutation }, 200)),
          now: () => NOW,
          randomUUID,
        },
      ),
    ).resolves.toEqual({ kind: 'unverified-failure' });
  });

  it.each([
    [400, 'invalid-request', false],
    [401, 'unauthorized', false],
    [404, 'document-unavailable', false],
    [409, 'replay-detected', false],
    [409, 'protocol-mismatch', false],
    [429, 'rate-limited', true],
    [500, 'readback-failed', true],
    [500, 'internal-error', true],
  ] as const)('accepts exact %i/%s Worker failure', async (status, error, retryable) => {
    const result = { ok: false as const, version: 1 as const, error, retryable };
    await expect(
      callWorkerPublicSession(
        {
          workerOrigin: 'https://worker.example',
          publicControlSecret: SECRET,
          request: controlRequest(),
        },
        {
          fetchImpl: vi.fn().mockResolvedValue(response(result, status)),
          now: () => NOW,
          randomUUID,
        },
      ),
    ).resolves.toEqual({ kind: 'verified', result });
  });

  it('rejects redirects, malformed responses, and stalled requests', async () => {
    const base = {
      workerOrigin: 'https://worker.example',
      publicControlSecret: SECRET,
      request: controlRequest(),
    };
    const dependencies = {
      now: () => NOW,
      randomUUID,
    };
    await expect(
      callWorkerPublicSession(base, {
        ...dependencies,
        fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 302 })),
      }),
    ).resolves.toEqual({ kind: 'unverified-failure' });
    await expect(
      callWorkerPublicSession(base, {
        ...dependencies,
        fetchImpl: vi.fn().mockResolvedValue(new Response('not-json', { status: 200 })),
      }),
    ).resolves.toEqual({ kind: 'unverified-failure' });

    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );
    await expect(
      callWorkerPublicSession(base, {
        ...dependencies,
        fetchImpl: fetchImpl as never,
        timeoutMs: 1,
      }),
    ).resolves.toEqual({ kind: 'timeout' });
  });
});
