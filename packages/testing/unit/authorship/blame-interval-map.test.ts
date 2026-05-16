import { createAuthorshipMap } from '@lash/authorship';
import { createDocumentId, type HistoryEntry } from '@lash/types';
import { describe, expect, it } from 'vitest';

const entry = (
  id: string,
  authorId: string,
  ops: HistoryEntry['ops'],
  ts = '2026-05-16T04:10:00.000Z',
): HistoryEntry => ({
  id,
  docId: createDocumentId('authorship-doc'),
  actor: { type: 'user', id: authorId },
  ts,
  parentSha: `${id}-parent`,
  resultSha: `${id}-result`,
  seq: Number(id.replace(/\D/g, '') || 1),
  schemaVersion: 'lash-schema-v1',
  ops,
  intent: 'edit',
  audit: { ua: 'vitest/authorship' },
});

describe('blame-interval-map', () => {
  it('records inserted text intervals from history entries', () => {
    const map = createAuthorshipMap();
    map.recordEntry(entry('e1', 'ada', [{ op: 'replace_text', from: 0, to: 0, text: 'Hello' }]));

    expect(map.intervalsIn(0, 5)).toMatchObject([
      { from: 0, to: 5, authorId: 'ada', sourceEntryId: 'e1', sourceOpIndex: 0 },
    ]);
    expect(map.authorAt(1)).toBe('ada');
    expect(map.authorAt(5)).toBeNull();
  });

  it('maps attribution through insertions, deletes, and replacements', () => {
    const map = createAuthorshipMap();
    map.recordEntry(
      entry('e1', 'ada', [{ op: 'replace_text', from: 0, to: 0, text: 'Hello world' }]),
    );
    map.recordEntry(entry('e2', 'lin', [{ op: 'replace_text', from: 5, to: 5, text: ',' }]));
    map.recordEntry(entry('e3', 'sam', [{ op: 'replace_text', from: 7, to: 12, text: 'Lash' }]));

    expect(map.intervalsIn(0, 11)).toMatchObject([
      { from: 0, to: 5, authorId: 'ada' },
      { from: 5, to: 6, authorId: 'lin' },
      { from: 6, to: 7, authorId: 'ada' },
      { from: 7, to: 11, authorId: 'sam' },
    ]);
    expect(map.authorAt(8)).toBe('sam');
  });

  it('returns dominant authors per line', () => {
    const map = createAuthorshipMap();
    map.recordEntry(entry('e1', 'ada', [{ op: 'replace_text', from: 0, to: 0, text: 'One\nTwo' }]));
    map.recordEntry(entry('e2', 'lin', [{ op: 'replace_text', from: 4, to: 7, text: 'Second' }]));

    expect(map.blameByLine('One\nSecond')).toEqual([
      { line: 1, authorId: 'ada' },
      { line: 2, authorId: 'lin' },
    ]);
  });
});
