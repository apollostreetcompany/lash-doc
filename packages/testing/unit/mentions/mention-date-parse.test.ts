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
});
