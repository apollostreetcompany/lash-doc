/**
 * @lash/mentions — @user/@group/@date providers, natural-date parsing, RBAC-aware resolvers.
 * Status: SCAFFOLD — implement in M3/D1 (users/groups/dates) and M3/D2 (advanced chips).
 *
 * RBAC concern: providers MUST return `MentionResolveResult` from `@lash/types`,
 * which is a discriminated union — visible mentions carry refId/display, hidden
 * mentions carry only `anonymizedDisplay`. Provider implementations route every
 * decision through `@lash/rbac` to keep policy in one place.
 */

import type { PolicyEngine } from '@lash/rbac';
import type { MentionResolveResult } from '@lash/types';

export interface MentionContext {
  /** The caller's user id; used by RBAC filter. */
  callerId: string;
  /** Locale for date parsing/display. */
  locale: string;
  /** IANA timezone for date parsing. */
  timezone: string;
}

export interface MentionProvider {
  /** Resolve a `@<query>` prefix to candidates. Each candidate is either a
   *  visible mention or an anonymized one — never partially populated. */
  resolve(query: string, ctx: MentionContext): Promise<MentionResolveResult[]>;
}

export const createUserMentionProvider = (_config: {
  policy: PolicyEngine;
  /** Loads user records by id or display search. */
  users: { search(query: string): Promise<{ id: string; displayName: string }[]> };
}): MentionProvider => {
  throw new Error('createUserMentionProvider: not implemented (M3/D1)');
};

export const createGroupMentionProvider = (_config: {
  policy: PolicyEngine;
  groups: { search(query: string): Promise<{ id: string; displayName: string }[]> };
}): MentionProvider => {
  throw new Error('createGroupMentionProvider: not implemented (M3/D1)');
};

/** Pure function — same input always returns same result. Returns a visible
 *  date mention (no RBAC needed since dates are not access-controlled). */
export const parseDateMention = (
  _input: string,
  _ctx: Pick<MentionContext, 'locale' | 'timezone'>,
): MentionResolveResult | null => {
  throw new Error('parseDateMention: not implemented (M3/D1)');
};
