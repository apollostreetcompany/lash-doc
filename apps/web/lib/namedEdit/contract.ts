export const NAMED_EDIT_ROOM_ID = /^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u;
export const NAMED_EDIT_TOKEN = /^[A-Za-z0-9_-]{43}$/u;
export const NAMED_EDIT_INVITE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export const NAMED_EDIT_PROTOCOL = 5 as const;
export const NAMED_EDIT_SOCKET_PROTOCOL = 'lash-realtime-v5' as const;
export const NAMED_COMMENT_PROTOCOL = 6 as const;
export const NAMED_COMMENT_SOCKET_PROTOCOL = 'lash-realtime-v6' as const;
export const NAMED_EDIT_CAPABILITIES = ['doc.read', 'doc.edit'] as const;
export const NAMED_COMMENT_CAPABILITIES = ['doc.read', 'doc.comment', 'doc.suggest'] as const;

export type NamedEditOperation = 'issue' | 'list' | 'revoke' | 'session';
export type NamedEditStatus = 'pending' | 'accepted' | 'revoked' | 'expired';
export type NamedInviteRole = 'edit' | 'comment';
export type NamedCommentInviteError = 'named-comment-disabled' | 'comment-projection-unavailable';
type NamedSocketVersion = typeof NAMED_EDIT_PROTOCOL | typeof NAMED_COMMENT_PROTOCOL;

export type NamedEditInvite = Readonly<{
  inviteId: string;
  email: string;
  role: NamedInviteRole;
  status: NamedEditStatus;
  expiresAt: string;
}>;

export type NamedEditGrant = Readonly<{
  roomId: string;
  actorId: string;
  source: 'named';
  ticketProtocol: string;
  expiresAt: string;
}> &
  (
    | Readonly<{
        role: 'edit';
        protocolVersion: typeof NAMED_EDIT_PROTOCOL;
        capabilities: typeof NAMED_EDIT_CAPABILITIES;
        socketProtocol: typeof NAMED_EDIT_SOCKET_PROTOCOL;
      }>
    | Readonly<{
        role: 'comment';
        protocolVersion: typeof NAMED_COMMENT_PROTOCOL;
        capabilities: typeof NAMED_COMMENT_CAPABILITIES;
        socketProtocol: typeof NAMED_COMMENT_SOCKET_PROTOCOL;
      }>
  );

export type NamedEditSession = NamedEditGrant & Readonly<{ socketUrl: string }>;

export const namedEditGrantFields = [
  'roomId',
  'actorId',
  'source',
  'role',
  'protocolVersion',
  'capabilities',
  'socketProtocol',
  'ticketProtocol',
  'expiresAt',
] as const;

export const namedEditPath = (roomId: string, operation: NamedEditOperation) =>
  `/api/documents/${roomId}/named-edit/${operation}`;

export const namedEditSocketPath = (
  roomId: string,
  actorId: string,
  protocolVersion: NamedSocketVersion = NAMED_EDIT_PROTOCOL,
) => `/api/realtime/rooms/${roomId}/socket?protocolVersion=${protocolVersion}&actorId=${actorId}`;

export const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const hasKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

export const isNamedEditStatus = (value: unknown): value is NamedEditStatus =>
  value === 'pending' || value === 'accepted' || value === 'revoked' || value === 'expired';

export const isNamedInviteRole = (value: unknown): value is NamedInviteRole =>
  value === 'edit' || value === 'comment';

export const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;

const matchesCapabilities = (value: unknown, expected: readonly string[]) =>
  Array.isArray(value) &&
  value.length === expected.length &&
  expected.every((capability, index) => value[index] === capability);

export const validNamedEditGrant = (
  value: Record<string, unknown>,
  roomId: string,
): value is Record<string, unknown> & NamedEditGrant => {
  if (
    value.roomId !== roomId ||
    value.source !== 'named' ||
    typeof value.actorId !== 'string' ||
    !/^named-[0-9a-f]{32}$/u.test(value.actorId) ||
    typeof value.ticketProtocol !== 'string' ||
    !isIsoDate(value.expiresAt)
  )
    return false;

  const remainingMs = Date.parse(value.expiresAt) - Date.now();
  if (remainingMs <= 0 || remainingMs > 70_000) return false;

  if (value.role === 'edit') {
    return (
      value.protocolVersion === NAMED_EDIT_PROTOCOL &&
      value.socketProtocol === NAMED_EDIT_SOCKET_PROTOCOL &&
      /^lash-named-ticket\.[A-Za-z0-9_-]{43}$/u.test(value.ticketProtocol) &&
      matchesCapabilities(value.capabilities, NAMED_EDIT_CAPABILITIES)
    );
  }
  return (
    value.role === 'comment' &&
    value.protocolVersion === NAMED_COMMENT_PROTOCOL &&
    value.socketProtocol === NAMED_COMMENT_SOCKET_PROTOCOL &&
    /^lash-named-comment-ticket\.[A-Za-z0-9_-]{43}$/u.test(value.ticketProtocol) &&
    matchesCapabilities(value.capabilities, NAMED_COMMENT_CAPABILITIES)
  );
};

export const validNamedEditSocketUrl = (
  value: string,
  roomId: string,
  actorId: string,
  protocolVersion: NamedSocketVersion = NAMED_EDIT_PROTOCOL,
) => {
  try {
    const url = new URL(value);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    return (
      (url.protocol === 'wss:' || (local && url.protocol === 'ws:')) &&
      !url.username &&
      !url.password &&
      !url.hash &&
      value === `${url.origin}${namedEditSocketPath(roomId, actorId, protocolVersion)}`
    );
  } catch {
    return false;
  }
};
