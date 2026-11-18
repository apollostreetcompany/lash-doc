import type { PolicyEngine, Target } from '@lash/rbac';
import type { MentionResolveResult, VisibleMentionResult } from '@lash/types';

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
const dayMs = 24 * 60 * 60 * 1000;

// Encode the local clock fields as UTC so they can be compared without the host's timezone.
const localClock = (formatter: Intl.DateTimeFormat, instant: number): number => {
  const parts = formatter.formatToParts(instant);
  const field = (name: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === name)?.value);
  return Date.UTC(field('year'), field('month') - 1, field('day'), field('hour'), field('minute'));
};

const formatOffset = (offsetMinutes: number): string => {
  if (offsetMinutes === 0) return 'Z';
  const sign = offsetMinutes > 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
};

export const parseDateMention = (
  input: string,
  ctx: Pick<MentionContext, 'locale' | 'timezone' | 'now'>,
): VisibleMentionResult | null => {
  const match = input
    .trim()
    .toLowerCase()
    .match(/^(today|tomorrow|next\s+(\w+))(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  const [, relative, day, hours, minutes, ampm] = match;
  const weekday = dayIndexes[day];
  let hour = Number(hours);
  const minute = Number(minutes ?? '0');
  if ((day && weekday === undefined) || minute > 59 || (ampm ? hour < 1 || hour > 12 : hour > 23))
    return null;
  if (ampm) hour = (hour % 12) + (ampm === 'pm' ? 12 : 0);

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: ctx.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const now = ctx.now ? Date.parse(ctx.now) : Date.now();
    const today = new Date(localClock(formatter, now));
    const distance = day
      ? (weekday - today.getUTCDay() + 7) % 7 || 7
      : Number(relative === 'tomorrow');
    today.setUTCDate(today.getUTCDate() + distance);
    const wall = today.setUTCHours(hour, minute, 0, 0);

    // Check both sides of a timezone transition. A skipped local time has no
    // matching instant; when the clock repeats, use the first occurrence.
    const instants = [wall - dayMs, wall + dayMs]
      .map((probe) => wall - (localClock(formatter, probe) - probe))
      .filter((instant) => localClock(formatter, instant) === wall)
      .sort((left, right) => left - right);
    const instant = instants[0];
    if (instant === undefined) return null;

    const iso = `${today.toISOString().slice(0, 19)}${formatOffset((wall - instant) / 60000)}`;
    const display = new Intl.DateTimeFormat(ctx.locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: ctx.timezone,
    }).format(instant);

    return { visible: true, kind: 'date', refId: `date:${iso}`, display, iso };
  } catch {
    return null;
  }
};
