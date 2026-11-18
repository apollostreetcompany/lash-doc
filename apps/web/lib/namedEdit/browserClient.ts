import {
  NAMED_EDIT_INVITE_ID,
  NAMED_EDIT_ROOM_ID,
  NAMED_EDIT_TOKEN,
  hasKeys,
  isIsoDate,
  isNamedEditStatus,
  isObject,
  namedEditPath,
  validNamedEditGrant,
  validNamedEditSocketUrl,
  type NamedEditInvite,
  type NamedEditOperation,
  type NamedEditSession,
} from './contract';

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
    const body: unknown =
      status === 200 || (operation === 'session' && status === 502)
        ? await response.json().catch((error: unknown) => {
            if (error instanceof SyntaxError) return null;
            throw error;
          })
        : null;
    return { status, body };
  } catch {
    return { status: 503, body: null };
  }
};

export type NamedEditSessionResult =
  | { ok: true; session: NamedEditSession }
  | { ok: false; retryable: boolean; signInRequired?: true; protocolInvalid?: true };

const invalidSessionResponse = { ok: false, retryable: false, protocolInvalid: true } as const;

export async function requestNamedEditSession(
  roomId: string,
  signal: AbortSignal,
  fetcher?: typeof fetch,
): Promise<NamedEditSessionResult> {
  const { status, body } = await requestNamedEdit(
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
    !validNamedEditGrant(body.session, roomId) ||
    typeof body.session.socketUrl !== 'string' ||
    !validNamedEditSocketUrl(body.session.socketUrl, roomId, String(body.session.actorId))
  )
    return invalidSessionResponse;

  return { ok: true, session: body.session as NamedEditSession };
}

const inviteFrom = (value: unknown): NamedEditInvite | null =>
  isObject(value) &&
  hasKeys(value, ['inviteId', 'email', 'role', 'status', 'expiresAt']) &&
  typeof value.inviteId === 'string' &&
  NAMED_EDIT_INVITE_ID.test(value.inviteId) &&
  typeof value.email === 'string' &&
  value.email.length <= 254 &&
  value.role === 'edit' &&
  isNamedEditStatus(value.status) &&
  isIsoDate(value.expiresAt)
    ? (value as NamedEditInvite)
    : null;

export type NamedEditOwnerResult =
  | { ok: true; invites: NamedEditInvite[] }
  | { ok: true; invite: NamedEditInvite; token?: string }
  | { ok: false; reason: 'invalid' | 'conflict' | 'unavailable' | 'retry' };

export async function requestNamedEditOwner(
  roomId: string,
  operation: Exclude<NamedEditOperation, 'session'>,
  fields: Record<string, unknown>,
  signal: AbortSignal,
): Promise<NamedEditOwnerResult> {
  const { status, body } = await requestNamedEdit(roomId, operation, fields, signal);
  if (status === 400) return { ok: false, reason: 'invalid' };
  if (status === 409) return { ok: false, reason: 'conflict' };
  if (status === 401 || status === 403 || status === 404)
    return { ok: false, reason: 'unavailable' };
  if (!isObject(body) || body.ok !== true || body.version !== 1) {
    return { ok: false, reason: 'retry' };
  }
  if (operation === 'list' && Array.isArray(body.invites)) {
    const invites = body.invites.map(inviteFrom);
    if (invites.every((invite): invite is NamedEditInvite => invite !== null)) {
      return { ok: true, invites };
    }
  }
  if (operation !== 'list') {
    const invite = inviteFrom(body.invite);
    if (invite && invite.inviteId === fields.inviteId) {
      if (operation === 'revoke' && invite.status === 'revoked') return { ok: true, invite };
      if (
        operation === 'issue' &&
        invite.status === 'pending' &&
        typeof body.token === 'string' &&
        NAMED_EDIT_TOKEN.test(body.token)
      )
        return { ok: true, invite, token: body.token };
    }
  }
  return { ok: false, reason: 'retry' };
}
