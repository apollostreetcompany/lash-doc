/**
 * @lash/mentions — @user/@group/@date providers, natural-date parsing, RBAC-aware resolvers.
 * Status: SCAFFOLD — implement in M3/D1 (users/groups/dates) and M3/D2 (advanced chips).
 */

import type { MentionResolveResult } from '@lash/types';

export interface MentionContext {
  /** the caller's user id; used by RBAC filter */
  callerId: string;
  /** locale for date parsing/display */
  locale: string;
  /** IANA timezone for date parsing */
  timezone: string;
}

export interface MentionProvider {
  resolve(query: string, ctx: MentionContext): Promise<MentionResolveResult[]>;
}

export const createUserMentionProvider = (
  _config: { rbac: { canSee(callerId: string, targetId: string): boolean } },
): MentionProvider => {
  throw new Error('createUserMentionProvider: not implemented (M3/D1)');
};

export const createGroupMentionProvider = (
  _config: { rbac: { canSee(callerId: string, targetId: string): boolean } },
): MentionProvider => {
  throw new Error('createGroupMentionProvider: not implemented (M3/D1)');
};

export const parseDateMention = (
  _input: string,
  _ctx: Pick<MentionContext, 'locale' | 'timezone'>,
): MentionResolveResult | null => {
  throw new Error('parseDateMention: not implemented (M3/D1)');
};
