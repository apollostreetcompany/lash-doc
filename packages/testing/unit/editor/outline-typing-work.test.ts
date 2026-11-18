/** @vitest-environment jsdom */

import { createLashEditorExtensions, getOutlineItems } from '@lash/editor-core';
import { Editor, type JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  vi.restoreAllMocks();
});

function createEditor(content: string | JSONContent) {
  editor = new Editor({ extensions: createLashEditorExtensions(), content });
  return editor;
}

describe('outline typing work', () => {
  it('does not rescan the root from the start for each heading while typing in a 50,000-word document', () => {
    const paragraphText = Array.from({ length: 100 }, (_, index) => `word${index}`).join(' ');
    const activeEditor = createEditor({
      type: 'doc',
      content: Array.from({ length: 500 }, (_, index) => ({
        type: index % 12 === 0 ? 'heading' : 'paragraph',
        attrs: index % 12 === 0 ? { level: 2, headingId: `section-${index}` } : undefined,
        content: [{ type: 'text', text: paragraphText }],
      })),
    });
    const state = activeEditor.state;
    const transaction = state.tr.insertText('!', state.doc.content.size - 1);
    const scans = vi.spyOn(transaction.doc, 'nodesBetween');
    const updatedState = state.apply(transaction);
    const outline = getOutlineItems(updatedState);

    expect(outline).toHaveLength(42);
    expect(outline[0]?.hiddenBlockCount).toBe(11);
    expect(outline.at(-1)?.hiddenBlockCount).toBe(7);
    expect(outline.at(-1)?.contentTo).toBe(updatedState.doc.content.size);
    expect(scans.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it('keeps section counts and positions for headings nested inside a list item', () => {
    const activeEditor = createEditor(`
      <h1 data-heading-id="chapter">Chapter</h1>
      <ul><li>
        <p>Opening</p>
        <h2 data-heading-id="inside">Inside</h2>
        <p>Notes</p>
        <h2 data-heading-id="inside-next">Inside next</h2>
      </li></ul>
      <h1 data-heading-id="next">Next</h1>
      <p>Closing</p>
    `);
    const { state } = activeEditor;
    const outline = getOutlineItems(state);
    expect(
      outline.map(({ headingId, descendantCount, hiddenBlockCount }) => ({
        headingId,
        descendantCount,
        hiddenBlockCount,
      })),
    ).toEqual([
      { headingId: 'chapter', descendantCount: 2, hiddenBlockCount: 1 },
      { headingId: 'inside', descendantCount: 0, hiddenBlockCount: 1 },
      { headingId: 'inside-next', descendantCount: 0, hiddenBlockCount: 1 },
      { headingId: 'next', descendantCount: 0, hiddenBlockCount: 1 },
    ]);
    for (const item of outline) {
      expect(state.doc.nodeAt(item.from)?.textContent).toBe(item.title);
    }
  });
});
