/**
 * @lash/rbac — single policy-decision interface used by every feature
 *              that touches permissions: share, mentions, chips, history,
 *              chat, AI orchestration, API reads.
 *
 * Status: SCAFFOLD — typed contract only. Implementations land alongside
 * M3/D3 (share + redaction) but the interface is frozen now so M3/D1
 * (mentions), M3/D4 (doc chat), and M5 (apps/api) can compile against it.
 *
 * Why a separate package: proconsult-m0/B P1 #14 — RBAC was previously
 * embedded in @lash/share and @lash/mentions, but permissions are
 * cross-cutting. One policy decision point keeps invariants consistent.
 */

import type { DocumentId, ShareScope, ShareToken } from '@lash/types';

/** A capability the caller is requesting. */
export type Capability =
  | 'doc.read'
  | 'doc.comment'
  | 'doc.suggest'
  | 'doc.edit'
  | 'doc.share'
  | 'doc.history.read'
  | 'doc.history.restore'
  | 'mention.see'
  | 'chip.preview'
  | 'ai.invoke';

/** The subject (caller). May be anonymous (share-link viewer with no user). */
export type Subject =
  | { type: 'user'; id: string }
  | { type: 'share-link'; token: ShareToken }
  | { type: 'anonymous' };

/** The target the subject is acting on. */
export type Target =
  | { kind: 'doc'; id: DocumentId }
  | { kind: 'mention'; refId: string }
  | { kind: 'chip'; refId: string };

/** A policy decision. `allow` is the only positive outcome; everything else
 *  is a refusal with a machine-readable reason for audit. */
export type Decision =
  | { allow: true }
  | { allow: false; reason: 'no-access' | 'expired' | 'revoked' | 'scope-mismatch' | 'redacted' | 'rate-limited' };

export interface PolicyContext {
  /** ISO-8601 ts at decision time (used for share-link expiry checks). */
  now: string;
}

export interface PolicyEngine {
  /** Decide whether `subject` may exercise `cap` against `target`. */
  decide(subject: Subject, cap: Capability, target: Target, ctx: PolicyContext): Promise<Decision>;
  /** Map a share scope to the set of capabilities it grants. Pure function. */
  capabilitiesForScope(scope: ShareScope): readonly Capability[];
}

export const createPolicyEngine = (_config: {
  /** Adapter that loads share-link revocations by `jti`. */
  revocations: { isRevoked(jti: string): Promise<boolean> };
  /** Adapter that loads mention/group visibility for a user. */
  visibility: { canSee(userId: string, target: Target): Promise<boolean> };
}): PolicyEngine => {
  throw new Error('createPolicyEngine: not implemented (M3/D3)');
};

/** Pure helper — exposed standalone so callers don't need a full engine
 *  instance for static scope-to-capability mapping. */
export const capabilitiesForScope = (scope: ShareScope): readonly Capability[] => {
  switch (scope) {
    case 'view':
      return ['doc.read', 'doc.history.read', 'mention.see', 'chip.preview'];
    case 'comment':
      return ['doc.read', 'doc.history.read', 'mention.see', 'chip.preview', 'doc.comment'];
    case 'suggest':
      return ['doc.read', 'doc.history.read', 'mention.see', 'chip.preview', 'doc.comment', 'doc.suggest'];
    case 'edit':
      return [
        'doc.read',
        'doc.history.read',
        'mention.see',
        'chip.preview',
        'doc.comment',
        'doc.suggest',
        'doc.edit',
        'doc.share',
        'doc.history.restore',
        'ai.invoke',
      ];
  }
};
