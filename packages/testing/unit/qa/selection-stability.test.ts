import { createAnchor, mapAnchor } from '@lash/doc-chat';
import { describe, expect, it } from 'vitest';

describe('selection-stability', () => {
  it('keeps an anchored selection on the same token after surrounding edits', () => {
    const baseText = 'Alpha target omega';
    const anchor = createAnchor({
      baseVersion: 'v1',
      docText: baseText,
      from: 6,
      to: 12,
    });

    const mapped = mapAnchor({
      anchor,
      baseDoc: { text: baseText },
      ops: [{ op: 'replace_text', from: 0, to: 0, text: 'Intro ' }],
      currentDoc: { text: 'Intro Alpha target omega' },
      targetVersion: 'v2',
    });

    expect(mapped.orphaned).toBe(false);
    expect(mapped.from).toBe(12);
    expect(mapped.to).toBe(18);
    expect('Intro Alpha target omega'.slice(mapped.from, mapped.to)).toBe('target');
  });

  it('pins to the nearest valid position and marks orphaned when selected text is deleted', () => {
    const baseText = 'Alpha target omega';
    const anchor = createAnchor({
      baseVersion: 'v1',
      docText: baseText,
      from: 6,
      to: 12,
    });

    const mapped = mapAnchor({
      anchor,
      baseDoc: { text: baseText },
      ops: [{ op: 'delete_range', from: 6, to: 12 }],
      currentDoc: { text: 'Alpha omega' },
      targetVersion: 'v2',
    });

    expect(mapped.orphaned).toBe(true);
    expect(mapped.from).toBe(6);
    expect(mapped.to).toBe(6);
  });
});
