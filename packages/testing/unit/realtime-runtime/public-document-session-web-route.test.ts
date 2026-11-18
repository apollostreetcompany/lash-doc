import { describe, expect, it, vi } from 'vitest';

import {
  handlePublicDocumentSession,
  type PublicDocumentSessionRouteDependencies,
} from '../../../../apps/web/lib/publicDocumentAccess/routeHandler';

const ROOM_ID = `doc-v1-${'c'.repeat(64)}`;
const NOW = new Date('2026-07-30T00:00:00.000Z');
const EXPIRES_AT = '2026-07-30T00:01:00.000Z';
const TICKET_PROTOCOL = `lash-public-ticket.${'f'.repeat(43)}`;
const CONFIG = {
  siteOrigin: 'https://lash.example',
  workerOrigin: 'https://worker.example',
  publicControlSecret: 'public-control-secret-with-at-least-32-bytes',
  enabled: true as const,
  rateKey: {
    secret: 'public-rate-key-secret-with-at-least-32-bytes',
    headerName: 'x-forwarded-for' as const,
  },
};

const workerSuccess = {
  ok: true as const,
  version: 1 as const,
  authorization: {
    roomId: ROOM_ID,
    mode: 'comment' as const,
    policyVersion: 4,
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
};

const request = (
  overrides: Partial<{
    url: string;
    method: string;
    body: string;
    headers: Record<string, string>;
  }> = {},
) => {
  const value = new Request(
    overrides.url ?? `https://lash.example/api/public/documents/${ROOM_ID}/session`,
    {
      method: overrides.method ?? 'POST',
      ...((overrides.method ?? 'POST') === 'GET'
        ? {}
        : {
            body: overrides.body ?? JSON.stringify({ version: 1, actorId: 'public-reader-7' }),
          }),
      headers: {
        origin: 'https://lash.example',
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        'x-forwarded-for': '203.0.113.42',
        ...overrides.headers,
      },
    },
  );
  return Object.assign(value, {
    nextUrl: new URL(value.url),
  }) as never;
};

const dependencies = (
  overrides: Partial<PublicDocumentSessionRouteDependencies> = {},
): PublicDocumentSessionRouteDependencies => ({
  loadConfig: () => CONFIG,
  callWorker: vi.fn().mockResolvedValue({ kind: 'verified', result: workerSuccess }),
  now: () => NOW,
  ...overrides,
});

describe('public document session route', () => {
  it('is closed by default and never calls the Worker without exact enablement', async () => {
    const callWorker = vi.fn();
    const response = await handlePublicDocumentSession(
      request(),
      { roomId: ROOM_ID },
      dependencies({
        loadConfig: () => {
          throw new Error('public access disabled');
        },
        callWorker,
      }),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      version: 1,
      error: 'temporarily-unavailable',
      retryable: true,
    });
    expect(callWorker).not.toHaveBeenCalled();
  });

  it('authorizes a signed-out same-origin reader and returns only sanitized protocol-v4 data', async () => {
    const callWorker = vi.fn().mockResolvedValue({ kind: 'verified', result: workerSuccess });
    const response = await handlePublicDocumentSession(
      request(),
      { roomId: ROOM_ID },
      dependencies({
        callWorker,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      version: 1,
      authorization: workerSuccess.authorization,
      grant: workerSuccess.grant,
      socket: {
        url: `wss://worker.example${workerSuccess.socket.path}`,
        protocol: 'lash-realtime-v4',
        ticketProtocol: TICKET_PROTOCOL,
        expiresAt: EXPIRES_AT,
      },
    });
    expect(callWorker).toHaveBeenCalledOnce();
    expect(callWorker.mock.calls[0]?.[0]).toMatchObject({
      workerOrigin: 'https://worker.example',
      publicControlSecret: CONFIG.publicControlSecret,
      request: {
        version: 1,
        roomId: ROOM_ID,
        actorId: 'public-reader-7',
        protocolVersion: 4,
        browserOrigin: 'https://lash.example',
        rateKey: expect.stringMatching(/^rate-v1-[A-Za-z0-9_-]{43}$/u),
      },
    });
    expect(JSON.stringify(callWorker.mock.calls[0]?.[0])).not.toContain('203.0.113.42');
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(response.headers.get('vary')).toBe('Origin');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
    expect(response.headers.has('access-control-allow-origin')).toBe(false);
    expect(response.headers.has('set-cookie')).toBe(false);
  });

  it.each([
    ['query', { url: `https://lash.example/api/public/documents/${ROOM_ID}/session?edit=true` }],
    ['wrong path', { url: `https://lash.example/api/public/documents/${ROOM_ID}/session/` }],
    ['method', { method: 'GET' }],
    ['origin', { headers: { origin: 'https://attacker.example' } }],
    ['fetch site', { headers: { 'sec-fetch-site': 'cross-site' } }],
    ['fetch mode', { headers: { 'sec-fetch-mode': 'navigate' } }],
    ['fetch destination', { headers: { 'sec-fetch-dest': 'document' } }],
    ['media type', { headers: { 'content-type': 'text/plain' } }],
    ['content encoding', { headers: { 'content-encoding': 'gzip' } }],
    [
      'extra body',
      { body: JSON.stringify({ version: 1, actorId: 'public-reader-7', edit: true }) },
    ],
  ])('rejects invalid browser %s before Worker access', async (_label, mutation) => {
    const callWorker = vi.fn();
    const response = await handlePublicDocumentSession(
      request(mutation),
      { roomId: ROOM_ID },
      dependencies({ callWorker }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      version: 1,
      error: 'invalid-request',
      retryable: false,
    });
    expect(callWorker).not.toHaveBeenCalled();
  });

  it.each([
    ['missing header', { 'x-forwarded-for': '' }],
    ['forwarded list', { 'x-forwarded-for': '203.0.113.42, 198.51.100.7' }],
    ['address with port', { 'x-forwarded-for': '203.0.113.42:443' }],
  ])('fails closed when trusted client attribution is %s', async (_label, headerOverrides) => {
    const headers =
      Object.keys(headerOverrides).length === 0
        ? {
            origin: 'https://lash.example',
            'content-type': 'application/json',
            'sec-fetch-site': 'same-origin',
            'sec-fetch-mode': 'cors',
            'sec-fetch-dest': 'empty',
          }
        : headerOverrides;
    const callWorker = vi.fn();
    const response = await handlePublicDocumentSession(
      request({ headers }),
      { roomId: ROOM_ID },
      dependencies({ callWorker }),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'temporarily-unavailable',
      retryable: true,
    });
    expect(callWorker).not.toHaveBeenCalled();
  });

  it.each([
    [
      { ok: false, version: 1, error: 'document-unavailable', retryable: false },
      404,
      'document-unavailable',
      false,
    ],
    [{ ok: false, version: 1, error: 'rate-limited', retryable: true }, 429, 'rate-limited', true],
    [
      { ok: false, version: 1, error: 'unauthorized', retryable: false },
      503,
      'temporarily-unavailable',
      true,
    ],
  ] as const)('sanitizes Worker failure %#', async (result, status, error, retryable) => {
    const response = await handlePublicDocumentSession(
      request(),
      { roomId: ROOM_ID },
      dependencies({
        callWorker: vi.fn().mockResolvedValue({ kind: 'verified', result }),
      }),
    );
    expect(response.status).toBe(status);
    const payload = await response.json();
    expect(payload).toEqual({
      ok: false,
      version: 1,
      error,
      retryable,
    });
    expect(JSON.stringify(payload)).not.toContain('unauthorized');
    if (status === 429) expect(response.headers.get('retry-after')).toBe('60');
  });
});
