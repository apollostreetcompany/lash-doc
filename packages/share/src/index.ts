/**
 * @lash/share — share-link signing/expiry, audit hooks, redaction policy.
 */

import {
  canonicalize,
  hashCanonical,
  type DiffJSON,
  type DocumentId,
  type RevocationRecord,
  type ShareScope,
  type ShareToken,
} from '@lash/types';

export interface RevocationStore {
  isRevoked(jti: string): Promise<boolean>;
  revoke(record: RevocationRecord): Promise<void>;
  listFor(docId: DocumentId): Promise<RevocationRecord[]>;
}

export interface PolicyStore {
  resolve(policySha: string, version: number): Promise<RedactionPolicy | null>;
}

export interface RedactionPolicy {
  /** sha256 of canonicalize(this without sha) in production; local policies use stable ids. */
  sha: string;
  version: number;
  rules: Array<{ path: string; action: 'redact' | 'omit' | 'hash' }>;
}

export interface ShareSigner {
  sign(input: {
    docId: DocumentId;
    scope: ShareScope;
    expiresAt: string | null;
    issuedBy: string;
    redactionPolicy: string;
    redactionPolicyVersion: number;
  }): Promise<ShareToken>;
  validate(
    token: string,
  ): Promise<
    { ok: true; token: ShareToken } | { ok: false; reason: 'expired' | 'invalid' | 'revoked' }
  >;
  revoke(jti: string, revokedBy: string, reason?: string): Promise<void>;
}

export interface CreateShareSignerConfig {
  secret: string;
  revocations: RevocationStore;
  policies: PolicyStore;
  audit: AuditLog;
  now?: () => string;
}

const encode = (value: unknown): string =>
  btoa(unescape(encodeURIComponent(canonicalize(value))))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');

const decode = <T>(value: string): T => {
  const padded = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  return JSON.parse(decodeURIComponent(escape(atob(padded)))) as T;
};

const signPayload = (payload: unknown, secret: string) => hashCanonical({ payload, secret });

export const createShareSigner = (config: CreateShareSignerConfig): ShareSigner => {
  const issued = new Map<string, ShareToken>();

  return {
    async sign(input) {
      const issuedAt = config.now?.() ?? new Date().toISOString();
      const jti = (await hashCanonical({ ...input, issuedAt })).slice(0, 24);
      const payload = { ...input, jti };
      const signature = await signPayload(payload, config.secret);
      const token = `${encode(payload)}.${signature}`;
      const shareToken: ShareToken = {
        jti,
        token,
        ...input,
      };
      issued.set(jti, shareToken);
      await config.audit.record({
        ts: issuedAt,
        actorId: input.issuedBy,
        action: 'share-link.created',
        docId: input.docId,
        ua: 'lash-share/local',
      });
      return shareToken;
    },
    async validate(token) {
      const [payloadPart, signature] = token.split('.');
      if (!payloadPart || !signature) {
        return { ok: false, reason: 'invalid' };
      }
      let payload: Omit<ShareToken, 'token'>;
      try {
        payload = decode<Omit<ShareToken, 'token'>>(payloadPart);
      } catch {
        return { ok: false, reason: 'invalid' };
      }
      const expected = await signPayload(payload, config.secret);
      if (expected !== signature) {
        await config.audit.record({
          ts: config.now?.() ?? new Date().toISOString(),
          actorId: 'anonymous',
          action: 'share-link.invalid',
          docId: payload.docId,
          reason: 'signature',
        });
        return { ok: false, reason: 'invalid' };
      }
      const stored = issued.get(payload.jti) ?? { ...payload, token };
      if (stored.expiresAt && stored.expiresAt <= (config.now?.() ?? new Date().toISOString())) {
        await config.audit.record({
          ts: config.now?.() ?? new Date().toISOString(),
          actorId: stored.issuedBy,
          action: 'share-link.expired',
          docId: stored.docId,
          reason: 'expired',
        });
        return { ok: false, reason: 'expired' };
      }
      if (await config.revocations.isRevoked(stored.jti)) {
        return { ok: false, reason: 'revoked' };
      }
      await config.audit.record({
        ts: config.now?.() ?? new Date().toISOString(),
        actorId: stored.issuedBy,
        action: 'share-link.access',
        docId: stored.docId,
      });
      return { ok: true, token: { ...stored, token } };
    },
    async revoke(jti, revokedBy, reason) {
      const token = issued.get(jti);
      if (!token) return;
      await config.revocations.revoke({
        jti,
        revokedAt: config.now?.() ?? new Date().toISOString(),
        revokedBy,
        reason,
      });
      await config.audit.record({
        ts: config.now?.() ?? new Date().toISOString(),
        actorId: revokedBy,
        action: 'share-link.revoked',
        docId: token.docId,
        reason,
      });
    },
  };
};

export const redactDiff = (
  diff: DiffJSON,
  policy: RedactionPolicy,
  _callerId: string,
): DiffJSON => {
  if (!policy.rules.length) return diff;
  return {
    ...diff,
    spans: diff.spans.map((span) => {
      if (span.kind !== 'inserted' && span.kind !== 'deleted') {
        return { ...span };
      }
      return { ...span, text: '[redacted]', redacted: true };
    }),
  };
};

export interface AuditEvent {
  /** ISO-8601 UTC */
  ts: string;
  actorId: string;
  action:
    | 'share-link.access'
    | 'share-link.expired'
    | 'share-link.revoked'
    | 'share-link.created'
    | 'share-link.invalid';
  docId: DocumentId;
  reason?: string;
  /** sha256 of source IP */
  ipHash?: string;
  ua?: string;
}

export interface AuditLog {
  record(event: AuditEvent): Promise<void>;
  query(filter: { docId?: DocumentId; since?: string }): Promise<AuditEvent[]>;
}

export const createAuditLog = (_config: { adapter: 'memory' | 'postgres' }): AuditLog => {
  const events: AuditEvent[] = [];
  return {
    async record(event) {
      events.push({ ...event });
    },
    async query(filter) {
      return events.filter((event) => {
        if (filter.docId && event.docId !== filter.docId) return false;
        if (filter.since && event.ts < filter.since) return false;
        return true;
      });
    },
  };
};

export const createMemoryRevocationStore = (): RevocationStore => {
  const records = new Map<string, RevocationRecord>();
  return {
    async isRevoked(jti) {
      return records.has(jti);
    },
    async revoke(record) {
      records.set(record.jti, { ...record });
    },
    async listFor() {
      return Array.from(records.values()).map((record) => ({ ...record }));
    },
  };
};

export const createStaticPolicyStore = (policy: RedactionPolicy): PolicyStore => ({
  async resolve(policySha, version) {
    return policy.sha === policySha && policy.version === version ? policy : null;
  },
});
