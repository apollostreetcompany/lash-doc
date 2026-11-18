import { describe, expect, it, vi } from 'vitest';

import {
  createDefaultRealtimeGrant,
  createRealtimeGrantFromInviteToken,
  createRealtimeGrantForScope,
  createRealtimeSessionToken,
  realtimeCapabilitiesForScope,
  verifyRealtimeInviteToken,
  verifyRealtimeSessionToken,
} from '../../../realtime-worker/src/access';
import { parseRealtimeRoute } from '../../../realtime-worker/src/routing';
import {
  createAuditLog,
  createMemoryRevocationStore,
  createShareSigner,
  createStaticPolicyStore,
} from '../../../share/src';
import { createDocumentId } from '../../../types/src';

const secret = 'unit-test-secret';
const inviteSecret = 'unit-test-invite-secret';
const now = '2026-06-03T17:45:00.000Z';
const redactionPolicy = {
  sha: 'unit-redaction-policy',
  version: 1,
  rules: [{ path: 'spans.text', action: 'redact' as const }],
};

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    protected readonly ctx: unknown;

    constructor(ctx: unknown) {
      this.ctx = ctx;
    }
  },
}));

const createInvite = async (
  scope: 'view' | 'comment' | 'suggest' | 'edit',
  expiresAt: string | null = '2026-06-03T18:45:00.000Z',
) => {
  const signer = createShareSigner({
    secret: inviteSecret,
    revocations: createMemoryRevocationStore(),
    policies: createStaticPolicyStore(redactionPolicy),
    audit: createAuditLog({ adapter: 'memory' }),
    now: () => now,
  });
  return signer.sign({
    docId: createDocumentId('doc-alpha'),
    scope,
    expiresAt,
    issuedBy: 'owner',
    redactionPolicy: redactionPolicy.sha,
    redactionPolicyVersion: redactionPolicy.version,
  });
};

describe('realtime actor access boundary', () => {
  const workerRequest = async (
    request: Request,
    options: {
      sessionSecret?: string;
      inviteSecret?: string;
      getByName?: ReturnType<typeof vi.fn>;
    } = {},
  ) => {
    const worker = (await import('../../../realtime-worker/src/index')).default;
    const getByName = options.getByName ?? vi.fn();
    const response = await worker.fetch(request, {
      LASH_REALTIME_ROOM: { getByName },
      ...(options.sessionSecret ? { LASH_REALTIME_SESSION_SECRET: options.sessionSecret } : {}),
      ...(options.inviteSecret ? { LASH_REALTIME_INVITE_SECRET: options.inviteSecret } : {}),
    } as never);
    return { getByName, response };
  };

  it('fails closed at the actual handler for every configured invite scope', async () => {
    for (const scope of ['view', 'comment', 'suggest', 'edit'] as const) {
      const invite = await createInvite(scope, null);
      const getByName = vi.fn();
      const { response } = await workerRequest(
        new Request('https://realtime.example.com/api/realtime/rooms/doc-alpha/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ actorId: 'Invited Editor', inviteToken: invite.token }),
        }),
        {
          sessionSecret: secret,
          inviteSecret,
          getByName,
        },
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: 'invite-authority-unavailable',
        retryable: false,
      });
      expect(getByName).not.toHaveBeenCalled();
    }

    const malformed = await workerRequest(
      new Request('https://realtime.example.com/api/realtime/rooms/doc-alpha/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          actorId: 'Invited Editor',
          inviteToken: 'malformed-private-invite',
        }),
      }),
      {
        sessionSecret: secret,
        inviteSecret,
      },
    );
    expect(malformed.response.status).toBe(503);
    await expect(malformed.response.json()).resolves.toEqual({
      ok: false,
      error: 'invite-authority-unavailable',
      retryable: false,
    });
    expect(malformed.getByName).not.toHaveBeenCalled();
  });

  it('accepts only the exact bounded POST session body for the loopback fixture', async () => {
    const { response } = await workerRequest(
      new Request('http://127.0.0.1:8788/api/realtime/rooms/doc-alpha/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ actorId: 'Loopback Owner', inviteToken: null }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      protocolVersion: 2,
      grant: {
        actorId: 'loopback-owner',
        documentId: 'doc-alpha',
        capabilities: ['doc.read', 'doc.edit'],
        protocolVersion: 2,
      },
    });

    const extraKey = await workerRequest(
      new Request('http://127.0.0.1:8788/api/realtime/rooms/doc-alpha/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actorId: 'Loopback Owner', inviteToken: null, admin: true }),
      }),
    );
    expect(extraKey.response.status).toBe(400);
  });

  it('allows the browser session POST cache-control header in CORS preflight', async () => {
    const { response } = await workerRequest(
      new Request('http://127.0.0.1:8788/api/realtime/rooms/doc-alpha/session', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://private-bearer.example',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'cache-control, content-type, x-private-bearer-token',
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    expect(response.headers.get('access-control-allow-headers')).toBe(
      'authorization, cache-control, content-type',
    );
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect([...response.headers.entries()].flat().join(' ')).not.toContain('private-bearer');
    expect(await response.text()).not.toContain('private-bearer');
  });

  it('rejects malformed or oversized POST bodies without reflecting input', async () => {
    const cases = [
      {
        request: new Request('http://127.0.0.1:8788/api/realtime/rooms/doc-alpha/session', {
          method: 'POST',
          headers: { 'content-type': 'text/plain' },
          body: '{"actorId":"private-actor","inviteToken":null}',
        }),
        status: 415,
      },
      {
        request: new Request('http://127.0.0.1:8788/api/realtime/rooms/doc-alpha/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{"actorId":"private-actor"',
        }),
        status: 400,
      },
      {
        request: new Request('http://127.0.0.1:8788/api/realtime/rooms/doc-alpha/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ actorId: 'private-actor' }),
        }),
        status: 400,
      },
      {
        request: new Request('http://127.0.0.1:8788/api/realtime/rooms/doc-alpha/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ actorId: 'private-actor', inviteToken: '' }),
        }),
        status: 400,
      },
      {
        request: new Request('http://127.0.0.1:8788/api/realtime/rooms/doc-alpha/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            actorId: 'private-actor',
            inviteToken: 'private-token'.repeat(1_400),
          }),
        }),
        status: 413,
      },
    ];

    for (const testCase of cases) {
      const { response } = await workerRequest(testCase.request);
      expect(response.status).toBe(testCase.status);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      const text = await response.text();
      expect(text).not.toContain('private-actor');
      expect(text).not.toContain('private-token');
    }
  });

  it('exchanges loopback invite POSTs while retaining no-token GET compatibility', async () => {
    const invite = await createInvite('view', null);
    const inviteResponse = await workerRequest(
      new Request('http://localhost:8788/api/realtime/rooms/doc-alpha/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actorId: 'Readonly Invitee', inviteToken: invite.token }),
      }),
      { inviteSecret },
    );
    expect(inviteResponse.response.status).toBe(200);
    await expect(inviteResponse.response.json()).resolves.toMatchObject({
      ok: true,
      protocolVersion: 2,
      grant: {
        actorId: 'readonly-invitee',
        documentId: 'doc-alpha',
        scope: 'view',
        capabilities: ['doc.read'],
        protocolVersion: 2,
      },
    });

    const compatibility = await workerRequest(
      new Request(
        'http://127.0.0.1:8788/api/realtime/rooms/doc-alpha/session?actorId=Legacy%20Owner',
      ),
    );
    expect(compatibility.response.status).toBe(200);
    await expect(compatibility.response.json()).resolves.toMatchObject({
      ok: true,
      protocolVersion: 2,
      grant: { actorId: 'legacy-owner', protocolVersion: 2 },
    });
  });

  it('rejects invite-bearing GET exchange without reflecting the bearer', async () => {
    const invite = await createInvite('edit', null);
    const url = new URL('http://127.0.0.1:8788/api/realtime/rooms/doc-alpha/session');
    url.searchParams.set('actorId', 'legacy-invitee');
    url.searchParams.set('inviteToken', invite.token);

    const { response } = await workerRequest(new Request(url));
    expect(response.status).toBe(405);
    expect(await response.text()).not.toContain(invite.token);
  });

  it('rejects every POST query parameter without reflecting bearer-shaped values', async () => {
    const sentinel = 'post-query-private-invite';
    const { getByName, response } = await workerRequest(
      new Request(
        `http://127.0.0.1:8788/api/realtime/rooms/doc-alpha/session?inviteToken=${sentinel}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ actorId: 'Loopback Owner', inviteToken: null }),
        },
      ),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).not.toContain(sentinel);
    expect(getByName).not.toHaveBeenCalled();
  });

  it('requires protocol v2 before forwarding a socket to the Durable Object', async () => {
    const grant = createDefaultRealtimeGrant('actor-a', 'doc-alpha', new Date());
    const accessToken = await createRealtimeSessionToken(grant, secret);
    const stubFetch = vi.fn(async () => Response.json({ ok: true }));
    const getByName = vi.fn(() => ({ fetch: stubFetch }));

    const missingVersion = await workerRequest(
      new Request(
        `http://127.0.0.1:8788/api/realtime/rooms/doc-alpha/socket?accessToken=${encodeURIComponent(accessToken)}`,
        { headers: { upgrade: 'websocket' } },
      ),
      { sessionSecret: secret, getByName },
    );
    expect(missingVersion.response.status).toBe(409);
    expect(getByName).not.toHaveBeenCalled();

    const accepted = await workerRequest(
      new Request(
        `http://127.0.0.1:8788/api/realtime/rooms/doc-alpha/socket?accessToken=${encodeURIComponent(accessToken)}&protocolVersion=2`,
        { headers: { upgrade: 'websocket' } },
      ),
      { sessionSecret: secret, getByName },
    );
    expect(accepted.response.status).toBe(200);
    expect(getByName).toHaveBeenCalledOnce();
    expect(stubFetch).toHaveBeenCalledOnce();
    const forwarded = stubFetch.mock.calls[0]?.[0] as Request;
    const forwardedUrl = new URL(forwarded.url);
    expect(forwardedUrl.searchParams.get('protocolVersion')).toBe('2');
    expect(forwardedUrl.searchParams.has('accessToken')).toBe(false);
  });

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
        protocolVersion: 2,
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
        protocolVersion: 2,
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
        protocolVersion: 2,
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

  it('maps invite scopes to realtime grants without over-granting view links', async () => {
    expect(realtimeCapabilitiesForScope('view')).toEqual(['doc.read']);
    expect(realtimeCapabilitiesForScope('comment')).toEqual(['doc.read']);
    expect(realtimeCapabilitiesForScope('suggest')).toEqual(['doc.read']);
    expect(realtimeCapabilitiesForScope('edit')).toEqual(['doc.read', 'doc.edit']);

    const grant = createRealtimeGrantForScope(
      'Grace Editor',
      'doc-alpha',
      'view',
      new Date('2026-06-03T17:45:00.000Z'),
    );
    expect(grant).toMatchObject({
      actorId: 'grace-editor',
      documentId: 'doc-alpha',
      scope: 'view',
      capabilities: ['doc.read'],
    });

    const token = await createRealtimeSessionToken(grant, secret);
    await expect(
      verifyRealtimeSessionToken(token, secret, {
        documentId: 'doc-alpha',
        capability: 'doc.read',
        now,
      }),
    ).resolves.toMatchObject({ ok: true, grant: expect.objectContaining({ scope: 'view' }) });
    await expect(
      verifyRealtimeSessionToken(token, secret, {
        documentId: 'doc-alpha',
        capability: 'doc.edit',
        now,
      }),
    ).resolves.toEqual({ ok: false, reason: 'scope-mismatch' });
  });

  it('exchanges a valid invite token for a scope-matched realtime grant', async () => {
    const invite = await createInvite('edit');

    await expect(
      verifyRealtimeInviteToken(invite.token, inviteSecret, {
        documentId: 'doc-alpha',
        now,
      }),
    ).resolves.toMatchObject({
      ok: true,
      token: expect.objectContaining({ docId: 'doc-alpha', scope: 'edit' }),
    });

    await expect(
      createRealtimeGrantFromInviteToken(
        'Invited Editor',
        'doc-alpha',
        invite.token,
        inviteSecret,
        {
          now,
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      grant: expect.objectContaining({
        actorId: 'invited-editor',
        documentId: 'doc-alpha',
        scope: 'edit',
        capabilities: ['doc.read', 'doc.edit'],
      }),
    });
  });

  it('lets view invite grants open read-scoped sockets without granting edit updates', async () => {
    const invite = await createInvite('view');
    const decision = await createRealtimeGrantFromInviteToken(
      'Readonly Reader',
      'doc-alpha',
      invite.token,
      inviteSecret,
      { now },
    );

    expect(decision).toMatchObject({
      ok: true,
      grant: expect.objectContaining({
        actorId: 'readonly-reader',
        documentId: 'doc-alpha',
        scope: 'view',
        capabilities: ['doc.read'],
      }),
    });
    if (!decision.ok) return;

    const token = await createRealtimeSessionToken(decision.grant, secret);
    await expect(
      verifyRealtimeSessionToken(token, secret, {
        documentId: 'doc-alpha',
        capability: 'doc.read',
        now,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      verifyRealtimeSessionToken(token, secret, {
        documentId: 'doc-alpha',
        capability: 'doc.edit',
        now,
      }),
    ).resolves.toEqual({ ok: false, reason: 'scope-mismatch' });
  });

  it('denies invalid, expired, revoked, and wrong-document invite exchanges', async () => {
    const invite = await createInvite('comment');
    const expired = await createInvite('edit', '2026-06-03T17:00:00.000Z');

    await expect(
      createRealtimeGrantFromInviteToken(
        'Invited Editor',
        'doc-alpha',
        `${invite.token.slice(0, -2)}xx`,
        inviteSecret,
        { now },
      ),
    ).resolves.toEqual({ ok: false, reason: 'invalid' });

    await expect(
      createRealtimeGrantFromInviteToken(
        'Invited Editor',
        'doc-alpha',
        expired.token,
        inviteSecret,
        { now },
      ),
    ).resolves.toEqual({ ok: false, reason: 'expired' });

    await expect(
      createRealtimeGrantFromInviteToken(
        'Invited Editor',
        'doc-alpha',
        invite.token,
        inviteSecret,
        {
          now,
          isRevoked: (jti) => jti === invite.jti,
        },
      ),
    ).resolves.toEqual({ ok: false, reason: 'revoked' });

    await expect(
      createRealtimeGrantFromInviteToken('Invited Editor', 'doc-beta', invite.token, inviteSecret, {
        now,
      }),
    ).resolves.toEqual({ ok: false, reason: 'document-mismatch' });
  });
});
