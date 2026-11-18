import { describe, expect, it, vi } from 'vitest';

import { callWorkerOwnerSession } from '../../../../apps/web/lib/documentOwnerSession/workerClient';
import { deriveDocumentClaimId } from '../../../realtime-worker/src/documentClaim';
import { MANAGEMENT_ASSERTION_DOMAIN_V2 } from '../../../realtime-worker/src/managementAuth';
import {
  OWNER_REALTIME_PROTOCOL_VERSION,
  OWNER_SOCKET_PROTOCOL,
} from '../../../realtime-worker/src/ownerSession';
import { sha256Base64Url } from '../../../realtime-worker/src/promotion';
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

const SECRET = 'current-control-secret-with-at-least-32-bytes';
const PRINCIPAL = `account:v1:${'a'.repeat(43)}`;
const LOCAL_DOCUMENT_ID = 'doc-alpha';
const CLAIM_ID = 'claim-v1-9d05c49f61f58ffa69b8c098851879494c21aea1988e336055c1f646e9ad5543';
const ROOM_ID = `doc-v1-${'a'.repeat(64)}`;
const ACTOR_ID = 'owner-one';
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const SNAPSHOT_SHA = 's'.repeat(43);
const TICKET = `lash-ticket.${'t'.repeat(43)}`;
const ROUTE_EXPIRES_AT = new Date(Date.now() + 60_000).toISOString();

const base64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
};

const hmac = async (secret: string, value: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64Url(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))),
  );
};

const managementBody = () => ({
  version: 1 as const,
  claimId: CLAIM_ID,
  ownerPrincipalId: PRINCIPAL,
  localDocumentId: LOCAL_DOCUMENT_ID,
  actorId: ACTOR_ID,
  protocolVersion: OWNER_REALTIME_PROTOCOL_VERSION,
});

const signedRequest = async (bodyValue: unknown = managementBody()) => {
  const path = `/api/management/document-claims/${CLAIM_ID}/owner-session`;
  const body = JSON.stringify(bodyValue);
  const bodySha256 = await sha256Base64Url(new TextEncoder().encode(body));
  const expiresAt = Math.floor(Date.now() / 1000) + 30;
  const canonical = [
    MANAGEMENT_ASSERTION_DOMAIN_V2,
    'POST',
    path,
    bodySha256,
    REQUEST_ID,
    PRINCIPAL,
    String(expiresAt),
  ].join('\n');
  const signature = await hmac(SECRET, canonical);
  return new Request(`https://worker.test${path}`, {
    method: 'POST',
    headers: {
      authorization: `Lash-Control v2:${signature}`,
      'content-type': 'application/json; charset=utf-8',
      'content-encoding': 'identity',
      'x-lash-control-request-id': REQUEST_ID,
      'x-lash-control-principal-id': PRINCIPAL,
      'x-lash-control-expires-at': String(expiresAt),
      'x-lash-control-body-sha256': bodySha256,
    },
    body,
  });
};

const ownerSuccess = (expiresAt = ROUTE_EXPIRES_AT) => ({
  ok: true as const,
  version: 1 as const,
  claimId: CLAIM_ID,
  roomId: ROOM_ID,
  ownerPrincipalId: PRINCIPAL,
  promotionSnapshotSha256: SNAPSHOT_SHA,
  grant: {
    source: 'owner' as const,
    capabilities: ['doc.read', 'doc.edit'] as const,
    aclVersion: 1,
    protocolVersion: 3 as const,
  },
  socket: {
    path: `/api/realtime/rooms/${ROOM_ID}/socket?protocolVersion=3&actorId=${ACTOR_ID}`,
    ticket: TICKET,
    expiresAt,
  },
});

describe('owner-session Worker routes', () => {
  it('recognizes only the exact canonical claim owner-session route', () => {
    const path = `/api/management/document-claims/${CLAIM_ID}/owner-session`;
    expect(parseRealtimeRoute(new URL(`https://worker.test${path}`))).toEqual({
      kind: 'management-document-claim-owner-session',
      claimId: CLAIM_ID,
    });
    for (const invalid of [`${path}/`, path.replace('claim-v1-', 'CLAIM-V1-')]) {
      expect(parseRealtimeRoute(new URL(`https://worker.test${invalid}`))).toEqual({
        kind: 'not-found',
      });
    }
  });

  it('authenticates and forwards an exact private owner-session command', async () => {
    await expect(deriveDocumentClaimId(PRINCIPAL, LOCAL_DOCUMENT_ID)).resolves.toBe(CLAIM_ID);
    const claimFetch = vi.fn(async (request: Request) => {
      expect(new URL(request.url).pathname).toBe('/__lash-document-claim/owner-session');
      expect(new URL(request.url).search).toBe('');
      expect(request.headers.get('x-lash-internal-management')).toBe('owner-session-v1');
      await expect(request.json()).resolves.toEqual({
        version: 1,
        requestId: REQUEST_ID,
        bodySha256: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
        ownerSession: managementBody(),
      });
      return Response.json(ownerSuccess());
    });
    const worker = (await import('../../../realtime-worker/src/index')).default;
    const response = await worker.fetch(await signedRequest(), {
      LASH_SHARE_PHASE: 'enabled',
      LASH_WORKER_CONTROL_SECRET_CURRENT: SECRET,
      LASH_DOCUMENT_CLAIM: { getByName: vi.fn(() => ({ fetch: claimFetch })) },
      LASH_REALTIME_ROOM: { getByName: vi.fn() },
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    await expect(response.json()).resolves.toEqual(ownerSuccess());
    expect(claimFetch).toHaveBeenCalledOnce();
  });

  it('accepts the real Next owner-session client bytes and returns its strictly verified result', async () => {
    const worker = (await import('../../../realtime-worker/src/index')).default;
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 60_000).toISOString();
    const claimFetch = vi.fn(async () => Response.json(ownerSuccess(expiresAt)));
    const environment = {
      LASH_SHARE_PHASE: 'enabled',
      LASH_WORKER_CONTROL_SECRET_CURRENT: SECRET,
      LASH_DOCUMENT_CLAIM: { getByName: vi.fn(() => ({ fetch: claimFetch })) },
      LASH_REALTIME_ROOM: { getByName: vi.fn() },
    } as never;
    const result = await callWorkerOwnerSession(
      {
        workerOrigin: 'https://worker.test',
        controlSecret: SECRET,
        request: managementBody(),
      },
      {
        fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) =>
          worker.fetch(new Request(input, init), environment)) as typeof fetch,
        now: () => issuedAt,
        randomUUID: () => REQUEST_ID,
      },
    );

    expect(result).toEqual({ kind: 'verified', result: ownerSuccess(expiresAt) });
    expect(claimFetch).toHaveBeenCalledOnce();
  });

  it('forwards protocol-v3 owner sockets with no URL bearer and only the ticket subprotocol', async () => {
    const ticketHeader = `${OWNER_SOCKET_PROTOCOL}, ${TICKET}`;
    const roomFetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe('/__lash-room/socket');
      expect([...url.searchParams.entries()]).toEqual([
        ['protocolVersion', '3'],
        ['actorId', ACTOR_ID],
        ['roomId', ROOM_ID],
      ]);
      expect(url.href).not.toMatch(/token|ticket|principal|capabilit/iu);
      expect(request.headers.get('sec-websocket-protocol')).toBe(ticketHeader);
      return {
        status: 101,
        headers: new Headers({ 'sec-websocket-protocol': OWNER_SOCKET_PROTOCOL }),
        body: null,
      } as unknown as Response;
    });
    const worker = (await import('../../../realtime-worker/src/index')).default;
    const response = await worker.fetch(
      new Request(
        `https://worker.test/api/realtime/rooms/${ROOM_ID}/socket?protocolVersion=3&actorId=${ACTOR_ID}`,
        {
          headers: {
            upgrade: 'websocket',
            'sec-websocket-protocol': ticketHeader,
          },
        },
      ),
      {
        LASH_REALTIME_ROOM: { getByName: vi.fn(() => ({ fetch: roomFetch })) },
      } as never,
    );

    expect(response.status).toBe(101);
    expect(response.headers.get('sec-websocket-protocol')).toBe(OWNER_SOCKET_PROTOCOL);
    expect(response.headers.get('sec-websocket-protocol')).not.toContain('lash-ticket.');
    expect(roomFetch).toHaveBeenCalledOnce();
  });

  it('rejects query bearers and malformed owner-session bodies before Durable Object dispatch', async () => {
    const worker = (await import('../../../realtime-worker/src/index')).default;
    const roomFetch = vi.fn();
    const socket = await worker.fetch(
      new Request(
        `https://worker.test/api/realtime/rooms/${ROOM_ID}/socket?protocolVersion=3&actorId=${ACTOR_ID}&accessToken=secret`,
        {
          headers: {
            upgrade: 'websocket',
            'sec-websocket-protocol': `${OWNER_SOCKET_PROTOCOL}, ${TICKET}`,
          },
        },
      ),
      { LASH_REALTIME_ROOM: { getByName: vi.fn(() => ({ fetch: roomFetch })) } } as never,
    );
    expect(socket.status).toBe(403);
    expect(roomFetch).not.toHaveBeenCalled();

    const claimFetch = vi.fn();
    const invalid = await worker.fetch(
      await signedRequest({ ...managementBody(), capabilities: ['doc.read', 'doc.edit'] }),
      {
        LASH_SHARE_PHASE: 'enabled',
        LASH_WORKER_CONTROL_SECRET_CURRENT: SECRET,
        LASH_DOCUMENT_CLAIM: { getByName: vi.fn(() => ({ fetch: claimFetch })) },
        LASH_REALTIME_ROOM: { getByName: vi.fn() },
      } as never,
    );
    expect(invalid.status).toBe(400);
    expect(claimFetch).not.toHaveBeenCalled();
  });
});
