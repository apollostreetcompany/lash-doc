export const NAMED_EDIT_ROOM_ID = /^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u;
export const NAMED_EDIT_TOKEN = /^[A-Za-z0-9_-]{43}$/u;
export const NAMED_EDIT_INVITE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export const NAMED_EDIT_PROTOCOL = 5 as const;
export const NAMED_EDIT_SOCKET_PROTOCOL = 'lash-realtime-v5' as const;

export type NamedEditOperation = 'issue' | 'list' | 'revoke' | 'session';
export type NamedEditStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export type NamedEditInvite = Readonly<{
  inviteId: string;
  email: string;
  role: 'edit';
  status: NamedEditStatus;
  expiresAt: string;
}>;

export type NamedEditSession = Readonly<{
  roomId: string;
  actorId: string;
  source: 'named';
  role: 'edit';
  protocolVersion: typeof NAMED_EDIT_PROTOCOL;
  capabilities: readonly ['doc.read', 'doc.edit'];
  socketProtocol: typeof NAMED_EDIT_SOCKET_PROTOCOL;
  ticketProtocol: string;
  expiresAt: string;
  socketUrl: string;
}>;

export const namedEditPath = (roomId: string, operation: NamedEditOperation) =>
  `/api/documents/${roomId}/named-edit/${operation}`;

export const namedEditSocketPath = (roomId: string, actorId: string) =>
  `/api/realtime/rooms/${roomId}/socket?protocolVersion=5&actorId=${actorId}`;

export const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const hasKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

export const isNamedEditStatus = (value: unknown): value is NamedEditStatus =>
  value === 'pending' || value === 'accepted' || value === 'revoked' || value === 'expired';

export const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;

export const validNamedEditGrant = (value: Record<string, unknown>, roomId: string) =>
  value.roomId === roomId &&
  value.source === 'named' &&
  value.role === 'edit' &&
  value.protocolVersion === NAMED_EDIT_PROTOCOL &&
  Array.isArray(value.capabilities) &&
  value.capabilities.length === 2 &&
  value.capabilities[0] === 'doc.read' &&
  value.capabilities[1] === 'doc.edit' &&
  value.socketProtocol === NAMED_EDIT_SOCKET_PROTOCOL &&
  typeof value.actorId === 'string' &&
  /^named-[0-9a-f]{32}$/u.test(value.actorId) &&
  typeof value.ticketProtocol === 'string' &&
  /^lash-named-ticket\.[A-Za-z0-9_-]{43}$/u.test(value.ticketProtocol) &&
  isIsoDate(value.expiresAt) &&
  Date.parse(value.expiresAt) > Date.now() &&
  Date.parse(value.expiresAt) - Date.now() <= 70_000;

export const validNamedEditSocketUrl = (value: string, roomId: string, actorId: string) => {
  try {
    const url = new URL(value);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    return (
      (url.protocol === 'wss:' || (local && url.protocol === 'ws:')) &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.pathname + url.search === namedEditSocketPath(roomId, actorId)
    );
  } catch {
    return false;
  }
};
