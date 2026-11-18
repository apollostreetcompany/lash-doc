import type { PublicControlSessionSuccessV1 } from '@lash/types';
import { describe, expect, it, vi } from 'vitest';

import { sha256Base64Url } from '../../../realtime-worker/src/promotion';
import {
  PUBLIC_CONTROL_ASSERTION_AUDIENCE,
  PUBLIC_CONTROL_ASSERTION_DOMAIN,
  PUBLIC_CONTROL_ASSERTION_SERVICE,
} from '../../../realtime-worker/src/publicControlAuth';
import { parseRealtimeRoute } from '../../../realtime-worker/src/routing';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    protected readonly ctx: unknown;
    protected readonly env: unknown;

    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const SECRET = 'dedicated-public-control-secret-current-32-bytes';
const ROOM_ID = `doc-v1-${'a'.repeat(64)}`;
const ACTOR_ID = 'public-reader';
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const RATE_KEY = `rate-v1-${'r'.repeat(43)}`;
const BODY = {
  version: 1 as const,
  roomId: ROOM_ID,
  actorId: ACTOR_ID,
  protocolVersion: 4 as const,
  browserOrigin: 'https://lash.example',
  rateKey: RATE_KEY,
};

const SUCCESS: PublicControlSessionSuccessV1 = {
  ok: true,
  version: 1,
  authorization: {
    roomId: ROOM_ID,
    mode: 'read',
    policyVersion: 2,
    cutoffGeneration: 1,
  },
  grant: {
    source: 'public',
    capabilities: ['doc.read'],
    protocolVersion: 4,
  },
  socket: {
    path: `/api/realtime/rooms/${ROOM_ID}/socket?protocolVersion=4&actorId=${ACTOR_ID}`,
    protocol: 'lash-realtime-v4',
    ticketProtocol: `lash-public-ticket.${'t'.repeat(43)}`,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  },
};

const base64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
};

const signedRequest = async (bodyValue: unknown = BODY) => {
  const path = `/api/public-control/documents/${ROOM_ID}/session`;
  const body = JSON.stringify(bodyValue);
  const bodySha256 = await sha256Base64Url(new TextEncoder().encode(body));
  const expiresAt = Math.floor(Date.now() / 1000) + 30;
  const canonical = [
    PUBLIC_CONTROL_ASSERTION_DOMAIN,
    'POST',
    path,
    PUBLIC_CONTROL_ASSERTION_AUDIENCE,
    PUBLIC_CONTROL_ASSERTION_SERVICE,
    bodySha256,
    REQUEST_ID,
    String(expiresAt),
  ].join('\n');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = base64Url(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical))),
  );
  return new Request(`https://worker.test${path}`, {
    method: 'POST',
    headers: {
      authorization: `Lash-Public-Control v1:${signature}`,
      'content-type': 'application/json; charset=utf-8',
      'content-encoding': 'identity',
      'x-lash-control-audience': PUBLIC_CONTROL_ASSERTION_AUDIENCE,
      'x-lash-control-service-id': PUBLIC_CONTROL_ASSERTION_SERVICE,
      'x-lash-control-body-sha256': bodySha256,
      'x-lash-control-request-id': REQUEST_ID,
      'x-lash-control-expires-at': String(expiresAt),
    },
    body,
  });
};

describe('public-control session Worker route', () => {
  it('recognizes only the exact opaque-room public-control route', () => {
    const path = `/api/public-control/documents/${ROOM_ID}/session`;
    expect(parseRealtimeRoute(new URL(`https://worker.test${path}`))).toEqual({
      kind: 'public-control-document-session',
      roomId: ROOM_ID,
    });
    for (const invalid of [`${path}/`, path.replace('doc-v1-', 'DOC-v1-'), `${path}?x=1`]) {
      expect(parseRealtimeRoute(new URL(`https://worker.test${invalid}`))).toEqual({
        kind: 'not-found',
      });
    }
  });

  it('verifies dedicated control and forwards the exact internal command without CORS', async () => {
    const worker = (await import('../../../realtime-worker/src/index')).default;
    const roomFetch = vi.fn(async (request: Request) => {
      expect(new URL(request.url).pathname).toBe('/__lash-room/public-session');
      expect(new URL(request.url).search).toBe('');
      expect(request.headers.get('x-lash-internal-management')).toBe('public-session-v1');
      await expect(request.json()).resolves.toEqual({
        version: 1,
        requestId: REQUEST_ID,
        bodySha256: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
        publicSession: BODY,
      });
      return Response.json(SUCCESS);
    });
    const response = await worker.fetch(await signedRequest(), {
      LASH_PUBLIC_DOCUMENT_ACCESS_PHASE: 'enabled',
      LASH_WORKER_PUBLIC_CONTROL_SECRET_CURRENT: SECRET,
      LASH_PUBLIC_READ_ROOM_ALLOWLIST: ROOM_ID,
      LASH_REALTIME_ROOM: { getByName: vi.fn(() => ({ fetch: roomFetch })) },
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    await expect(response.json()).resolves.toEqual(SUCCESS);
    expect(roomFetch).toHaveBeenCalledOnce();
  });

  it('rejects edit/capability claims before dispatch and fails closed without dedicated secrets', async () => {
    const worker = (await import('../../../realtime-worker/src/index')).default;
    for (const body of [
      { ...BODY, mode: 'edit' },
      { ...BODY, capabilities: ['doc.edit'] },
    ]) {
      const roomFetch = vi.fn();
      const response = await worker.fetch(await signedRequest(body), {
        LASH_PUBLIC_DOCUMENT_ACCESS_PHASE: 'enabled',
        LASH_WORKER_PUBLIC_CONTROL_SECRET_CURRENT: SECRET,
        LASH_PUBLIC_READ_ROOM_ALLOWLIST: ROOM_ID,
        LASH_REALTIME_ROOM: { getByName: vi.fn(() => ({ fetch: roomFetch })) },
      } as never);
      expect(response.status).toBe(400);
      expect(roomFetch).not.toHaveBeenCalled();
    }

    const unavailable = await worker.fetch(await signedRequest(), {
      LASH_PUBLIC_DOCUMENT_ACCESS_PHASE: 'enabled',
      LASH_REALTIME_ROOM: { getByName: vi.fn() },
    } as never);
    expect(unavailable.status).toBe(401);
  });

  it('forwards only the bearer-free public-v4 socket shape and echoes only the fixed protocol', async () => {
    const ticket = `lash-public-ticket.${'t'.repeat(43)}`;
    const protocols = `lash-realtime-v4, ${ticket}`;
    const roomFetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe('/__lash-room/socket');
      expect([...url.searchParams.entries()]).toEqual([
        ['protocolVersion', '4'],
        ['actorId', ACTOR_ID],
        ['roomId', ROOM_ID],
      ]);
      expect(url.href).not.toMatch(/token|ticket|principal|capabilit/iu);
      expect(request.headers.get('origin')).toBe('https://lash.example');
      expect(request.headers.get('sec-websocket-protocol')).toBe(protocols);
      return {
        status: 101,
        headers: new Headers({ 'sec-websocket-protocol': 'lash-realtime-v4' }),
        body: null,
      } as unknown as Response;
    });
    const worker = (await import('../../../realtime-worker/src/index')).default;
    const response = await worker.fetch(
      new Request(
        `https://worker.test/api/realtime/rooms/${ROOM_ID}/socket?protocolVersion=4&actorId=${ACTOR_ID}`,
        {
          headers: {
            upgrade: 'websocket',
            origin: 'https://lash.example',
            'sec-websocket-protocol': protocols,
          },
        },
      ),
      {
        LASH_REALTIME_ROOM: { getByName: vi.fn(() => ({ fetch: roomFetch })) },
      } as never,
    );

    expect(response.status).toBe(101);
    expect(response.headers.get('sec-websocket-protocol')).toBe('lash-realtime-v4');
    expect(response.headers.get('sec-websocket-protocol')).not.toContain('lash-public-ticket.');
    expect(roomFetch).toHaveBeenCalledOnce();
  });

  it('rejects public-v4 query bearers, authorization, and noncanonical origin before dispatch', async () => {
    const worker = (await import('../../../realtime-worker/src/index')).default;
    const ticket = `lash-public-ticket.${'t'.repeat(43)}`;
    const roomFetch = vi.fn();
    const baseUrl =
      `https://worker.test/api/realtime/rooms/${ROOM_ID}/socket` +
      `?protocolVersion=4&actorId=${ACTOR_ID}`;
    for (const request of [
      new Request(`${baseUrl}&ticket=${ticket}`, {
        headers: {
          upgrade: 'websocket',
          origin: 'https://lash.example',
          'sec-websocket-protocol': `lash-realtime-v4, ${ticket}`,
        },
      }),
      new Request(baseUrl, {
        headers: {
          authorization: 'Bearer account-control-token',
          upgrade: 'websocket',
          origin: 'https://lash.example',
          'sec-websocket-protocol': `lash-realtime-v4, ${ticket}`,
        },
      }),
      new Request(baseUrl, {
        headers: {
          upgrade: 'websocket',
          origin: 'https://lash.example/path',
          'sec-websocket-protocol': `lash-realtime-v4, ${ticket}`,
        },
      }),
    ]) {
      const response = await worker.fetch(request, {
        LASH_REALTIME_ROOM: { getByName: vi.fn(() => ({ fetch: roomFetch })) },
      } as never);
      expect(response.status).toBe(403);
    }
    expect(roomFetch).not.toHaveBeenCalled();
  });
});
