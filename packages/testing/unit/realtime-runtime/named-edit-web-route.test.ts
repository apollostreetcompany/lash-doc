import { createHash, createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  namedEditPath,
  type NamedEditOperation,
} from '../../../../apps/web/lib/namedEdit/contract';
import { handleNamedEdit } from '../../../../apps/web/lib/namedEdit/routeHandler';
import { NextRequest } from '../../../../apps/web/node_modules/next/server.js';
import {
  namedEditFailure,
  namedEditResponse,
  parseNamedEditCommand,
} from '../../../realtime-worker/src/namedEdit';

const auth = vi.hoisted(() => ({ principal: vi.fn() }));
vi.mock('../../../../apps/web/node_modules/server-only/index.js', () => ({}));
vi.mock('../../../../apps/web/lib/auth/serverPrincipal', () => ({
  requireServerAccountPrincipal: auth.principal,
}));
vi.mock('../../../../apps/web/lib/auth/serverClient', () => ({
  createRouteSupabaseClientSession: () => ({
    client: {},
    applyTo: (response: Response) => response,
  }),
}));

const origin = 'https://lash.test';
const workerOrigin = 'https://worker.test';
const roomId = `doc-v1-${'a'.repeat(64)}`;
const owner = `account:v1:${'o'.repeat(43)}`;
const member = `account:v1:${'m'.repeat(43)}`;
const actorId = `named-${'a'.repeat(32)}`;
const inviteId = 'b0a763bd-aced-4ea4-8f28-a1a15548baf8';
const controlSecret = 'local synthetic control key required to exercise HMAC';
const testKey = Buffer.alloc(32, 44).toString('base64url');

const configure = () => {
  vi.stubEnv('LASH_NAMED_EDIT_PHASE', 'enabled');
  vi.stubEnv('LASH_NAMED_EDIT_KEY', testKey);
  vi.stubEnv('LASH_REALTIME_WORKER_HTTP_URL', workerOrigin);
  vi.stubEnv('LASH_WORKER_CONTROL_SECRET_CURRENT', controlSecret);
  vi.stubEnv('LASH_DOCUMENT_ID_DERIVATION_KEYS', `v1:${testKey}`);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://auth.test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'synthetic-publishable-key');
  vi.stubEnv('LASH_SITE_ORIGIN', origin);
};

const post = (operation: NamedEditOperation, body: Record<string, unknown>, cookie?: string) =>
  handleNamedEdit(
    new NextRequest(origin + namedEditPath(roomId, operation), {
      method: 'POST',
      headers: {
        host: 'lash.test',
        origin,
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({ version: 1, ...body }),
    }),
    roomId,
    operation,
  );

describe('named edit browser and Worker contract', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    auth.principal.mockReset();
  });

  it('fails closed when the phase is disabled and refuses browser-supplied grant fields', async () => {
    configure();
    const worker = vi.fn();
    vi.stubGlobal('fetch', worker);
    vi.stubEnv('LASH_NAMED_EDIT_PHASE', 'disabled');
    expect((await post('list', {})).status).toBe(404);
    vi.stubEnv('LASH_NAMED_EDIT_PHASE', 'enabled');
    expect(
      (await post('issue', { email: 'editor@example.test', inviteId, role: 'edit' })).status,
    ).toBe(400);
    expect((await post('session', { token: null, email: 'editor@example.test' })).status).toBe(400);
    expect(auth.principal).not.toHaveBeenCalled();
    expect(worker).not.toHaveBeenCalled();
  });

  it('makes a disabled Worker terminal for named sessions and keeps transient failures retryable', async () => {
    configure();
    auth.principal.mockResolvedValue({ id: member, email: 'member@example.test' });
    const worker = vi.fn()
      .mockResolvedValueOnce(namedEditResponse(namedEditFailure('named-edit-disabled')))
      .mockResolvedValueOnce(namedEditResponse(namedEditFailure('internal-error')));
    vi.stubGlobal('fetch', worker);

    const disabled = await post('session', { token: null });
    expect(disabled.status).toBe(404);
    expect(await disabled.json()).toEqual({ ok: false, version: 1, error: 'unavailable' });

    const unavailable = await post('session', { token: null });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({
      ok: false,
      version: 1,
      error: 'temporarily-unavailable',
    });
  });

  it('classifies a malformed successful Worker grant without returning its contents', async () => {
    configure();
    auth.principal.mockResolvedValue({ id: member, email: 'member@example.test' });
    const worker = vi.fn()
      .mockResolvedValueOnce(Response.json({
        ok: true,
        version: 1,
        session: { roomId: `doc-v1-${'b'.repeat(64)}`, ticketProtocol: 'synthetic-opaque-value' },
      }))
      .mockResolvedValueOnce(new Response('unexpected upstream payload', { status: 200 }))
      .mockResolvedValueOnce(namedEditResponse(namedEditFailure('unauthorized')))
      .mockResolvedValueOnce(namedEditResponse(namedEditFailure('invalid-request')))
      .mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"ok":true,'));
          controller.error(new TypeError('Connection reset'));
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', worker);

    for (let attempt = 0; attempt < 4; attempt++) {
      const invalid = await post('session', { token: null });
      expect(invalid.status).toBe(502);
      expect(await invalid.json()).toEqual({ ok: false, version: 1, error: 'invalid-response' });
    }
    expect((await post('session', { token: null })).status).toBe(503);
  });

  it('commits only encrypted email and a hash to Worker, then carries the raw token only in a continuation cookie', async () => {
    configure();
    const email = 'recipient@example.test';
    let invitedDigest: string | null = null;
    let invitedTokenHash: string | null = null;
    const worker = vi.fn(async (url: string, request: RequestInit) => {
      const path = new URL(url).pathname;
      const headers = new Headers(request.headers);
      const operation = path.split('/').at(-1) as NamedEditOperation;
      const raw = String(request.body);
      const bodyHash = createHash('sha256').update(raw).digest('base64url');
      expect(headers.get('x-lash-control-body-sha256')).toBe(bodyHash);
      const signed = [
        'lash-worker-control:v2',
        'POST',
        path,
        bodyHash,
        headers.get('x-lash-control-request-id'),
        headers.get('x-lash-control-principal-id'),
        headers.get('x-lash-control-expires-at'),
      ].join('\n');
      expect(headers.get('authorization')).toBe(
        `Lash-Control v2:${createHmac('sha256', controlSecret).update(signed).digest('base64url')}`,
      );
      expect(raw).not.toContain(email);
      const command = parseNamedEditCommand(operation, JSON.parse(raw));
      if (command?.action === 'issue') {
        expect(headers.get('x-lash-control-principal-id')).toBe(owner);
        invitedDigest = command.emailDigest;
        invitedTokenHash = command.tokenHash;
        return namedEditResponse({
          ok: true,
          version: 1,
          invite: {
            inviteId,
            emailCiphertext: command.emailCiphertext,
            role: 'edit',
            status: 'pending',
            expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          },
        });
      }
      expect(command?.action).toBe('session');
      if (command?.action === 'session' && command.tokenHash) {
        expect(command.tokenHash).toBe(invitedTokenHash);
        expect(command.emailDigest).toBe(invitedDigest);
      }
      expect(headers.get('x-lash-control-principal-id')).toBe(member);
      return namedEditResponse({
        ok: true,
        version: 1,
        session: {
          roomId,
          actorId,
          source: 'named',
          role: 'edit',
          protocolVersion: 5,
          capabilities: ['doc.read', 'doc.edit'],
          socketProtocol: 'lash-realtime-v5',
          ticketProtocol: `lash-named-ticket.${'t'.repeat(43)}`,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      });
    });
    vi.stubGlobal('fetch', worker);
    auth.principal.mockResolvedValue({ id: owner, email: 'owner@example.test' });
    const issued = await post('issue', { email, inviteId });
    const issueBody = await issued.json();
    expect(issued.status).toBe(200);
    expect(issueBody).toMatchObject({ ok: true, version: 1, invite: { email, inviteId } });
    const token: string = issueBody.token;
    expect(token).toHaveLength(43);
    expect(worker.mock.calls[0]?.[1].body).not.toContain(token);

    auth.principal.mockRejectedValue({ code: 'verified-account-required' });
    const pending = await post('session', { accept: true, token });
    expect(pending.status).toBe(401);
    expect(await pending.json()).toEqual({ ok: false, version: 1, error: 'sign-in-required' });
    const cookie = pending.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain(`Path=${namedEditPath(roomId, 'session')}`);
    expect(cookie).not.toContain(token);
    expect(worker).toHaveBeenCalledTimes(1);

    const cookiePair = cookie.split(';')[0];
    auth.principal.mockResolvedValue({ id: member, email: ' Recipient@EXAMPLE.test ' });
    const accepted = await post('session', { accept: true, token: null }, cookiePair);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ ok: true, version: 1 });
    expect(accepted.headers.get('set-cookie')).toContain('Max-Age=0');

    const reopened = await post('session', { token: null }, cookiePair);
    expect(reopened.status).toBe(200);
    expect(JSON.parse(String(worker.mock.calls.at(-1)?.[1].body))).toEqual({
      browserOrigin: origin,
      emailDigest: null,
      tokenHash: null,
      version: 1,
    });
    expect(await reopened.json()).toMatchObject({
      ok: true,
      version: 1,
      session: {
        roomId,
        actorId,
        socketUrl: `wss://worker.test/api/realtime/rooms/${roomId}/socket?protocolVersion=5&actorId=${actorId}`,
      },
    });
  });
});
