import { parseDateMention } from '@lash/mentions';
import { describe, expect, test } from 'vitest';

describe('mention-date-parse', () => {
  test('parses next Friday 3pm into caller timezone ISO', () => {
    const mention = parseDateMention('next Friday 3pm', {
      locale: 'en-US',
      timezone: 'Asia/Tokyo',
      now: '2026-05-16T00:00:00.000Z',
    });

    expect(mention).toMatchObject({
      visible: true,
      kind: 'date',
      iso: '2026-05-22T15:00:00+09:00',
    });
  });

  test('uses the local calendar when it disagrees with the UTC day', () => {
    expect(
      parseDateMention('next Friday 3pm', {
        locale: 'en-US',
        timezone: 'America/Los_Angeles',
        now: '2026-06-19T02:00:00Z',
      })?.iso,
    ).toBe('2026-06-19T15:00:00-07:00');
  });

  test('rejects an invalid clock time and resolves real daylight-saving times', () => {
    const ctx = { locale: 'en-US', timezone: 'America/New_York', now: '2026-03-07T18:00:00Z' };
    expect(parseDateMention('tomorrow 2:30am', ctx)).toBeNull();
    expect(parseDateMention('tomorrow 3:30am', ctx)?.iso).toBe('2026-03-08T03:30:00-04:00');
    expect(parseDateMention('today 12:60pm', ctx)).toBeNull();
    expect(parseDateMention('today 13pm', ctx)).toBeNull();
    expect(parseDateMention('tomorrow 1:30am', { ...ctx, now: '2026-10-31T18:00:00Z' })?.iso).toBe(
      '2026-11-01T01:30:00-04:00',
    );
  });
});
