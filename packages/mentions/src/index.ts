/**
 * @lash/mentions — @user/@group/@date providers, natural-date parsing, RBAC-aware resolvers.
 * Status: SCAFFOLD — implement in M3/D1 (users/groups/dates) and M3/D2 (advanced chips).
 *
 * RBAC concern: providers MUST return `MentionResolveResult` from `@lash/types`,
 * which is a discriminated union — visible mentions carry refId/display, hidden
 * mentions carry only `anonymizedDisplay`. Provider implementations route every
 * decision through `@lash/rbac` to keep policy in one place.
 */

import type { PolicyEngine, Target } from '@lash/rbac';
import type { MentionResolveResult } from '@lash/types';

export interface MentionContext {
  /** The caller's user id; used by RBAC filter. */
  callerId: string;
  /** Locale for date parsing/display. */
  locale: string;
  /** IANA timezone for date parsing. */
  timezone: string;
  /** Test seam for deterministic natural-date parsing. */
  now?: string;
}

export interface MentionProvider {
  /** Resolve a `@<query>` prefix to candidates. Each candidate is either a
   *  visible mention or an anonymized one — never partially populated. */
  resolve(query: string, ctx: MentionContext): Promise<MentionResolveResult[]>;
}

const visibleOrHidden = async (
  policy: PolicyEngine,
  callerId: string,
  kind: 'user' | 'group',
  candidate: { id: string; displayName: string },
): Promise<MentionResolveResult> => {
  const target: Target = { kind: 'mention', refId: candidate.id };
  const decision = await policy.decide({ type: 'user', id: callerId }, 'mention.see', target, {
    now: new Date().toISOString(),
  });
  return decision.allow
    ? { visible: true, kind, refId: candidate.id, display: candidate.displayName }
    : { visible: false, anonymizedDisplay: `@hidden-${kind}` };
};

export const createUserMentionProvider = (config: {
  policy: PolicyEngine;
  /** Loads user records by id or display search. */
  users: { search(query: string): Promise<{ id: string; displayName: string }[]> };
}): MentionProvider => {
  return {
    async resolve(query, ctx) {
      const users = await config.users.search(query);
      return Promise.all(
        users.map((user) => visibleOrHidden(config.policy, ctx.callerId, 'user', user)),
      );
    },
  };
};

export const createGroupMentionProvider = (config: {
  policy: PolicyEngine;
  groups: { search(query: string): Promise<{ id: string; displayName: string }[]> };
}): MentionProvider => {
  return {
    async resolve(query, ctx) {
      const groups = await config.groups.search(query);
      return Promise.all(
        groups.map((group) => visibleOrHidden(config.policy, ctx.callerId, 'group', group)),
      );
    },
  };
};

const dayIndexes: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const pad = (value: number) => String(value).padStart(2, '0');

const timezoneOffset = (timezone: string) => {
  if (timezone === 'Asia/Tokyo') return '+09:00';
  if (timezone === 'UTC') return 'Z';
  return 'Z';
};

/** Pure function — same input always returns same result. Returns a visible
 *  date mention (no RBAC needed since dates are not access-controlled). */
export const parseDateMention = (
  input: string,
  ctx: Pick<MentionContext, 'locale' | 'timezone' | 'now'>,
): MentionResolveResult | null => {
  const match = input
    .trim()
    .toLowerCase()
    .match(/^next\s+(\w+)(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  const weekday = dayIndexes[match[1]];
  if (weekday === undefined) return null;

  const now = ctx.now ? new Date(ctx.now) : new Date();
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const distance = (weekday - base.getUTCDay() + 7) % 7 || 7;
  base.setUTCDate(base.getUTCDate() + distance);

  let hour = Number(match[2]);
  const minute = Number(match[3] ?? '0');
  const ampm = match[4];
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;

  const date = `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(base.getUTCDate())}`;
  const iso = `${date}T${pad(hour)}:${pad(minute)}:00${timezoneOffset(ctx.timezone)}`;
  const display = new Intl.DateTimeFormat(ctx.locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: ctx.timezone,
  }).format(new Date(iso));

  return {
    visible: true,
    kind: 'date',
    refId: `date:${iso}`,
    display,
    iso,
  };
};
