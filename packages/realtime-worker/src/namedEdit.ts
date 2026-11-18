export const NAMED_EDIT_PROTOCOL_VERSION = 5 as const;
export const NAMED_EDIT_SOCKET_PROTOCOL = 'lash-realtime-v5' as const;
export const NAMED_EDIT_CAPABILITIES = ['doc.read', 'doc.edit'] as const;
export const NAMED_EDIT_REQUEST_LIMIT = 2_048;

const ROOM_ID = /^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u;
const PRINCIPAL_ID = /^account:v1:[A-Za-z0-9_-]{43}$/u;
const INVITE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const EMAIL_DIGEST = /^email-v1-[A-Za-z0-9_-]{43}$/u;
const EMAIL_CIPHERTEXT = /^email-v1\.[A-Za-z0-9_-]+$/u;
const DIGEST = /^[A-Za-z0-9_-]{43}$/u;
const ACTOR_ID = /^named-[0-9a-f]{32}$/u;

export type NamedEditAction = 'issue' | 'list' | 'revoke' | 'session';

export type NamedEditCommand =
  | {
      action: 'issue';
      inviteId: string;
      emailDigest: string;
      emailCiphertext: string;
      tokenHash: string;
    }
  | { action: 'list' }
  | { action: 'revoke'; inviteId: string }
  | {
      action: 'session';
      browserOrigin: string;
      tokenHash: string | null;
      emailDigest: string | null;
    };

export type NamedEditInvite = {
  inviteId: string;
  emailCiphertext: string;
  role: 'edit';
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
};

export type NamedEditSession = {
  source: 'named';
  role: 'edit';
  protocolVersion: typeof NAMED_EDIT_PROTOCOL_VERSION;
  roomId: string;
  actorId: string;
  capabilities: typeof NAMED_EDIT_CAPABILITIES;
  socketProtocol: typeof NAMED_EDIT_SOCKET_PROTOCOL;
  ticketProtocol: string;
  expiresAt: string;
};

const errorStatus = {
  'invalid-request': 400,
  unauthorized: 401,
  forbidden: 403,
  conflict: 409,
  'rate-limited': 429,
  'named-edit-disabled': 503,
  'internal-error': 503,
} as const;

export type NamedEditError = keyof typeof errorStatus;

export type NamedEditResult =
  | { ok: true; version: 1; invite: NamedEditInvite }
  | { ok: true; version: 1; invites: NamedEditInvite[] }
  | { ok: true; version: 1; session: NamedEditSession }
  | { ok: false; version: 1; error: NamedEditError; retryable: boolean };

export const namedEditFailure = (error: NamedEditError): NamedEditResult => ({
  ok: false,
  version: 1,
  error,
  retryable: error === 'rate-limited' || error === 'internal-error',
});

export const namedEditResponse = (result: NamedEditResult): Response =>
  Response.json(result, {
    status: result.ok ? 200 : errorStatus[result.error],
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...(!result.ok && result.error === 'rate-limited' ? { 'retry-after': '60' } : {}),
    },
  });

export const namedEditEnabled = (env: {
  LASH_NAMED_EDIT_PHASE?: string;
  LASH_SHARE_PHASE?: string;
}) => env.LASH_NAMED_EDIT_PHASE === 'enabled' && env.LASH_SHARE_PHASE === 'enabled';

export const isNamedEditRoomId = (value: unknown): value is string =>
  typeof value === 'string' && ROOM_ID.test(value);
export const isNamedEditPrincipal = (value: unknown): value is string =>
  typeof value === 'string' && PRINCIPAL_ID.test(value);
export const isNamedEditInviteId = (value: unknown): value is string =>
  typeof value === 'string' && INVITE_ID.test(value);
export const isNamedEditActorId = (value: unknown): value is string =>
  typeof value === 'string' && ACTOR_ID.test(value);
const isEmailDigest = (value: unknown): value is string =>
  typeof value === 'string' && EMAIL_DIGEST.test(value);
const isDigest = (value: unknown): value is string =>
  typeof value === 'string' && DIGEST.test(value);

export const isNamedEditOrigin = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.includes(',')) return false;
  try {
    const url = new URL(value);
    return (
      url.origin === value &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
    );
  } catch {
    return false;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

export const parseNamedEditCommand = (
  action: NamedEditAction,
  value: unknown,
): NamedEditCommand | null => {
  if (!isRecord(value) || value.version !== 1) return null;
  switch (action) {
    case 'list':
      return hasKeys(value, ['version']) ? { action } : null;
    case 'revoke':
      return hasKeys(value, ['version', 'inviteId']) && isNamedEditInviteId(value.inviteId)
        ? { action, inviteId: value.inviteId }
        : null;
    case 'issue':
      if (
        !hasKeys(value, ['version', 'inviteId', 'emailDigest', 'emailCiphertext', 'tokenHash']) ||
        !isNamedEditInviteId(value.inviteId) ||
        !isEmailDigest(value.emailDigest) ||
        typeof value.emailCiphertext !== 'string' ||
        value.emailCiphertext.length > 1024 ||
        !EMAIL_CIPHERTEXT.test(value.emailCiphertext) ||
        !isDigest(value.tokenHash)
      ) {
        return null;
      }
      return {
        action,
        inviteId: value.inviteId,
        emailDigest: value.emailDigest,
        emailCiphertext: value.emailCiphertext,
        tokenHash: value.tokenHash,
      };
    case 'session':
      if (
        !hasKeys(value, ['version', 'browserOrigin', 'tokenHash', 'emailDigest']) ||
        !isNamedEditOrigin(value.browserOrigin)
      ) {
        return null;
      }
      if (value.tokenHash === null && value.emailDigest === null) {
        return { action, browserOrigin: value.browserOrigin, tokenHash: null, emailDigest: null };
      }
      return isDigest(value.tokenHash) && isEmailDigest(value.emailDigest)
        ? {
            action,
            browserOrigin: value.browserOrigin,
            tokenHash: value.tokenHash,
            emailDigest: value.emailDigest,
          }
        : null;
  }
};

export const parseNamedEditSocketProtocols = (value: string | null): string | null => {
  const pairs = value?.split(',').map((token) => token.trim());
  if (!pairs || pairs.length !== 2 || pairs[0] !== NAMED_EDIT_SOCKET_PROTOCOL) return null;
  return /^lash-named-ticket\.([A-Za-z0-9_-]{43})$/u.exec(pairs[1] ?? '')?.[1] ?? null;
};
