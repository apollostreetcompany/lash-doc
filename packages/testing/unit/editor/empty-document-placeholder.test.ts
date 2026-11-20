/** @vitest-environment jsdom */

import { createLashEditorExtensions } from '@lash/editor-core';
import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

const INVITATION = 'Start writing…';

const createEditor = (options?: { content?: string; editable?: boolean }) =>
  new Editor({
    extensions: createLashEditorExtensions(),
    content: options?.content ?? '<p></p>',
    editable: options?.editable ?? true,
    editorProps: {
      attributes: {
        class: 'lash-editor-content',
      },
    },
  });

describe('empty-document invitation', () => {
  it('adds one accessible decoration to a truly empty editable document without changing JSON', () => {
    const editor = createEditor();
    const before = editor.getJSON();
    const editable = editor.view.dom;
    const emptyParagraph = editable.querySelector('p');

    expect(editable.getAttribute('role')).toBe('textbox');
    expect(editable.getAttribute('aria-label')).toBe('Document editor');
    expect(editable.getAttribute('aria-multiline')).toBe('true');
    expect(editable.getAttribute('aria-placeholder')).toBe(INVITATION);
    expect(emptyParagraph?.getAttribute('data-placeholder')).toBe(INVITATION);
    expect(editable.querySelectorAll(`[data-placeholder="${INVITATION}"]`)).toHaveLength(1);
    expect(editor.getJSON()).toEqual(before);
    expect(JSON.stringify(editor.getJSON())).not.toContain(INVITATION);

    editor.destroy();
  });

  it('removes the visual invitation immediately after typing without persisting the copy', () => {
    const editor = createEditor();

    expect(editor.view.dom.querySelector('[data-placeholder]')).not.toBeNull();
    expect(editor.commands.insertContent('A clear first thought.')).toBe(true);
    expect(editor.view.dom.querySelector('[data-placeholder]')).toBeNull();
    expect(editor.getText()).toBe('A clear first thought.');
    expect(editor.view.dom.getAttribute('aria-placeholder')).toBeNull();
    expect(JSON.stringify(editor.getJSON())).not.toContain(INVITATION);

    editor.destroy();
  });

  it('does not render the invitation when the editor is read-only', () => {
    const editor = createEditor({ editable: false });
    const editable = editor.view.dom;

    expect(editable.getAttribute('aria-label')).toBe('Document editor');
    expect(editable.getAttribute('aria-placeholder')).toBeNull();
    expect(editable.getAttribute('aria-readonly')).toBe('true');
    expect(editable.querySelector('[data-placeholder]')).toBeNull();

    editor.destroy();
  });

  it('refreshes invitation and read-only semantics when editability changes at runtime', () => {
    const editor = createEditor();
    const editable = editor.view.dom;

    expect(editable.getAttribute('aria-placeholder')).toBe(INVITATION);
    expect(editable.querySelector('[data-placeholder]')).not.toBeNull();

    editor.setEditable(false);
    expect(editable.getAttribute('aria-placeholder')).toBeNull();
    expect(editable.getAttribute('aria-readonly')).toBe('true');
    expect(editable.querySelector('[data-placeholder]')).toBeNull();

    editor.setEditable(true);
    expect(editable.getAttribute('aria-readonly')).toBeNull();
    expect(editable.getAttribute('aria-placeholder')).toBe(INVITATION);
    expect(editable.querySelector('[data-placeholder]')).not.toBeNull();

    editor.destroy();
  });
});
