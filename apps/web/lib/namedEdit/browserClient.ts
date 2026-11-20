import {
  NAMED_EDIT_INVITE_ID,
  NAMED_EDIT_ROOM_ID,
  NAMED_EDIT_TOKEN,
  hasKeys,
  isIsoDate,
  isNamedEditStatus,
  isNamedInviteRole,
  isObject,
  namedEditGrantFields,
  namedEditPath,
  validNamedEditGrant,
  validNamedEditSocketUrl,
  type NamedCommentInviteError,
  type NamedEditInvite,
  type NamedEditOperation,
  type NamedEditSession,
} from './contract';
import { isRecentSharedBookmark, RECENT_SHARED_BOOKMARK_HEADER } from '../recentSharedDocuments';

const browserFetch: typeof fetch = (input, init) => fetch(input, init);

const requestNamedEdit = async (
  roomId: string,
  operation: NamedEditOperation,
  fields: Record<string, unknown>,
  signal: AbortSignal,
  fetcher = browserFetch,
) => {
  if (!NAMED_EDIT_ROOM_ID.test(roomId)) return { status: 400, body: null };
  try {
    const response = await fetcher(namedEditPath(roomId, operation), {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ version: 1, ...fields }),
      signal,
    });
    const { status } = response;
    const readBody =
      status === 200 ||
      (operation === 'session' && status === 502) ||
      (operation === 'issue' && (status === 409 || status === 503));
    const body: unknown = readBody
      ? await response.json().catch((error: unknown) => {
          if (error instanceof SyntaxError) return null;
          throw error;
        })
      : null;
    const recentBookmark =
      operation === 'session' && status === 200
        ? response.headers.get(RECENT_SHARED_BOOKMARK_HEADER)
        : null;
    return { status, body, recentBookmark };
  } catch {
    return { status: 503, body: null };
  }
};

export type NamedEditSessionResult =
  | { ok: true; session: NamedEditSession; recentBookmark?: string }
  | { ok: false; retryable: boolean; signInRequired?: true; protocolInvalid?: true };

const invalidSessionResponse = { ok: false, retryable: false, protocolInvalid: true } as const;

export async function requestNamedEditSession(
  roomId: string,
  signal: AbortSignal,
  fetcher?: typeof fetch,
): Promise<NamedEditSessionResult> {
  const { status, body, recentBookmark } = await requestNamedEdit(
    roomId,
    'session',
    { token: null },
    signal,
    fetcher,
  );
  if (status === 401) return { ok: false, retryable: false, signInRequired: true };
  if (status === 403 || status === 404) return { ok: false, retryable: false };
  if (
    status === 502 &&
    isObject(body) &&
    hasKeys(body, ['ok', 'version', 'error']) &&
    body.ok === false &&
    body.version === 1 &&
    body.error === 'invalid-response'
  ) {
    return invalidSessionResponse;
  }
  if (status !== 200) return { ok: false, retryable: true };
  if (
    !isObject(body) ||
    !hasKeys(body, ['ok', 'version', 'session']) ||
    body.ok !== true ||
    body.version !== 1 ||
    !isObject(body.session) ||
    !hasKeys(body.session, [...namedEditGrantFields, 'socketUrl']) ||
    !validNamedEditGrant(body.session, roomId) ||
    typeof body.session.socketUrl !== 'string' ||
    !validNamedEditSocketUrl(
      body.session.socketUrl,
      roomId,
      body.session.actorId,
      body.session.protocolVersion,
    )
  )
    return invalidSessionResponse;

  return {
    ok: true,
    session: { ...body.session, socketUrl: body.session.socketUrl },
    ...(!signal.aborted && isRecentSharedBookmark(recentBookmark) ? { recentBookmark } : {}),
  };
}

const inviteFrom = (value: unknown): NamedEditInvite | null =>
  isObject(value) &&
  hasKeys(value, ['inviteId', 'email', 'role', 'status', 'expiresAt']) &&
  typeof value.inviteId === 'string' &&
  NAMED_EDIT_INVITE_ID.test(value.inviteId) &&
  typeof value.email === 'string' &&
  value.email.length <= 254 &&
  isNamedInviteRole(value.role) &&
  isNamedEditStatus(value.status) &&
  isIsoDate(value.expiresAt)
    ? (value as NamedEditInvite)
    : null;

export type NamedEditOwnerResult =
  | { ok: true; invites: NamedEditInvite[]; commentInvitesEnabled?: true }
  | { ok: true; invite: NamedEditInvite; token?: string }
  | {
      ok: false;
      reason: 'invalid' | 'conflict' | 'unavailable' | 'retry' | NamedCommentInviteError;
    };

export async function requestNamedEditOwner(
  roomId: string,
  operation: Exclude<NamedEditOperation, 'session'>,
  fields: Record<string, unknown>,
  signal: AbortSignal,
): Promise<NamedEditOwnerResult> {
  const role = Object.hasOwn(fields, 'role') ? fields.role : 'edit';
  if (operation !== 'list' && !isNamedInviteRole(role)) return { ok: false, reason: 'invalid' };
  const { status, body } = await requestNamedEdit(
    roomId,
    operation,
    operation === 'list' ? { includeComment: true } : fields,
    signal,
  );
  if (
    operation === 'issue' &&
    role === 'comment' &&
    isObject(body) &&
    hasKeys(body, ['ok', 'version', 'error']) &&
    body.ok === false &&
    body.version === 1 &&
    ((status === 409 && body.error === 'comment-projection-unavailable') ||
      (status === 503 && body.error === 'named-comment-disabled'))
  )
    return { ok: false, reason: body.error };
  if (status === 400) return { ok: false, reason: 'invalid' };
  if (status === 409) return { ok: false, reason: 'conflict' };
  if (status === 401 || status === 403 || status === 404)
    return { ok: false, reason: 'unavailable' };
  if (!isObject(body) || body.ok !== true || body.version !== 1) {
    return { ok: false, reason: 'retry' };
  }
  if (operation === 'list' && Array.isArray(body.invites)) {
    const commentInvitesEnabled = body.commentInvitesEnabled === true;
    if (
      !hasKeys(
        body,
        commentInvitesEnabled
          ? ['ok', 'version', 'invites', 'commentInvitesEnabled']
          : ['ok', 'version', 'invites'],
      )
    )
      return { ok: false, reason: 'retry' };
    const invites = body.invites.map(inviteFrom);
    if (invites.every((invite): invite is NamedEditInvite => invite !== null)) {
      return commentInvitesEnabled
        ? { ok: true, invites, commentInvitesEnabled }
        : { ok: true, invites };
    }
  }
  if (operation !== 'list') {
    const invite = inviteFrom(body.invite);
    if (invite && invite.inviteId === fields.inviteId && invite.role === role) {
      if (
        operation === 'revoke' &&
        invite.status === 'revoked' &&
        hasKeys(body, ['ok', 'version', 'invite'])
      ) {
        return { ok: true, invite };
      }
      if (
        operation === 'issue' &&
        hasKeys(body, ['ok', 'version', 'invite', 'token']) &&
        invite.status === 'pending' &&
        typeof body.token === 'string' &&
        NAMED_EDIT_TOKEN.test(body.token)
      )
        return { ok: true, invite, token: body.token };
    }
  }
  return { ok: false, reason: 'retry' };
}
