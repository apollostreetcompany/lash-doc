import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import {
  NAMED_EDIT_INVITE_ID,
  NAMED_EDIT_ROOM_ID,
  NAMED_EDIT_TOKEN,
  hasKeys,
  isObject,
  namedEditPath,
  namedEditSocketPath,
  type NamedEditInvite,
  type NamedEditOperation,
} from './contract';
import {
  decryptNamedEditValue,
  encryptNamedEditValue,
  hashNamedEditToken,
  namedEditEmailDigest,
  namedEditInviteToken,
  normalizeNamedEditEmail,
} from './serverCrypto';
import { callNamedEditWorker, readNamedEditJson } from './workerClient';
import { requireSupabaseAuthConfig } from '../auth/config';
import { isTrustedSiteRequest, preventAuthResponseCaching } from '../auth/http';
import { createRouteSupabaseClientSession } from '../auth/serverClient';
import { requireServerAccountPrincipal } from '../auth/serverPrincipal';
import { loadDocumentPromotionConfig } from '../documentPromotion/config';

const pendingCookie = 'lash-named-edit-continuation';
const pendingTtlSeconds = 30 * 60;
const operations = ['issue', 'list', 'revoke', 'session'] as const;

const isOperation = (operation: string): operation is NamedEditOperation =>
  operations.some((known) => known === operation);

const response = (body: Record<string, unknown>, status = 200) => {
  const result = preventAuthResponseCaching(NextResponse.json({ version: 1, ...body }, { status }));
  result.headers.set('vary', 'Cookie, Origin');
  return result;
};

const failure = (status: number) =>
  response(
    {
      ok: false,
      error:
        status === 401
          ? 'sign-in-required'
          : status === 400
            ? 'invalid-request'
            : status === 409
              ? 'conflict'
              : status === 503 || status === 429
                ? 'temporarily-unavailable'
                : 'unavailable',
    },
    status,
  );

type BrowserRequest =
  | { kind: 'issue'; inviteId: string; email: string }
  | { kind: 'list' }
  | { kind: 'revoke'; inviteId: string }
  | { kind: 'session'; accept: boolean; token: string | null };

const parseBrowserRequest = (
  operation: NamedEditOperation,
  value: unknown,
): BrowserRequest | null => {
  if (!isObject(value) || value.version !== 1) return null;
  if (operation === 'list') return hasKeys(value, ['version']) ? { kind: 'list' } : null;
  if (operation === 'session') {
    if (!hasKeys(value, ['version', 'token']) && !hasKeys(value, ['version', 'token', 'accept'])) {
      return null;
    }
    if (Object.hasOwn(value, 'accept') && value.accept !== true) return null;
    if (value.token === null)
      return { kind: 'session', accept: value.accept === true, token: null };
    return value.accept === true &&
      typeof value.token === 'string' &&
      NAMED_EDIT_TOKEN.test(value.token)
      ? { kind: 'session', accept: true, token: value.token }
      : null;
  }
  if (typeof value.inviteId !== 'string' || !NAMED_EDIT_INVITE_ID.test(value.inviteId)) return null;
  if (operation === 'revoke') {
    return hasKeys(value, ['version', 'inviteId'])
      ? { kind: 'revoke', inviteId: value.inviteId }
      : null;
  }
  const email =
    typeof value.email === 'string' &&
    value.email.length <= 512 &&
    hasKeys(value, ['version', 'inviteId', 'email'])
      ? normalizeNamedEditEmail(value.email)
      : null;
  return email ? { kind: 'issue', inviteId: value.inviteId, email } : null;
};

export async function handleNamedEdit(request: NextRequest, roomId: string, operation: string) {
  if (process.env.LASH_NAMED_EDIT_PHASE !== 'enabled') return failure(404);
  if (
    !NAMED_EDIT_ROOM_ID.test(roomId) ||
    !isOperation(operation) ||
    request.nextUrl.pathname !== namedEditPath(roomId, operation) ||
    request.nextUrl.search
  ) {
    return failure(400);
  }

  let worker: ReturnType<typeof loadDocumentPromotionConfig>;
  let siteOrigin: string;
  let key: Buffer;
  try {
    worker = loadDocumentPromotionConfig();
    siteOrigin = requireSupabaseAuthConfig().siteOrigin;
    const rawKey = process.env.LASH_NAMED_EDIT_KEY ?? '';
    key = Buffer.from(rawKey, 'base64url');
    if (key.length < 32 || key.toString('base64url') !== rawKey) return failure(503);
  } catch {
    return failure(503);
  }
  if (
    !isTrustedSiteRequest(request, siteOrigin, { requireOriginHeader: true }) ||
    request.headers.get('sec-fetch-site') !== 'same-origin' ||
    request.headers.get('sec-fetch-mode') !== 'cors' ||
    request.headers.get('sec-fetch-dest') !== 'empty'
  )
    return failure(403);

  if (
    !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(
      request.headers.get('content-type') ?? '',
    ) ||
    request.headers.has('content-encoding')
  )
    return failure(400);
  const parsed = parseBrowserRequest(operation, await readNamedEditJson(request, 2048));
  if (!parsed) return failure(400);

  const cookie = (result: NextResponse, value: string, maxAge: number) => {
    result.cookies.set(pendingCookie, value, {
      httpOnly: true,
      sameSite: 'lax',
      secure: siteOrigin.startsWith('https:'),
      path: namedEditPath(roomId, 'session'),
      maxAge,
    });
    return result;
  };
  const cookieBinding = [siteOrigin, roomId];
  const accepting = parsed.kind === 'session' && parsed.accept;
  const preservedToken = () => {
    const stored = request.cookies.get(pendingCookie)?.value ?? '';
    const contents = decryptNamedEditValue(key, 'continuation', stored, ...cookieBinding);
    if (!contents) return null;
    const [token, expiry] = contents.split(' ');
    return NAMED_EDIT_TOKEN.test(token ?? '') && Number(expiry) > Date.now() ? token : null;
  };

  let auth: ReturnType<typeof createRouteSupabaseClientSession>;
  try {
    auth = createRouteSupabaseClientSession(request);
  } catch {
    return failure(503);
  }
  const finalize = (result: NextResponse, clearPending = false) =>
    auth.applyTo(clearPending && accepting ? cookie(result, '', 0) : result);

  let principal: Awaited<ReturnType<typeof requireServerAccountPrincipal>>;
  try {
    principal = await requireServerAccountPrincipal(auth.client);
  } catch (error) {
    const code = isObject(error) ? error.code : undefined;
    if (code !== 'verified-account-required' && code !== 'account-session-invalid') {
      return finalize(failure(503));
    }
    const result = failure(401);
    if (parsed.kind === 'session' && parsed.accept && parsed.token) {
      const expiresAt = Date.now() + pendingTtlSeconds * 1000;
      const encrypted = encryptNamedEditValue(
        key,
        'continuation',
        `${parsed.token} ${expiresAt}`,
        ...cookieBinding,
      );
      cookie(result, encrypted, pendingTtlSeconds);
    }
    return finalize(result);
  }

  const body: Record<string, unknown> = { version: 1 };
  let inviteToken: string | null = null;
  if (parsed.kind === 'issue') {
    inviteToken = namedEditInviteToken(key, roomId, principal.id, parsed.inviteId, parsed.email);
    body.inviteId = parsed.inviteId;
    body.tokenHash = hashNamedEditToken(inviteToken);
    body.emailDigest = namedEditEmailDigest(key, parsed.email);
    body.emailCiphertext =
      'email-v1.' + encryptNamedEditValue(key, 'email', parsed.email, roomId, parsed.inviteId);
  } else if (parsed.kind === 'revoke') {
    body.inviteId = parsed.inviteId;
  } else if (parsed.kind === 'session') {
    const token = parsed.accept ? (parsed.token ?? preservedToken()) : null;
    const email = token ? normalizeNamedEditEmail(principal.email) : null;
    if (parsed.accept && (!token || !email)) return finalize(failure(403), true);
    body.browserOrigin = siteOrigin;
    body.tokenHash = token ? hashNamedEditToken(token) : null;
    body.emailDigest = email ? namedEditEmailDigest(key, email) : null;
  }

  const result = await callNamedEditWorker({
    workerOrigin: worker.workerOrigin,
    controlSecret: worker.controlSecret,
    operation,
    roomId,
    principalId: principal.id,
    body,
  });
  if (!result.ok) return finalize(failure(result.status), result.status === 403);
  if (result.kind === 'session') {
    if (accepting) return finalize(response({ ok: true }), true);
    const socketUrl = new URL(
      namedEditSocketPath(roomId, result.session.actorId),
      worker.workerOrigin,
    );
    socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    return finalize(
      response({ ok: true, session: { ...result.session, socketUrl: socketUrl.href } }),
    );
  }

  const decodeInvite = (
    invite: Omit<NamedEditInvite, 'email'> & { emailCiphertext: string },
  ): NamedEditInvite | null => {
    const { emailCiphertext, ...rest } = invite;
    const email = decryptNamedEditValue(
      key,
      'email',
      emailCiphertext.slice('email-v1.'.length),
      roomId,
      invite.inviteId,
    );
    return email && normalizeNamedEditEmail(email) === email ? { ...rest, email } : null;
  };
  if (result.kind === 'list') {
    const invites = result.invites.map(decodeInvite);
    return finalize(invites.every(Boolean) ? response({ ok: true, invites }) : failure(503));
  }
  const invite = decodeInvite(result.invite);
  if (!invite) return finalize(failure(503));
  if (result.kind === 'issue') {
    if (invite.status !== 'pending' || !inviteToken) return finalize(failure(409));
    return finalize(response({ ok: true, invite, token: inviteToken }));
  }
  return finalize(response({ ok: true, invite }));
}
