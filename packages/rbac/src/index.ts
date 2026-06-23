/**
 * @lash/rbac — single policy-decision interface used by every feature
 *              that touches permissions: share, mentions, chips, history,
 *              chat, AI orchestration, API reads.
 *
 * Status: SCAFFOLD — typed contract only. Implementations land alongside
 * M3/D3 (share + redaction) but the interface is frozen now so M3/D1
 * (mentions), M3/D4 (doc chat), and M5 (apps/api) can compile against it.
 *
 * Integration scope (this milestone): decide() is fully implemented per the
 * frozen contract below, but it is INTENTIONALLY wired into the mentions
 * surface only (see packages/mentions/src/index.ts). The history and chat
 * views do NOT route through decide() yet — history redaction is applied ad
 * hoc via @lash/share redactDiff, and the chat-transcript indicator is a
 * presentational badge (F-C17-03). This is a deliberate, drafted milestone
 * boundary, not a defect: the 'redacted' refusal path and uniform
 * enforcement across history/chat are scheduled to land when those views are
 * migrated onto decide(). Until then, treat mentions/chips as the only
 * call sites that enforce policy through this engine.
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
  | {
      allow: false;
      reason: 'no-access' | 'expired' | 'revoked' | 'scope-mismatch' | 'redacted' | 'rate-limited';
    };

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

export const createPolicyEngine = (config: {
  /** Adapter that loads share-link revocations by `jti`. */
  revocations: { isRevoked(jti: string): Promise<boolean> };
  /** Adapter that loads mention/group visibility for a user. */
  visibility: { canSee(userId: string, target: Target): Promise<boolean> };
}): PolicyEngine => {
  return {
    capabilitiesForScope,
    async decide(subject, cap, target, ctx) {
      if (subject.type === 'anonymous') {
        return { allow: false, reason: 'no-access' };
      }

      if (subject.type === 'share-link') {
        if (subject.token.expiresAt && subject.token.expiresAt <= ctx.now) {
          return { allow: false, reason: 'expired' };
        }
        if (await config.revocations.isRevoked(subject.token.jti)) {
          return { allow: false, reason: 'revoked' };
        }
        return capabilitiesForScope(subject.token.scope).includes(cap)
          ? { allow: true }
          : { allow: false, reason: 'scope-mismatch' };
      }

      if (target.kind === 'mention' || target.kind === 'chip') {
        return (await config.visibility.canSee(subject.id, target))
          ? { allow: true }
          : { allow: false, reason: 'redacted' };
      }

      return { allow: true };
    },
  };
};

/** Pure helper — exposed standalone so callers don't need a full engine
 *  instance for static scope-to-capability mapping. */
export const capabilitiesForScope = (scope: ShareScope): readonly Capability[] => {
  switch (scope) {
    case 'view':
      return ['doc.read', 'doc.history.read', 'mention.see', 'chip.preview'];
    case 'comment':
      return [
        'doc.read',
        'doc.history.read',
        'mention.see',
        'chip.preview',
        'doc.comment',
        'doc.suggest',
      ];
    case 'suggest':
      return [
        'doc.read',
        'doc.history.read',
        'mention.see',
        'chip.preview',
        'doc.comment',
        'doc.suggest',
      ];
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
