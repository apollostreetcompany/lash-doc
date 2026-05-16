import { parseDateMention } from '@lash/mentions';
import { describe, expect, test } from 'vitest';

describe('mention-date-locale', () => {
  test('formats date-chip display using caller locale', () => {
    const mention = parseDateMention('next Friday 3pm', {
      locale: 'ja-JP',
      timezone: 'Asia/Tokyo',
      now: '2026-05-16T00:00:00.000Z',
    });

    expect(mention?.visible).toBe(true);
    if (mention?.visible) {
      expect(mention.display).toContain('5月22日');
      expect(mention.iso).toBe('2026-05-22T15:00:00+09:00');
    }
  });
});
