/**
 * @lash/share — share-link signing/expiry, audit hooks, redaction policy.
 */

import {
  canonicalize,
  hashCanonical,
  type DiffJSON,
  type DiffSpan,
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
  revoke(jti: string, revokedBy: string, reason?: string, docId?: DocumentId): Promise<void>;
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
        await config.audit.record({
          ts: config.now?.() ?? new Date().toISOString(),
          actorId: stored.issuedBy,
          action: 'share-link.revoked',
          docId: stored.docId,
          reason: 'revoked',
        });
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
    async revoke(jti, revokedBy, reason, docId) {
      // Revocation must not depend on this signer instance having issued the
      // token: a freshly constructed signer (or a different process) must be
      // able to revoke any jti. We prefer the in-memory token's docId when
      // available, otherwise fall back to the caller-supplied docId.
      const token = issued.get(jti);
      const resolvedDocId = token?.docId ?? docId;
      const now = config.now?.() ?? new Date().toISOString();
      await config.revocations.revoke({
        jti,
        revokedAt: now,
        revokedBy,
        reason,
      });
      if (resolvedDocId) {
        await config.audit.record({
          ts: now,
          actorId: revokedBy,
          action: 'share-link.revoked',
          docId: resolvedDocId,
          reason,
        });
      }
    },
  };
};

/**
 * Returns the identity tokens a redaction rule `path` may target on a span.
 * A rule matches a span when its `path` equals one of these tokens. Supported
 * forms (most general first):
 *   - `*` / `spans`            — every span
 *   - `spans.text`            — every text-bearing (inserted/deleted) span
 *   - `<kind>` / `kind:<kind>` — spans of that DiffSpanKind
 *   - `id:<id>`               — a single span by stable id
 *   - `entry:<entryId>`       — spans produced by a HistoryEntry
 *   - `author:<authorId>`     — spans by an author
 *   - `actor:<actorType>`     — spans by an actor type (e.g. ai)
 * This gives the typed RedactionPolicy real per-path targeting against the
 * diff model without inventing a parallel addressing scheme, while keeping the
 * existing `spans.text` convention used by the web/test policies working.
 */
const spanPathTokens = (span: DiffSpan): string[] => {
  const tokens: string[] = ['*', 'spans', span.kind, `kind:${span.kind}`, `id:${span.id}`];
  if (span.kind === 'inserted' || span.kind === 'deleted') tokens.push('spans.text');
  if (span.entryId) tokens.push(`entry:${span.entryId}`);
  if (span.authorId) tokens.push(`author:${span.authorId}`);
  if (span.actorType) tokens.push(`actor:${span.actorType}`);
  return tokens;
};

const ruleMatchesSpan = (rulePath: string, span: DiffSpan): boolean =>
  spanPathTokens(span).includes(rulePath);

/** Deterministic, non-reversible placeholder for `hash` actions. */
const hashPlaceholder = (text: string): string => {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return `[hashed:${(h >>> 0).toString(16).padStart(8, '0')}]`;
};

/**
 * Applies a RedactionPolicy to a diff, honoring each rule's `path` (per-span
 * targeting) and `action`:
 *   - `redact` replaces span text with a placeholder and flags `redacted`.
 *   - `hash` replaces span text with a deterministic, non-reversible digest.
 *   - `omit` drops the span from the output entirely.
 * Only inserted/deleted spans carry text and are eligible for redact/hash;
 * any span kind may be omitted. The first matching rule for a span wins.
 */
export const redactDiff = (
  diff: DiffJSON,
  policy: RedactionPolicy,
  _callerId: string,
): DiffJSON => {
  if (!policy.rules.length) return diff;
  const spans: DiffSpan[] = [];
  for (const span of diff.spans) {
    const rule = policy.rules.find((r) => ruleMatchesSpan(r.path, span));
    if (!rule) {
      spans.push({ ...span });
      continue;
    }
    if (rule.action === 'omit') {
      continue;
    }
    if (span.kind === 'inserted' || span.kind === 'deleted') {
      const text = rule.action === 'hash' ? hashPlaceholder(span.text) : '[redacted]';
      spans.push({ ...span, text, redacted: true });
      continue;
    }
    // No text to mask on this span kind; mark it redacted so consumers render
    // a placeholder while keeping the span (and its counts) present.
    spans.push({ ...span, redacted: true });
  }
  return { ...diff, spans };
};

/**
 * Resolves the active policy via the PolicyStore, then redacts the diff with it.
 * Use this when callers hold a policy sha+version rather than a resolved policy.
 * Throws if the policy cannot be resolved so a missing policy never silently
 * yields an unredacted diff.
 */
export const redactDiffWithPolicy = async (
  diff: DiffJSON,
  policies: PolicyStore,
  policySha: string,
  version: number,
  callerId: string,
): Promise<DiffJSON> => {
  const policy = await policies.resolve(policySha, version);
  if (!policy) {
    throw new Error(
      `redactDiffWithPolicy: unresolved redaction policy (sha=${policySha}, version=${version}).`,
    );
  }
  return redactDiff(diff, policy, callerId);
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

export const createAuditLog = (config: { adapter: 'memory' | 'postgres' }): AuditLog => {
  // The 'postgres' adapter is not backed by durable storage in this package.
  // Rather than silently degrading to in-memory (which would misrepresent the
  // durability the API implies), fail loudly so callers must wire a real
  // durable AuditLog before requesting it.
  if (config.adapter === 'postgres') {
    throw new Error(
      "createAuditLog: 'postgres' adapter is not implemented in @lash/share; supply a durable AuditLog implementation or use adapter:'memory'.",
    );
  }
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
