/**
 * @lash/share — share-link signing/expiry, audit hooks, redaction policy.
 * Status: SCAFFOLD — implement in M3/D3.
 *
 * Permission decisions live in `@lash/rbac`; share only owns:
 *   - signing tokens (jti + signature)
 *   - validating signature/expiry/revocation against persisted state
 *   - emitting audit events
 *   - applying a redaction policy to diffs/threads
 *
 * Adapters are injected so the same signer works in apps/api (Postgres) and
 * apps/web/middleware (edge KV) without coupling to a transport.
 */

import type { DocumentId, ShareToken, ShareScope, RevocationRecord, DiffJSON } from '@lash/types';

export interface RevocationStore {
  isRevoked(jti: string): Promise<boolean>;
  revoke(record: RevocationRecord): Promise<void>;
  listFor(docId: DocumentId): Promise<RevocationRecord[]>;
}

export interface PolicyStore {
  /** Resolve a redactionPolicy sha to its full JSON body. */
  resolve(policySha: string, version: number): Promise<RedactionPolicy | null>;
}

export interface RedactionPolicy {
  /** sha256 of canonicalize(this) — must equal the ShareToken.redactionPolicy. */
  sha: string;
  version: number;
  /** Field-level rules. Implementation TBD in M3/D3 — keep generic for now. */
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
  /** Validates signature, expiry, and revocation; called on EVERY read. */
  validate(token: string): Promise<
    | { ok: true; token: ShareToken }
    | { ok: false; reason: 'expired' | 'invalid' | 'revoked' }
  >;
  revoke(jti: string, revokedBy: string, reason?: string): Promise<void>;
}

export interface CreateShareSignerConfig {
  secret: string;
  revocations: RevocationStore;
  policies: PolicyStore;
  audit: AuditLog;
}

export const createShareSigner = (_config: CreateShareSignerConfig): ShareSigner => {
  throw new Error('createShareSigner: not implemented (M3/D3)');
};

/** Strip diff spans the caller cannot see; total counts and span ids preserved
 *  so consumers can render redaction placeholders without UI shift. */
export const redactDiff = (_diff: DiffJSON, _policy: RedactionPolicy, _callerId: string): DiffJSON => {
  throw new Error('redactDiff: not implemented (M3/D3)');
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
  throw new Error('createAuditLog: not implemented (M3/D3)');
};
