import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { createSupabaseResponseMutationSink } from '../../../../apps/web/lib/auth/cookies';
import {
  handleDocumentOwnerSession,
  type DocumentOwnerSessionRouteDependencies,
} from '../../../../apps/web/lib/documentOwnerSession/routeHandler';

vi.mock('../../../../apps/web/lib/auth/serverClient', () => ({
  createRouteSupabaseClientSession: vi.fn(),
}));
vi.mock('../../../../apps/web/lib/auth/serverPrincipal', () => ({
  requireServerAccountPrincipal: vi.fn(),
}));

const PRINCIPAL_ID = `account:v1:${'a'.repeat(43)}`;
const CLAIM_ID = `claim-v1-${'b'.repeat(64)}`;
const ROOM_ID = `doc-v0-${'c'.repeat(64)}`;
const SNAPSHOT_SHA256 = 'd'.repeat(43);
const TICKET_PROTOCOL = `lash-ticket.${'e'.repeat(43)}`;
const provider = {
  issuer: 'https://project.supabase.co/auth/v1',
  publishableKey: 'publishable-key',
  siteOrigin: 'https://lash.example',
  url: 'https://project.supabase.co',
};
const workerConfig = {
  workerOrigin: 'https://worker.example',
  controlSecret: 'current-control-secret-with-at-least-32-bytes',
  derivationKeys: [{ version: 'v1', key: Buffer.alloc(32, 7) }],
};

const workerSuccess = {
  ok: true as const,
  version: 1 as const,
  claimId: CLAIM_ID,
  roomId: ROOM_ID,
  ownerPrincipalId: PRINCIPAL_ID,
  promotionSnapshotSha256: SNAPSHOT_SHA256,
  grant: {
    source: 'owner' as const,
    capabilities: ['doc.read', 'doc.edit'] as const,
    aclVersion: 1,
    protocolVersion: 3 as const,
  },
  socket: {
    path: `/api/realtime/rooms/${ROOM_ID}/socket?protocolVersion=3&actorId=writer-1`,
    ticket: TICKET_PROTOCOL,
    expiresAt: '2026-07-30T00:01:00.000Z',
  },
};

const request = (
  body: unknown = { version: 1, actorId: 'writer-1' },
  options: {
    contentType?: string;
    origin?: string;
    path?: string;
    fetchSite?: string;
    fetchMode?: string;
    fetchDest?: string;
    rawBody?: string;
  } = {},
) => {
  const value = new Request(
    `https://lash.example${options.path ?? '/api/documents/weekly-plan/owner-session'}`,
    {
      method: 'POST',
      headers: {
        'content-type': options.contentType ?? 'application/json',
        host: 'lash.example',
        origin: options.origin ?? 'https://lash.example',
        'sec-fetch-site': options.fetchSite ?? 'same-origin',
        'sec-fetch-mode': options.fetchMode ?? 'cors',
        'sec-fetch-dest': options.fetchDest ?? 'empty',
      },
      body: options.rawBody ?? JSON.stringify(body),
    },
  );
  return Object.assign(value, {
    cookies: { getAll: () => [] },
    nextUrl: new URL(value.url),
  }) as never;
};

const mutationSession = () => {
  const sink = createSupabaseResponseMutationSink({ getAll: () => [] });
  sink.adapter.setAll?.(
    [
      {
        name: 'sb-access',
        value: 'access-value',
        options: { httpOnly: true, path: '/', secure: true, sameSite: 'lax' },
      },
      {
        name: 'sb-refresh',
        value: 'refresh-value',
        options: { httpOnly: true, path: '/', secure: true, sameSite: 'strict' },
      },
    ],
    {
      'set-cookie': 'lash-extra=kept; Path=/; HttpOnly',
      'x-supabase-refresh': 'applied',
    },
  );
  return { client: { auth: {} }, applyTo: sink.applyTo };
};

const dependencies = (
  overrides: Partial<DocumentOwnerSessionRouteDependencies> = {},
): DocumentOwnerSessionRouteDependencies => ({
  createSession: () => mutationSession() as never,
  requireAuthConfig: () => provider,
  requirePrincipal: vi.fn().mockResolvedValue({
    kind: 'account',
    id: PRINCIPAL_ID,
    email: 'private@example.com',
    emailVerifiedAt: '2026-07-30T00:00:00.000Z',
  }),
  loadWorkerConfig: () => workerConfig,
  deriveClaimId: () => CLAIM_ID,
  callWorker: vi.fn().mockResolvedValue({ kind: 'verified', result: workerSuccess }),
  ...overrides,
});

const assertFinalized = (response: Response & { cookies: unknown }) => {
  const setCookie = response.headers.get('set-cookie') ?? '';
  expect(setCookie).toContain('sb-access=access-value');
  expect(setCookie).toContain('sb-refresh=refresh-value');
  expect(setCookie).toContain('lash-extra=kept');
  expect(response.headers.get('x-supabase-refresh')).toBe('applied');
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(response.headers.get('pragma')).toBe('no-cache');
  expect(response.headers.get('vary')).toBe('Cookie, Origin');
  expect(response.headers.getSetCookie()).toHaveLength(3);
};

describe('document owner-session route', () => {
  it('returns only the sanitized owner socket surface and preserves every response mutation', async () => {
    const callWorker = vi.fn().mockResolvedValue({ kind: 'verified', result: workerSuccess });
    const response = await handleDocumentOwnerSession(
      request(),
      { localDocumentId: 'weekly-plan' },
      dependencies({ callWorker }),
    );
    const raw = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(raw)).toEqual({
      ok: true,
      version: 1,
      localDocumentId: 'weekly-plan',
      remoteDocumentId: ROOM_ID,
      promotionSnapshotSha256: SNAPSHOT_SHA256,
      access: {
        source: 'owner',
        capabilities: ['doc.read', 'doc.edit'],
        protocolVersion: 3,
      },
      socket: {
        url: `wss://worker.example${workerSuccess.socket.path}`,
        protocol: 'lash-realtime-v3',
        ticketProtocol: TICKET_PROTOCOL,
        expiresAt: workerSuccess.socket.expiresAt,
      },
    });
    expect(raw).not.toContain(CLAIM_ID);
    expect(raw).not.toContain(PRINCIPAL_ID);
    expect(raw).not.toContain('private@example.com');
    expect(JSON.parse(raw).socket.url).not.toContain(TICKET_PROTOCOL);
    expect(callWorker).toHaveBeenCalledWith({
      workerOrigin: workerConfig.workerOrigin,
      controlSecret: workerConfig.controlSecret,
      request: {
        version: 1,
        claimId: CLAIM_ID,
        ownerPrincipalId: PRINCIPAL_ID,
        localDocumentId: 'weekly-plan',
        actorId: 'writer-1',
        protocolVersion: 3,
      },
    });
    assertFinalized(response as never);
  });

  it.each([
    ['query', request(undefined, { path: '/api/documents/weekly-plan/owner-session?room=x' })],
    ['cross origin', request(undefined, { origin: 'https://evil.example' })],
    ['cross-site metadata', request(undefined, { fetchSite: 'cross-site' })],
    ['navigate mode', request(undefined, { fetchMode: 'navigate' })],
    ['document destination', request(undefined, { fetchDest: 'document' })],
    ['wrong media type', request(undefined, { contentType: 'text/plain' })],
    ['wrong JSON charset', request(undefined, { contentType: 'application/json; charset=latin1' })],
    [
      'extra media parameter',
      request(undefined, { contentType: 'application/json; charset=utf-8; profile=x' }),
    ],
    ['noncanonical path', request(undefined, { path: '/api/documents/-weekly/owner-session' })],
    ['forged room', request({ version: 1, actorId: 'writer-1', roomId: ROOM_ID })],
    ['forged principal', request({ version: 1, actorId: 'writer-1', principalId: PRINCIPAL_ID })],
    ['forged owner', request({ version: 1, actorId: 'writer-1', owner: true })],
    ['forged role', request({ version: 1, actorId: 'writer-1', role: 'owner' })],
    ['forged scope', request({ version: 1, actorId: 'writer-1', scope: 'edit' })],
    [
      'forged capabilities',
      request({ version: 1, actorId: 'writer-1', capabilities: ['doc.edit'] }),
    ],
  ])('rejects $label before contacting authority', async (_label, invalidRequest) => {
    const callWorker = vi.fn();
    const response = await handleDocumentOwnerSession(
      invalidRequest,
      {
        localDocumentId: invalidRequest.nextUrl.pathname.includes('-weekly')
          ? '-weekly'
          : 'weekly-plan',
      },
      dependencies({ callWorker }),
    );

    expect(response.status).toBe(
      invalidRequest.headers.get('origin') === 'https://evil.example' ? 403 : 400,
    );
    expect(await response.json()).toEqual({
      ok: false,
      version: 1,
      error: 'invalid-request',
      retryable: false,
    });
    expect(callWorker).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('vary')).toBe('Cookie, Origin');
  });

  it('finalizes refreshed cookies on an invalid body after session creation', async () => {
    const callWorker = vi.fn();
    const response = await handleDocumentOwnerSession(
      request({ version: 1, actorId: 'writer-1', capabilities: ['doc.edit'] }),
      { localDocumentId: 'weekly-plan' },
      dependencies({ callWorker }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      version: 1,
      error: 'invalid-request',
      retryable: false,
    });
    expect(callWorker).not.toHaveBeenCalled();
    assertFinalized(response as never);
  });

  it('bounds the streamed browser body before contacting authority', async () => {
    const callWorker = vi.fn();
    const response = await handleDocumentOwnerSession(
      request(undefined, { rawBody: ' '.repeat(513) }),
      { localDocumentId: 'weekly-plan' },
      dependencies({ callWorker }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      version: 1,
      error: 'invalid-request',
      retryable: false,
    });
    expect(callWorker).not.toHaveBeenCalled();
    assertFinalized(response as never);
  });

  it.each([
    [
      'invalid account',
      Object.assign(new Error('invalid'), { code: 'account-session-invalid' }),
      401,
      'unauthenticated',
      false,
    ],
    [
      'provider timeout',
      Object.assign(new Error('unavailable'), { code: 'auth-provider-unavailable' }),
      503,
      'temporarily-unavailable',
      true,
    ],
  ] as const)(
    'finalizes every cookie/header mutation for $label',
    async (_label, error, status, expectedError, retryable) => {
      const response = await handleDocumentOwnerSession(
        request(),
        { localDocumentId: 'weekly-plan' },
        dependencies({ requirePrincipal: vi.fn().mockRejectedValue(error) }),
      );

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({
        ok: false,
        version: 1,
        error: expectedError,
        retryable,
      });
      assertFinalized(response as never);
    },
  );

  it.each([
    [
      'provider configuration',
      {
        requireAuthConfig: () => {
          throw new Error('missing config');
        },
      },
    ],
    [
      'session construction',
      {
        createSession: () => {
          throw new Error('session unavailable');
        },
      },
    ],
  ])('does not label an unverified $label failure retryable', async (_label, overrides) => {
    const response = await handleDocumentOwnerSession(
      request(),
      { localDocumentId: 'weekly-plan' },
      dependencies(overrides),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      version: 1,
      error: 'document-unavailable',
      retryable: false,
    });
  });

  it.each(['invalid-request', 'unauthorized', 'promotion-disabled'] as const)(
    'keeps an exact Worker boundary %s terminal and redacted',
    async (error) => {
      const response = await handleDocumentOwnerSession(
        request(),
        { localDocumentId: 'weekly-plan' },
        dependencies({
          callWorker: vi.fn().mockResolvedValue({
            kind: 'verified',
            result: { ok: false, version: 1, error, retryable: false },
          }),
        }),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        ok: false,
        version: 1,
        error: 'document-unavailable',
        retryable: false,
      });
      assertFinalized(response as never);
    },
  );

  it.each([
    ['claim-not-found', false, 'document-unavailable', 404],
    ['claim-conflict', false, 'document-unavailable', 404],
    ['owner-mismatch', false, 'document-unavailable', 404],
    ['not-shareable', false, 'document-unavailable', 404],
    ['readback-failed', true, 'temporarily-unavailable', 503],
    ['internal-error', true, 'temporarily-unavailable', 503],
  ] as const)(
    'collapses verified Worker $error without leaking authority detail',
    async (error, retryable, expectedError, status) => {
      const response = await handleDocumentOwnerSession(
        request(),
        { localDocumentId: 'weekly-plan' },
        dependencies({
          callWorker: vi.fn().mockResolvedValue({
            kind: 'verified',
            result: { ok: false, version: 1, error, retryable },
          }),
        }),
      );

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({
        ok: false,
        version: 1,
        error: expectedError,
        retryable,
      });
      assertFinalized(response as never);
    },
  );

  it.each([
    ['timeout', { kind: 'timeout' }, 'temporarily-unavailable', true],
    ['unverified response', { kind: 'unverified-failure' }, 'document-unavailable', false],
  ] as const)(
    'classifies a Worker $label without retrying unverified failures',
    async (_label, outcome, error, retryable) => {
      const response = await handleDocumentOwnerSession(
        request(),
        { localDocumentId: 'weekly-plan' },
        dependencies({ callWorker: vi.fn().mockResolvedValue(outcome) }),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        ok: false,
        version: 1,
        error,
        retryable,
      });
      assertFinalized(response as never);
    },
  );

  it('keeps the Next route export surface exact', () => {
    const source = readFileSync(
      new URL(
        '../../../../apps/web/app/api/documents/[localDocumentId]/owner-session/route.ts',
        import.meta.url,
      ),
      'utf8',
    );
    const exports = [...source.matchAll(/^export\s+(?:async\s+)?(?:const|function)\s+(\w+)/gmu)]
      .map((match) => match[1])
      .sort();
    expect(exports).toEqual(['POST', 'dynamic']);
  });
});
