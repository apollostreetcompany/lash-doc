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

export type InviteAccess =
  | { ok: true; scope: ShareScope; email?: string; token: string }
  | { ok: false; reason: 'expired' | 'invalid' | 'revoked' | 'document-mismatch' };

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

const normalizeInviteRecords = (storage: Storage): InviteRecord[] =>
  readJsonArray<InviteRecord>(storage, INVITE_RECORDS_KEY).map((record) => ({
    ...record,
    status:
      record.revokedAt !== null
        ? 'revoked'
        : record.expiresAt && record.expiresAt <= new Date().toISOString()
          ? 'expired'
          : 'active',
  }));

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

export const createInviteRecord = async (input: {
  storage: Storage;
  docId: string;
  email: string;
  scope: ShareScope;
  expiresAt: string | null;
  origin: string;
}): Promise<InviteRecord> => {
  const signer = createLocalSigner(input.storage);
  const createdAt = new Date().toISOString();
  const token = await signer.sign({
    docId: createDocumentId(input.docId),
    scope: input.scope,
    expiresAt: input.expiresAt,
    issuedBy: 'local-user',
    redactionPolicy: redactionPolicy.sha,
    redactionPolicyVersion: redactionPolicy.version,
  });
  const link = `${input.origin}/doc/${encodeURIComponent(input.docId)}#invite=${encodeURIComponent(
    token.token,
  )}`;
  const record: InviteRecord = {
    jti: token.jti,
    docId: input.docId,
    email: input.email,
    scope: input.scope,
    token: token.token,
    link,
    expiresAt: input.expiresAt,
    createdAt,
    revokedAt: null,
    status: input.expiresAt && input.expiresAt <= createdAt ? 'expired' : 'active',
  };
  const records = normalizeInviteRecords(input.storage).filter(
    (existing) => existing.jti !== record.jti,
  );
  records.push(record);
  saveInviteRecords(input.storage, records);
  return record;
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

export const inviteTokenFromLocation = (location: Location) => {
  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  const params = new URLSearchParams(hash);
  return params.get('invite');
};

export const validateInviteAccess = async (
  storage: Storage,
  docId: string,
  token: string | null,
): Promise<InviteAccess | null> => {
  if (!token) return null;
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
