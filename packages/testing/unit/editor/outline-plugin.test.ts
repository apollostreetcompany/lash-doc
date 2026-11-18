/** @vitest-environment jsdom */

import {
  createLashEditorExtensions,
  createMemoryOutlinePersistence,
  getOutlineItems,
} from '@lash/editor-core';
import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

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

  it('repairs duplicate heading ids deterministically after a split or import', () => {
    const { editor } = createEditor();
    editor.commands.setContent(
      '<h2 data-heading-id="duplicate">First</h2><h2 data-heading-id="duplicate">Second</h2>',
    );

    const headingIds = editor
      .getJSON()
      .content?.filter((node) => node.type === 'heading')
      .map((node) => node.attrs?.headingId);

    expect(headingIds).toHaveLength(2);
    expect(headingIds?.[0]).toBe('duplicate');
    expect(headingIds?.[1]).toMatch(/^heading-/u);
    expect(new Set(headingIds).size).toBe(2);

    editor.destroy();
  });

  it('reserves a later valid heading id before assigning an earlier missing id', () => {
    const { editor } = createEditor();
    editor.commands.setContent(
      '<h2>Missing id</h2><h2 data-heading-id="heading-0">Reserved owner</h2>',
    );

    const headingIds = editor
      .getJSON()
      .content?.filter((node) => node.type === 'heading')
      .map((node) => node.attrs?.headingId);

    expect(headingIds).toHaveLength(2);
    expect(headingIds?.[0]).not.toBe('heading-0');
    expect(headingIds?.[1]).toBe('heading-0');
    expect(new Set(headingIds).size).toBe(2);

    editor.destroy();
  });

  it('assigns heading ids in the initial H1/H2/H3 conversion transaction', () => {
    for (const level of [1, 2, 3] as const) {
      const { editor } = createEditor();
      editor.commands.setContent('<p></p>');

      const dispatchedHeadingIds: Array<string | null> = [];
      const originalDispatch = editor.view.dispatch.bind(editor.view);
      editor.view.dispatch = (transaction) => {
        const firstNode = transaction.doc.firstChild;
        if (firstNode?.type.name === 'heading') {
          dispatchedHeadingIds.push(
            typeof firstNode.attrs.headingId === 'string' ? firstNode.attrs.headingId : null,
          );
        }
        originalDispatch(transaction);
      };

      expect(editor.commands.toggleHeading({ level })).toBe(true);
      expect(dispatchedHeadingIds).toHaveLength(1);
      expect(dispatchedHeadingIds[0]).toMatch(/^heading-/u);

      editor.destroy();
    }
  });
});
