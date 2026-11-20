import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import {
  NAMED_EDIT_INVITE_ID,
  NAMED_EDIT_ROOM_ID,
  NAMED_EDIT_TOKEN,
  hasKeys,
  isNamedInviteRole,
  isObject,
  namedEditPath,
  namedEditSocketPath,
  type NamedEditInvite,
  type NamedEditOperation,
  type NamedInviteRole,
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
              : status === 502
                ? 'invalid-response'
                : status === 503 || status === 429
                  ? 'temporarily-unavailable'
                  : 'unavailable',
    },
    status,
  );

export { response as namedEditRouteResponse, failure as namedEditRouteFailure };

export function loadNamedEditRouteConfig() {
  const worker = loadDocumentPromotionConfig();
  const siteOrigin = requireSupabaseAuthConfig().siteOrigin;
  const rawKey = process.env.LASH_NAMED_EDIT_KEY ?? '';
  const key = Buffer.from(rawKey, 'base64url');
  if (key.length < 32 || key.toString('base64url') !== rawKey) {
    throw new Error('Invalid named edit key');
  }
  return { worker, siteOrigin, key };
}

export const isTrustedNamedEditRequest = (request: NextRequest, siteOrigin: string) =>
  isTrustedSiteRequest(request, siteOrigin, { requireOriginHeader: true }) &&
  request.headers.get('sec-fetch-site') === 'same-origin' &&
  request.headers.get('sec-fetch-mode') === 'cors' &&
  request.headers.get('sec-fetch-dest') === 'empty';

export const isNamedEditJsonRequest = (request: NextRequest) =>
  /^application\/json(?:;\s*charset=utf-8)?$/iu.test(request.headers.get('content-type') ?? '') &&
  !request.headers.has('content-encoding');

type BrowserRequest =
  | { kind: 'issue'; inviteId: string; email: string; role: NamedInviteRole }
  | { kind: 'list'; includeComment: boolean }
  | { kind: 'revoke'; inviteId: string; role: NamedInviteRole }
  | { kind: 'session'; accept: boolean; token: string | null };

const parseBrowserRequest = (
  operation: NamedEditOperation,
  value: unknown,
): BrowserRequest | null => {
  if (!isObject(value) || value.version !== 1) return null;
  if (operation === 'list') {
    if (hasKeys(value, ['version'])) return { kind: 'list', includeComment: false };
    return hasKeys(value, ['version', 'includeComment']) && value.includeComment === true
      ? { kind: 'list', includeComment: true }
      : null;
  }
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
  const roleField = Object.hasOwn(value, 'role') ? ['role'] : [];
  const role = roleField.length ? value.role : 'edit';
  if (!isNamedInviteRole(role)) return null;
  if (operation === 'revoke') {
    return hasKeys(value, ['version', 'inviteId', ...roleField])
      ? { kind: 'revoke', inviteId: value.inviteId, role }
      : null;
  }
  if (
    !hasKeys(value, ['version', 'inviteId', 'email', ...roleField]) ||
    typeof value.email !== 'string' ||
    value.email.length > 512
  )
    return null;
  const email = normalizeNamedEditEmail(value.email);
  return email ? { kind: 'issue', inviteId: value.inviteId, email, role } : null;
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

  let config: ReturnType<typeof loadNamedEditRouteConfig>;
  try {
    config = loadNamedEditRouteConfig();
  } catch {
    return failure(503);
  }
  const { worker, siteOrigin, key } = config;
  if (!isTrustedNamedEditRequest(request, siteOrigin)) return failure(403);
  if (!isNamedEditJsonRequest(request)) return failure(400);
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
  const commentInvitesEnabled = process.env.LASH_NAMED_COMMENT_PHASE === 'enabled';
  let inviteToken: string | null = null;
  if (parsed.kind === 'issue') {
    if (parsed.role === 'comment') {
      if (!commentInvitesEnabled) {
        return finalize(response({ ok: false, error: 'named-comment-disabled' }, 503));
      }
      body.role = parsed.role;
    }
    inviteToken = namedEditInviteToken(key, roomId, principal.id, parsed.inviteId, parsed.email);
    body.inviteId = parsed.inviteId;
    body.tokenHash = hashNamedEditToken(inviteToken);
    body.emailDigest = namedEditEmailDigest(key, parsed.email);
    body.emailCiphertext =
      'email-v1.' + encryptNamedEditValue(key, 'email', parsed.email, roomId, parsed.inviteId);
  } else if (parsed.kind === 'revoke') {
    body.inviteId = parsed.inviteId;
    if (parsed.role === 'comment') body.role = parsed.role;
  } else if (parsed.kind === 'list') {
    if (parsed.includeComment) body.includeComment = true;
  } else if (parsed.kind === 'session') {
    const token = parsed.accept ? (parsed.token ?? preservedToken()) : null;
    const email = token ? normalizeNamedEditEmail(principal.email) : null;
    if (parsed.accept && (!token || !email)) return finalize(failure(403), true);
    body.browserOrigin = siteOrigin;
    body.tokenHash = token ? hashNamedEditToken(token) : null;
    body.emailDigest = email ? namedEditEmailDigest(key, email) : null;
  }

  const workerRequest = {
    workerOrigin: worker.workerOrigin,
    controlSecret: worker.controlSecret,
    operation,
    roomId,
    principalId: principal.id,
    body,
  };
  let result = await callNamedEditWorker(workerRequest);
  const legacyList = parsed.kind === 'list' && !result.ok && result.status === 400;
  if (legacyList) {
    result = await callNamedEditWorker({ ...workerRequest, body: { version: 1 } });
  }
  if (!result.ok) {
    if (result.commentError) {
      if (parsed.kind === 'issue' && parsed.role === 'comment') {
        return finalize(response({ ok: false, error: result.commentError }, result.status));
      }
      return finalize(failure(403), true);
    }
    return finalize(failure(result.status), result.status === 403);
  }
  if (result.kind === 'session') {
    if (accepting) return finalize(response({ ok: true }), true);
    const socketUrl = new URL(
      namedEditSocketPath(roomId, result.session.actorId, result.session.protocolVersion),
      worker.workerOrigin,
    );
    socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const sessionResponse = response({
      ok: true,
      session: { ...result.session, socketUrl: socketUrl.href },
    });
    try {
      sessionResponse.headers.set(
        'X-Lash-Recent-Bookmark',
        encryptNamedEditValue(key, 'recent', roomId, principal.id, siteOrigin),
      );
    } catch {
      // Opening the document still succeeds if the optional bookmark cannot be created.
    }
    return finalize(sessionResponse);
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
    if (parsed.kind !== 'list') return finalize(failure(503));
    const invites = result.invites.map(decodeInvite);
    const available =
      parsed.includeComment && commentInvitesEnabled && !legacyList
        ? { commentInvitesEnabled: true }
        : {};
    return finalize(
      invites.every(Boolean) ? response({ ok: true, invites, ...available }) : failure(503),
    );
  }
  const invite = decodeInvite(result.invite);
  if (!invite) return finalize(failure(503));
  if (result.kind === 'issue') {
    if (parsed.kind !== 'issue' || invite.email !== parsed.email) return finalize(failure(503));
    if (invite.status !== 'pending' || !inviteToken) return finalize(failure(409));
    return finalize(response({ ok: true, invite, token: inviteToken }));
  }
  return finalize(response({ ok: true, invite }));
}
