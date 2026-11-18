import { capabilitiesForScope } from '@lash/rbac';
import {
  createAuditLog,
  createShareSigner,
  createStaticPolicyStore,
  type RevocationStore,
} from '@lash/share';
import { createDocumentId, type RevocationRecord, type ShareScope } from '@lash/types';

const INVITE_RECORDS_KEY = 'lash:invite-records:v1';
const INVITE_REVOCATIONS_KEY = 'lash:invite-revocations:v1';
const LOCAL_INVITE_SECRET = 'lash-local-invite-secret';
const VALIDATED_INVITE_VERSION = 1 as const;
const MAX_INVITE_TOKEN_LENGTH = 16_384;

type InviteStatus = 'active' | 'revoked' | 'expired';

export type InviteRecord = {
  jti: string;
  docId: string;
  email: string;
  scope: ShareScope;
  token: string;
  link: string;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  status: InviteStatus;
};

export type CreateInviteRecordResult =
  | { ok: true; record: InviteRecord }
  | { ok: false; reason: 'commit-rejected' | 'storage-conflict' };

export type InviteAccess =
  | { ok: true; scope: ShareScope; email?: string; token: string }
  | {
      ok: false;
      reason: 'expired' | 'invalid' | 'revoked' | 'document-mismatch' | 'unavailable';
    };

export type InviteAuthority = 'unavailable' | 'development-loopback';

export type ValidatedInviteCredential = {
  version: typeof VALIDATED_INVITE_VERSION;
  authority: 'configured' | 'development-loopback';
  documentId: string;
  token: string;
  validatedAt: string;
};

export type InviteFragmentCredential =
  | { state: 'absent' }
  | { state: 'invalid' }
  | { state: 'valid'; token: string };

const redactionPolicy = {
  sha: 'local-redaction-v1',
  version: 1,
  rules: [{ path: 'spans.text', action: 'redact' as const }],
};

const readJsonArray = <T>(storage: Storage, key: string): T[] => {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
};

const writeJsonArray = <T>(storage: Storage, key: string, value: T[]) => {
  storage.setItem(key, JSON.stringify(value));
};

const createLocalRevocationStore = (storage: Storage): RevocationStore => ({
  async isRevoked(jti) {
    return readJsonArray<RevocationRecord>(storage, INVITE_REVOCATIONS_KEY).some(
      (record) => record.jti === jti,
    );
  },
  async revoke(record) {
    const records = readJsonArray<RevocationRecord>(storage, INVITE_REVOCATIONS_KEY).filter(
      (existing) => existing.jti !== record.jti,
    );
    records.push({ ...record });
    writeJsonArray(storage, INVITE_REVOCATIONS_KEY, records);
  },
  async listFor() {
    return readJsonArray<RevocationRecord>(storage, INVITE_REVOCATIONS_KEY);
  },
});

const createLocalSigner = (storage: Storage) =>
  createShareSigner({
    secret: LOCAL_INVITE_SECRET,
    revocations: createLocalRevocationStore(storage),
    policies: createStaticPolicyStore(redactionPolicy),
    audit: createAuditLog({ adapter: 'memory' }),
  });

const normalizeInviteRecordList = (records: InviteRecord[], now: string): InviteRecord[] =>
  records.map((record) => ({
    ...record,
    status:
      record.revokedAt !== null
        ? 'revoked'
        : record.expiresAt && record.expiresAt <= now
          ? 'expired'
          : 'active',
  }));

const parseInviteRecordRevision = (raw: string | null, now: string): InviteRecord[] | null => {
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? normalizeInviteRecordList(parsed as InviteRecord[], now) : null;
  } catch {
    return null;
  }
};

const normalizeInviteRecords = (storage: Storage): InviteRecord[] =>
  normalizeInviteRecordList(
    readJsonArray<InviteRecord>(storage, INVITE_RECORDS_KEY),
    new Date().toISOString(),
  );

const saveInviteRecords = (storage: Storage, records: InviteRecord[]) => {
  writeJsonArray(storage, INVITE_RECORDS_KEY, records);
};

export const listInviteRecords = (storage: Storage, docId: string): InviteRecord[] =>
  normalizeInviteRecords(storage).filter((record) => record.docId === docId);

export const expiryForOption = (option: 'never' | '7d' | 'expired') => {
  if (option === 'never') return null;
  if (option === 'expired') return '2000-01-01T00:00:00.000Z';
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
};

export const createInviteRecord = async (
  input: {
    storage: Storage;
    docId: string;
    email: string;
    scope: ShareScope;
    expiresAt: string | null;
    origin: string;
    authority: 'development-loopback';
  },
  options: {
    commitGuard: () => boolean;
  },
): Promise<CreateInviteRecordResult> => {
  const authority = input.authority;
  const storage = input.storage;
  const docId = input.docId;
  const email = input.email;
  const scope = input.scope;
  const expiresAt = input.expiresAt;
  const origin = input.origin;
  let commitGuard: () => boolean;
  let initialRevision: string | null;
  try {
    commitGuard = options.commitGuard;
    initialRevision = storage.getItem(INVITE_RECORDS_KEY);
  } catch {
    return { ok: false, reason: 'storage-conflict' };
  }
  if (authority !== 'development-loopback') {
    throw new Error('Local invite issuance is restricted to the development loopback fixture.');
  }
  const signer = createLocalSigner(storage);
  const createdAt = new Date().toISOString();
  const token = await signer.sign({
    docId: createDocumentId(docId),
    scope,
    expiresAt,
    issuedBy: 'local-user',
    redactionPolicy: redactionPolicy.sha,
    redactionPolicyVersion: redactionPolicy.version,
  });
  const link = `${origin}/doc/${encodeURIComponent(docId)}#invite=${encodeURIComponent(
    token.token,
  )}`;
  const record: InviteRecord = {
    jti: token.jti,
    docId,
    email,
    scope,
    token: token.token,
    link,
    expiresAt,
    createdAt,
    revokedAt: null,
    status: expiresAt && expiresAt <= createdAt ? 'expired' : 'active',
  };
  const initialRecords = parseInviteRecordRevision(initialRevision, createdAt);
  if (!initialRecords) return { ok: false, reason: 'storage-conflict' };
  const records = initialRecords.filter((existing) => existing.jti !== record.jti);
  records.push(record);
  const preparedStorageValue = JSON.stringify(records);
  let allowed = false;
  try {
    allowed = commitGuard() === true;
  } catch {
    allowed = false;
  }
  if (!allowed) return { ok: false, reason: 'commit-rejected' };
  try {
    if (storage.getItem(INVITE_RECORDS_KEY) !== initialRevision) {
      return { ok: false, reason: 'storage-conflict' };
    }
    storage.setItem(INVITE_RECORDS_KEY, preparedStorageValue);
  } catch {
    return { ok: false, reason: 'storage-conflict' };
  }
  return { ok: true, record };
};

export const revokeInviteRecord = async (storage: Storage, jti: string, reason = 'revoked') => {
  const revokedAt = new Date().toISOString();
  await createLocalRevocationStore(storage).revoke({
    jti,
    revokedAt,
    revokedBy: 'local-user',
    reason,
  });
  saveInviteRecords(
    storage,
    normalizeInviteRecords(storage).map((record) =>
      record.jti === jti ? { ...record, revokedAt, status: 'revoked' } : record,
    ),
  );
};

export const legacyInviteCredentialKey = (docId: string) => `lash:invite-token:${docId}`;

export const validatedInviteCredentialKey = (docId: string) => `lash:validated-invite:v1:${docId}`;

const decodeFragmentComponent = (value: string) => {
  try {
    return decodeURIComponent(value.replaceAll('+', ' '));
  } catch {
    return null;
  }
};

export const readInviteFragmentCredential = (
  location: Pick<Location, 'hash'>,
): InviteFragmentCredential => {
  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  const inviteParts = hash.split('&').filter((part) => {
    const separator = part.indexOf('=');
    const rawKey = separator === -1 ? part : part.slice(0, separator);
    return decodeFragmentComponent(rawKey) === 'invite';
  });
  if (inviteParts.length === 0) return { state: 'absent' };
  if (inviteParts.length !== 1) return { state: 'invalid' };
  const separator = inviteParts[0].indexOf('=');
  if (separator === -1) return { state: 'invalid' };
  const token = decodeFragmentComponent(inviteParts[0].slice(separator + 1));
  if (!token || token.length > MAX_INVITE_TOKEN_LENGTH) return { state: 'invalid' };
  return { state: 'valid', token };
};

export const inviteTokenFromLocation = (location: Pick<Location, 'hash'>) => {
  const credential = readInviteFragmentCredential(location);
  return credential.state === 'valid' ? credential.token : null;
};

export const scrubInviteFragment = (
  location: Pick<Location, 'hash' | 'pathname' | 'search'>,
  history: Pick<History, 'replaceState'>,
) => {
  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  const params = new URLSearchParams(hash);
  if (!params.has('invite')) return;
  params.delete('invite');
  const nextHash = params.toString();
  history.replaceState(
    null,
    '',
    `${location.pathname}${location.search}${nextHash ? `#${nextHash}` : ''}`,
  );
};

const isValidatedInviteCredential = (
  value: unknown,
  documentId: string,
): value is ValidatedInviteCredential => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ValidatedInviteCredential>;
  return (
    candidate.version === VALIDATED_INVITE_VERSION &&
    (candidate.authority === 'configured' || candidate.authority === 'development-loopback') &&
    candidate.documentId === documentId &&
    typeof candidate.token === 'string' &&
    candidate.token.length > 0 &&
    candidate.token.length <= MAX_INVITE_TOKEN_LENGTH &&
    typeof candidate.validatedAt === 'string' &&
    Number.isFinite(Date.parse(candidate.validatedAt))
  );
};

export const readValidatedInviteCredential = (
  storage: Storage | undefined,
  documentId: string,
): ValidatedInviteCredential | null => {
  if (!storage) return null;
  const key = validatedInviteCredentialKey(documentId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (isValidatedInviteCredential(parsed, documentId)) return parsed;
    storage.removeItem(key);
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Credential cleanup is best-effort in privacy-restricted browsers.
    }
  }
  return null;
};

export const writeValidatedInviteCredential = (
  storage: Storage | undefined,
  credential: ValidatedInviteCredential,
) => {
  if (!storage || !isValidatedInviteCredential(credential, credential.documentId)) return;
  storage.setItem(validatedInviteCredentialKey(credential.documentId), JSON.stringify(credential));
};

export const clearLegacyInviteCredential = (storage: Storage | undefined, documentId: string) => {
  try {
    storage?.removeItem(legacyInviteCredentialKey(documentId));
  } catch {
    // Do not let unavailable session storage weaken the access decision.
  }
};

export const clearRoomInviteCredentials = (storage: Storage | undefined, documentId: string) => {
  try {
    storage?.removeItem(legacyInviteCredentialKey(documentId));
    storage?.removeItem(validatedInviteCredentialKey(documentId));
  } catch {
    // The controller still drops its in-memory credential and fails closed.
  }
};

export const validateInviteAccess = async (
  storage: Storage | undefined,
  docId: string,
  token: string | null,
  authority: InviteAuthority = 'unavailable',
): Promise<InviteAccess | null> => {
  if (!token) return null;
  if (authority !== 'development-loopback' || !storage) {
    return { ok: false, reason: 'unavailable' };
  }
  const signer = createLocalSigner(storage);
  const result = await signer.validate(token);
  if (!result.ok) return { ok: false, reason: result.reason };
  if (result.token.docId !== createDocumentId(docId)) {
    return { ok: false, reason: 'document-mismatch' };
  }
  const record = normalizeInviteRecords(storage).find(
    (candidate) => candidate.jti === result.token.jti,
  );
  return {
    ok: true,
    scope: result.token.scope,
    email: record?.email,
    token,
  };
};

export const inviteCapabilities = (scope: ShareScope | null) => ({
  canComment: scope ? capabilitiesForScope(scope).includes('doc.comment') : false,
  canSuggest: scope ? capabilitiesForScope(scope).includes('doc.suggest') : false,
  canEdit: scope ? capabilitiesForScope(scope).includes('doc.edit') : false,
  canAccept: scope ? capabilitiesForScope(scope).includes('doc.history.restore') : false,
});
