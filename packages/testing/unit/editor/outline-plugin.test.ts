/** @vitest-environment jsdom */

import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import {
  createLashEditorExtensions,
  createMemoryOutlinePersistence,
  getOutlineItems,
} from '@lash/editor-core';

const SAMPLE_DOCUMENT = `
  <h1>Chapter One</h1>
  <p>Opening paragraph.</p>
  <h2>Section Alpha</h2>
  <p>Alpha body one.</p>
  <p>Alpha body two.</p>
  <h3>Deep Dive</h3>
  <p>Nested insight.</p>
  <h2>Section Beta</h2>
  <p>Beta body.</p>
`;

describe('Outline plugin', () => {
  const createEditor = () => {
    const persistence = createMemoryOutlinePersistence();
    const editor = new Editor({
      extensions: createLashEditorExtensions({
        outline: {
          documentId: 'test-doc',
          persistence,
        },
      }),
      content: SAMPLE_DOCUMENT,
    });
    return { editor, persistence };
  };

  it('surfaces headings with counts and collapse state', () => {
    const { editor, persistence } = createEditor();
    const outline = getOutlineItems(editor.state);
    expect(outline).toHaveLength(4);

    const alpha = outline.find((item) => item.title === 'Section Alpha');
    expect(alpha).toBeTruthy();
    expect(alpha?.collapsed).toBe(false);
    expect(alpha?.descendantCount).toBe(1);
    expect(alpha?.hiddenBlockCount).toBeGreaterThanOrEqual(2);

    editor.commands.toggleHeadingCollapse(alpha!.headingId);

    const updated = getOutlineItems(editor.state);
    const collapsedAlpha = updated.find((item) => item.title === 'Section Alpha');
    expect(collapsedAlpha?.collapsed).toBe(true);

    const stored = persistence.load('test-doc');
    expect(stored).toContain(alpha!.headingId);

    editor.destroy();
  });

  it('moves selection to next visible block when collapsing', () => {
    const { editor } = createEditor();
    const outline = getOutlineItems(editor.state);
    const alpha = outline.find((item) => item.title === 'Section Alpha');
    const beta = outline.find((item) => item.title === 'Section Beta');

    expect(alpha).toBeTruthy();
    expect(beta).toBeTruthy();

    editor
      .chain()
      .setTextSelection({ from: alpha!.contentFrom + 2, to: alpha!.contentFrom + 2 })
      .run();

    editor.commands.toggleHeadingCollapse(alpha!.headingId);

    const selectionText = editor.state.doc.textBetween(
      editor.state.selection.from,
      Math.min(editor.state.selection.from + beta!.title.length, editor.state.doc.content.size),
      '\n',
      '\n',
    );

    expect(selectionText).toContain('Section Beta');

    editor.destroy();
  });
});
