import { createAuthorshipMap } from '@lash/authorship';
import { createDocumentId, type HistoryEntry } from '@lash/types';
import { describe, expect, it } from 'vitest';

const makeEntry = (
  seq: number,
  authorId: string,
  from: number,
  to: number,
  text: string,
): HistoryEntry => ({
  id: `entry-${seq}`,
  docId: createDocumentId('property-doc'),
  actor: { type: 'user', id: authorId },
  ts: `2026-05-16T04:${String(seq).padStart(2, '0')}:00.000Z`,
  parentSha: `parent-${seq}`,
  resultSha: `result-${seq}`,
  seq,
  schemaVersion: 'lash-schema-v1',
  ops: [{ op: 'replace_text', from, to, text }],
  intent: 'edit',
  audit: { ua: 'vitest/authorship-property' },
});

describe('blame-property', () => {
  it('keeps generated attribution intervals ordered, bounded, and non-overlapping', () => {
    const map = createAuthorshipMap();
    let text = '';
    let seed = 17;

    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };

    for (let i = 1; i <= 40; i += 1) {
      const from = text.length ? next() % text.length : 0;
      const maxDelete = text.length - from;
      const deleteCount = maxDelete ? next() % Math.min(3, maxDelete + 1) : 0;
      const inserted = `${String.fromCharCode(97 + (i % 26))}${i % 3 === 0 ? '\n' : ''}`;
      const to = from + deleteCount;
      text = `${text.slice(0, from)}${inserted}${text.slice(to)}`;
      map.recordEntry(makeEntry(i, i % 2 === 0 ? 'ada' : 'lin', from, to, inserted));

      const intervals = map.intervalsIn(0, text.length);
      for (let j = 0; j < intervals.length; j += 1) {
        expect(intervals[j].from).toBeGreaterThanOrEqual(0);
        expect(intervals[j].to).toBeLessThanOrEqual(text.length);
        expect(intervals[j].to).toBeGreaterThan(intervals[j].from);
        if (j > 0) {
          expect(intervals[j - 1].to).toBeLessThanOrEqual(intervals[j].from);
        }
      }
    }
  });
});
