/**
 * @lash/share — share-link signing/expiry, RBAC enforcement, redaction policy, audit hooks.
 * Status: SCAFFOLD — implement in M3/D3.
 */

import type { DocumentId, ShareToken, ShareScope, DiffJSON } from '@lash/types';

export interface ShareSigner {
  sign(input: { docId: DocumentId; scope: ShareScope; expiresAt: string | null; issuedBy: string }): Promise<ShareToken>;
  /** validates signature, expiry, and revocation; called on EVERY read */
  validate(token: string): Promise<{ ok: true; token: ShareToken } | { ok: false; reason: 'expired' | 'invalid' | 'revoked' }>;
  revoke(token: string): Promise<void>;
}

export const createShareSigner = (_config: { secret: string }): ShareSigner => {
  throw new Error('createShareSigner: not implemented (M3/D3)');
};

/** Strip diff spans the caller cannot see; preserves total counts. */
export const redactDiff = (_diff: DiffJSON, _scope: ShareScope, _callerId: string): DiffJSON => {
  throw new Error('redactDiff: not implemented (M3/D3)');
};

export interface AuditEvent {
  /** ISO-8601 UTC */
  ts: string;
  actorId: string;
  action: 'share-link.access' | 'share-link.expired' | 'share-link.revoked' | 'share-link.created';
  docId: DocumentId;
  reason?: string;
  /** hashed IP */
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
