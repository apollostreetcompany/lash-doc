export const NAMED_EDIT_PROTOCOL_VERSION = 5 as const;
export const NAMED_EDIT_SOCKET_PROTOCOL = 'lash-realtime-v5' as const;
export const NAMED_EDIT_CAPABILITIES = ['doc.read', 'doc.edit'] as const;
export const NAMED_COMMENT_PROTOCOL_VERSION = 6 as const;
export const NAMED_COMMENT_SOCKET_PROTOCOL = 'lash-realtime-v6' as const;
export const NAMED_COMMENT_CAPABILITIES = ['doc.read', 'doc.comment', 'doc.suggest'] as const;
export const NAMED_EDIT_REQUEST_LIMIT = 2_048;

const ROOM_ID = /^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u;
const PRINCIPAL_ID = /^account:v1:[A-Za-z0-9_-]{43}$/u;
const INVITE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const EMAIL_DIGEST = /^email-v1-[A-Za-z0-9_-]{43}$/u;
const EMAIL_CIPHERTEXT = /^email-v1\.[A-Za-z0-9_-]+$/u;
const DIGEST = /^[A-Za-z0-9_-]{43}$/u;
const ACTOR_ID = /^named-[0-9a-f]{32}$/u;

export type NamedInviteRole = 'edit' | 'comment';

export type NamedEditAction = 'issue' | 'list' | 'revoke' | 'session' | 'recent';

export type NamedEditCommand =
  | {
      action: 'issue';
      role?: NamedInviteRole;
      inviteId: string;
      emailDigest: string;
      emailCiphertext: string;
      tokenHash: string;
    }
  | { action: 'list'; includeComment?: true }
  | { action: 'revoke'; inviteId: string; role?: NamedInviteRole }
  | { action: 'recent' }
  | {
      action: 'session';
      browserOrigin: string;
      tokenHash: string | null;
      emailDigest: string | null;
    };

export type NamedEditInvite = {
  inviteId: string;
  emailCiphertext: string;
  role: NamedInviteRole;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
};

type NamedSessionSubject = {
  source: 'named';
  roomId: string;
  actorId: string;
  ticketProtocol: string;
  expiresAt: string;
};

export type NamedEditSession = NamedSessionSubject & {
  role: 'edit';
  protocolVersion: typeof NAMED_EDIT_PROTOCOL_VERSION;
  capabilities: typeof NAMED_EDIT_CAPABILITIES;
  socketProtocol: typeof NAMED_EDIT_SOCKET_PROTOCOL;
};

export type NamedCommentSession = NamedSessionSubject & {
  role: 'comment';
  protocolVersion: typeof NAMED_COMMENT_PROTOCOL_VERSION;
  capabilities: typeof NAMED_COMMENT_CAPABILITIES;
  socketProtocol: typeof NAMED_COMMENT_SOCKET_PROTOCOL;
};

const errorStatus = {
  'invalid-request': 400,
  unauthorized: 401,
  forbidden: 403,
  conflict: 409,
  'rate-limited': 429,
  'named-edit-disabled': 503,
  'named-comment-disabled': 503,
  'comment-projection-unavailable': 409,
  'internal-error': 503,
} as const;

export type NamedEditError = keyof typeof errorStatus;

export type NamedEditResult =
  | { ok: true; version: 1; invite: NamedEditInvite }
  | { ok: true; version: 1; invites: NamedEditInvite[] }
  | { ok: true; version: 1; session: NamedEditSession | NamedCommentSession }
  | { ok: true; version: 1; title: string }
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

type NamedCollaborationEnvironment = {
  LASH_NAMED_COMMENT_PHASE?: string;
  LASH_NAMED_EDIT_PHASE?: string;
  LASH_SHARE_PHASE?: string;
};

export const namedEditEnabled = (env: NamedCollaborationEnvironment) =>
  env.LASH_NAMED_EDIT_PHASE === 'enabled' && env.LASH_SHARE_PHASE === 'enabled';

export const namedCommentEnabled = (env: NamedCollaborationEnvironment) =>
  namedEditEnabled(env) && env.LASH_NAMED_COMMENT_PHASE === 'enabled';

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

const parseOptionalRole = (
  value: Record<string, unknown>,
  keys: string[],
): NamedInviteRole | null | undefined => {
  if (hasKeys(value, keys)) return undefined;
  const role = value.role;
  return hasKeys(value, [...keys, 'role']) && (role === 'edit' || role === 'comment') ? role : null;
};

export const parseNamedEditCommand = (
  action: NamedEditAction,
  value: unknown,
): NamedEditCommand | null => {
  if (!isRecord(value) || value.version !== 1) return null;
  switch (action) {
    case 'recent':
      return hasKeys(value, ['version']) ? { action } : null;
    case 'list':
      if (hasKeys(value, ['version'])) return { action };
      return hasKeys(value, ['version', 'includeComment']) && value.includeComment === true
        ? { action, includeComment: true }
        : null;
    case 'revoke': {
      const role = parseOptionalRole(value, ['version', 'inviteId']);
      return role !== null && isNamedEditInviteId(value.inviteId)
        ? { action, inviteId: value.inviteId, ...(role ? { role } : {}) }
        : null;
    }
    case 'issue': {
      const role = parseOptionalRole(value, [
        'version',
        'inviteId',
        'emailDigest',
        'emailCiphertext',
        'tokenHash',
      ]);
      if (
        role === null ||
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
        ...(role ? { role } : {}),
        inviteId: value.inviteId,
        emailDigest: value.emailDigest,
        emailCiphertext: value.emailCiphertext,
        tokenHash: value.tokenHash,
      };
    }
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

const parseNamedSocketProtocols = (
  value: string | null,
  protocol: string,
  bearer: RegExp,
): string | null => {
  const pairs = value?.split(',').map((token) => token.trim());
  if (!pairs || pairs.length !== 2 || pairs[0] !== protocol) return null;
  return bearer.exec(pairs[1] ?? '')?.[1] ?? null;
};

export const parseNamedEditSocketProtocols = (value: string | null) =>
  parseNamedSocketProtocols(
    value,
    NAMED_EDIT_SOCKET_PROTOCOL,
    /^lash-named-ticket\.([A-Za-z0-9_-]{43})$/u,
  );

export const parseNamedCommentSocketProtocols = (value: string | null) =>
  parseNamedSocketProtocols(
    value,
    NAMED_COMMENT_SOCKET_PROTOCOL,
    /^lash-named-comment-ticket\.([A-Za-z0-9_-]{43})$/u,
  );
