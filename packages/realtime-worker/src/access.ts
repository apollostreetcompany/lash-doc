type RealtimeCapability = 'doc.read' | 'doc.edit';

export interface RealtimeSessionGrant {
  actorId: string;
  documentId: string;
  capabilities: RealtimeCapability[];
  issuedAt: string;
  expiresAt: string;
}

export type RealtimeAccessFailure = 'invalid' | 'expired' | 'document-mismatch' | 'scope-mismatch';

export type RealtimeAccessResult =
  | { ok: true; grant: RealtimeSessionGrant }
  | { ok: false; reason: RealtimeAccessFailure };

export interface RealtimeAccessRequirement {
  documentId: string;
  capability: RealtimeCapability;
  now?: string;
}

const encoder = new TextEncoder();
const TOKEN_SEPARATOR = '.';
const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000;

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
    issuedAt: grant.issuedAt,
    expiresAt: grant.expiresAt,
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

export const createRealtimeSessionToken = async (grant: RealtimeSessionGrant, secret: string) => {
  const payload = bytesToBase64Url(encoder.encode(canonicalGrant(grant)));
  const signature = await signPayload(payload, secret);
  return `${payload}${TOKEN_SEPARATOR}${signature}`;
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
