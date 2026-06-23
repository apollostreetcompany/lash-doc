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

/**
 * Compute the UTC offset string (e.g. '+09:00', '-04:00', 'Z') that `timezone`
 * is observing at the given wall-clock instant. The instant is supplied as the
 * UTC fields the user typed (year/month/day/hour/minute interpreted as local
 * wall-clock time in `timezone`). We derive the offset from the zone itself via
 * Intl so DST and arbitrary IANA zones are handled correctly, instead of a
 * hard-coded lookup. Failing loudly (throwing) on an unresolvable zone keeps us
 * from silently stamping a wrong offset.
 */
const timezoneOffset = (
  timezone: string,
  wall: { year: number; month: number; day: number; hour: number; minute: number },
): string => {
  // Treat the typed wall-clock fields as if they were UTC to get a probe instant.
  const utcProbe = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);

  // Read back what that probe instant looks like in the target zone. The delta
  // between the zone's rendered wall-clock and the UTC probe is the zone offset.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(utcProbe));

  const field = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    if (!found) {
      throw new Error(`Unable to resolve timezone "${timezone}" (missing ${type})`);
    }
    // Intl can render midnight as hour '24' in some engines; normalize to 0.
    const value = Number(found.value);
    return type === 'hour' && value === 24 ? 0 : value;
  };

  const zoned = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour'),
    field('minute'),
    field('second'),
  );

  // Offset = (wall-clock as rendered in zone) - (UTC probe). Positive east of UTC.
  const offsetMinutes = Math.round((zoned - utcProbe) / 60000);
  if (offsetMinutes === 0) return 'Z';
  const sign = offsetMinutes > 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
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

  const year = base.getUTCFullYear();
  const month = base.getUTCMonth() + 1;
  const day = base.getUTCDate();
  const date = `${year}-${pad(month)}-${pad(day)}`;
  const offset = timezoneOffset(ctx.timezone, { year, month, day, hour, minute });
  const iso = `${date}T${pad(hour)}:${pad(minute)}:00${offset}`;
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
