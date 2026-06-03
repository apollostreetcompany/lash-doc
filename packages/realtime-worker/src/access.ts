export type RealtimeCapability = 'doc.read' | 'doc.edit';
export type RealtimeInviteScope = 'view' | 'comment' | 'suggest' | 'edit';

export type RealtimeInviteToken = {
  jti: string;
  token: string;
  docId: string;
  scope: RealtimeInviteScope;
  expiresAt: string | null;
  issuedBy: string;
  redactionPolicy: string;
  redactionPolicyVersion: number;
};

export interface RealtimeSessionGrant {
  actorId: string;
  documentId: string;
  capabilities: RealtimeCapability[];
  scope?: RealtimeInviteScope;
  issuedAt: string;
  expiresAt: string;
}

export type RealtimeAccessFailure =
  | 'invalid'
  | 'expired'
  | 'revoked'
  | 'document-mismatch'
  | 'scope-mismatch';

export type RealtimeAccessResult =
  | { ok: true; grant: RealtimeSessionGrant }
  | { ok: false; reason: RealtimeAccessFailure };

export interface RealtimeAccessRequirement {
  documentId: string;
  capability: RealtimeCapability;
  now?: string;
}

export interface RealtimeInviteRequirement {
  documentId: string;
  now?: string;
  isRevoked?: (jti: string) => boolean | Promise<boolean>;
}

export type RealtimeInviteResult =
  | { ok: true; token: RealtimeInviteToken }
  | { ok: false; reason: Exclude<RealtimeAccessFailure, 'scope-mismatch'> };

const encoder = new TextEncoder();
const TOKEN_SEPARATOR = '.';
const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000;

const canonicalize = (value: unknown): string => {
  const normalize = (input: unknown): unknown => {
    if (input === null) return null;
    if (typeof input === 'string' || typeof input === 'boolean' || typeof input === 'number') {
      return input;
    }
    if (Array.isArray(input)) {
      return input.map(normalize);
    }
    if (!input || typeof input !== 'object') {
      throw new Error('invalid canonical value');
    }
    const record = input as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const child = record[key];
      if (child !== undefined) {
        normalized[key] = normalize(child);
      }
    }
    return normalized;
  };
  return JSON.stringify(normalize(value));
};

const hashCanonical = async (value: unknown): Promise<string> => {
  const data = encoder.encode(canonicalize(value));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};

const base64UrlToBytes = (value: string) => {
  const padded = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const canonicalGrant = (grant: RealtimeSessionGrant) =>
  JSON.stringify({
    actorId: grant.actorId,
    capabilities: [...grant.capabilities].sort(),
    documentId: grant.documentId,
    expiresAt: grant.expiresAt,
    issuedAt: grant.issuedAt,
    scope: grant.scope ?? null,
  });

const importHmacKey = (secret: string) =>
  crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);

const signPayload = async (payload: string, secret: string) => {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return bytesToBase64Url(new Uint8Array(signature));
};

const timingSafeEqual = (left: string, right: string) => {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let diff = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return diff === 0;
};

const parseGrant = (payload: string): RealtimeSessionGrant | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const grant = parsed as Partial<RealtimeSessionGrant>;
  if (
    typeof grant.actorId !== 'string' ||
    typeof grant.documentId !== 'string' ||
    !Array.isArray(grant.capabilities) ||
    typeof grant.issuedAt !== 'string' ||
    typeof grant.expiresAt !== 'string'
  ) {
    return null;
  }
  const capabilities = grant.capabilities.filter(
    (capability): capability is RealtimeCapability =>
      capability === 'doc.read' || capability === 'doc.edit',
  );
  if (capabilities.length !== grant.capabilities.length) return null;
  return {
    actorId: grant.actorId,
    documentId: grant.documentId,
    capabilities,
    scope:
      grant.scope === 'view' ||
      grant.scope === 'comment' ||
      grant.scope === 'suggest' ||
      grant.scope === 'edit'
        ? grant.scope
        : undefined,
    issuedAt: grant.issuedAt,
    expiresAt: grant.expiresAt,
  };
};

const parseInvitePayload = (payload: string): Omit<RealtimeInviteToken, 'token'> | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const token = parsed as Partial<Omit<RealtimeInviteToken, 'token'>>;
  if (
    typeof token.jti !== 'string' ||
    typeof token.docId !== 'string' ||
    typeof token.issuedBy !== 'string' ||
    typeof token.redactionPolicy !== 'string' ||
    typeof token.redactionPolicyVersion !== 'number' ||
    (token.expiresAt !== null && typeof token.expiresAt !== 'string') ||
    (token.scope !== 'view' &&
      token.scope !== 'comment' &&
      token.scope !== 'suggest' &&
      token.scope !== 'edit')
  ) {
    return null;
  }
  return {
    jti: token.jti,
    docId: token.docId,
    scope: token.scope,
    expiresAt: token.expiresAt,
    issuedBy: token.issuedBy,
    redactionPolicy: token.redactionPolicy,
    redactionPolicyVersion: token.redactionPolicyVersion,
  };
};

export const normalizeActorId = (raw: string | undefined | null) => {
  const normalized = (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96);
  return normalized || 'local-user';
};

export const createDefaultRealtimeGrant = (
  actorId: string,
  documentId: string,
  issuedAt = new Date(),
): RealtimeSessionGrant => ({
  actorId: normalizeActorId(actorId),
  documentId,
  capabilities: ['doc.read', 'doc.edit'],
  issuedAt: issuedAt.toISOString(),
  expiresAt: new Date(issuedAt.getTime() + DEFAULT_SESSION_TTL_MS).toISOString(),
});

export const realtimeCapabilitiesForScope = (scope: RealtimeInviteScope): RealtimeCapability[] =>
  scope === 'view' ? ['doc.read'] : ['doc.read', 'doc.edit'];

export const createRealtimeGrantForScope = (
  actorId: string,
  documentId: string,
  scope: RealtimeInviteScope,
  issuedAt = new Date(),
): RealtimeSessionGrant => ({
  actorId: normalizeActorId(actorId),
  documentId,
  scope,
  capabilities: realtimeCapabilitiesForScope(scope),
  issuedAt: issuedAt.toISOString(),
  expiresAt: new Date(issuedAt.getTime() + DEFAULT_SESSION_TTL_MS).toISOString(),
});

export const createRealtimeSessionToken = async (grant: RealtimeSessionGrant, secret: string) => {
  const payload = bytesToBase64Url(encoder.encode(canonicalGrant(grant)));
  const signature = await signPayload(payload, secret);
  return `${payload}${TOKEN_SEPARATOR}${signature}`;
};

export const verifyRealtimeInviteToken = async (
  token: string | null | undefined,
  secret: string,
  requirement: RealtimeInviteRequirement,
): Promise<RealtimeInviteResult> => {
  if (!token) return { ok: false, reason: 'invalid' };
  const [payload, signature, extra] = token.split(TOKEN_SEPARATOR);
  if (!payload || !signature || extra) return { ok: false, reason: 'invalid' };

  const parsed = parseInvitePayload(payload);
  if (!parsed) return { ok: false, reason: 'invalid' };

  const expected = await hashCanonical({ payload: parsed, secret });
  if (!timingSafeEqual(signature, expected)) return { ok: false, reason: 'invalid' };
  if (parsed.expiresAt && parsed.expiresAt <= (requirement.now ?? new Date().toISOString())) {
    return { ok: false, reason: 'expired' };
  }
  if (parsed.docId !== requirement.documentId) {
    return { ok: false, reason: 'document-mismatch' };
  }
  if (requirement.isRevoked && (await requirement.isRevoked(parsed.jti))) {
    return { ok: false, reason: 'revoked' };
  }

  return { ok: true, token: { ...parsed, token } };
};

export const createRealtimeGrantFromInviteToken = async (
  actorId: string,
  documentId: string,
  inviteToken: string | null | undefined,
  secret: string,
  requirement: Omit<RealtimeInviteRequirement, 'documentId'> = {},
): Promise<RealtimeAccessResult> => {
  const decision = await verifyRealtimeInviteToken(inviteToken, secret, {
    ...requirement,
    documentId,
  });
  if (!decision.ok) return decision;
  return {
    ok: true,
    grant: createRealtimeGrantForScope(actorId, documentId, decision.token.scope),
  };
};

export const verifyRealtimeSessionToken = async (
  token: string | null | undefined,
  secret: string,
  requirement: RealtimeAccessRequirement,
): Promise<RealtimeAccessResult> => {
  if (!token) return { ok: false, reason: 'invalid' };
  const [payload, signature, extra] = token.split(TOKEN_SEPARATOR);
  if (!payload || !signature || extra) return { ok: false, reason: 'invalid' };
  const expected = await signPayload(payload, secret);
  if (!timingSafeEqual(signature, expected)) return { ok: false, reason: 'invalid' };

  const grant = parseGrant(payload);
  if (!grant) return { ok: false, reason: 'invalid' };
  if (grant.expiresAt <= (requirement.now ?? new Date().toISOString())) {
    return { ok: false, reason: 'expired' };
  }
  if (grant.documentId !== requirement.documentId) {
    return { ok: false, reason: 'document-mismatch' };
  }
  if (!grant.capabilities.includes(requirement.capability)) {
    return { ok: false, reason: 'scope-mismatch' };
  }

  return { ok: true, grant };
};
