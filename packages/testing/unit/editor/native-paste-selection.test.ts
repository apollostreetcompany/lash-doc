// @vitest-environment jsdom

import { createLashEditorExtensions } from '@lash/editor-core';
import { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { afterEach, describe, expect, it, vi } from 'vitest';

const wording = 'publish the beta';
const earlier = `${wording} once, then `;
const original = earlier + wording;
let editor: Editor | undefined;

function openEditor(content = `<p>${original}</p>`, editable = true) {
  editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    editable,
    content,
    extensions: createLashEditorExtensions(),
    editorProps: { handleScrollToSelection: () => true },
  });
  editor.view.focus();
  return editor;
}

function paste(view: Editor['view'], text: string, html = '') {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (format: string) =>
        format === 'text/plain' ? text : format === 'text/html' ? html : '',
    },
  });
  view.dom.dispatchEvent(event);
  return event.defaultPrevented;
}

afterEach(() => {
  const element = editor?.options.element;
  editor?.destroy();
  element?.remove();
  editor = undefined;
});

describe('native paste selection', () => {
  it('pastes at the new native caret while the editor still holds the old selected quote', () => {
    const current = openEditor();
    current.commands.setTextSelection({ from: earlier.length + 1, to: original.length + 1 });
    const nativeSelection = window.getSelection()!;
    nativeSelection.collapse(current.view.dom.querySelector('p')!.firstChild!, 0);
    expect(nativeSelection.isCollapsed).toBe(true);
    expect(current.state.selection.empty).toBe(false);

    expect(paste(current.view, 'Reminder: ')).toBe(true);
    expect(current.getText()).toBe(`Reminder: ${original}`);
  });

  it('preserves a backwards native text selection and the rich paste pipeline', () => {
    const current = openEditor();
    current.commands.setTextSelection({ from: earlier.length + 1, to: original.length + 1 });
    const content = current.view.dom.querySelector('p')!.firstChild!;
    window.getSelection()!.setBaseAndExtent(content, wording.length, content, 0);

    expect(paste(current.view, 'review', '<em>review</em>')).toBe(true);
    expect(current.getText()).toBe(`review once, then ${wording}`);
    expect(current.getHTML()).toContain('<em>review</em>');
  });

  it('leaves a node selection in charge of paste', () => {
    const current = openEditor('<p>First paragraph</p><h1>Replace this heading</h1>');
    const headingPosition = current.state.doc.child(0).nodeSize;
    current.view.dispatch(
      current.state.tr.setSelection(NodeSelection.create(current.state.doc, headingPosition)),
    );
    window.getSelection()!.collapse(current.view.dom.querySelector('p')!.firstChild!, 0);

    expect(paste(current.view, 'Next paragraph', '<p>Next paragraph</p>')).toBe(true);
    expect(current.getText({ blockSeparator: '\n' })).toBe('First paragraph\nNext paragraph');
  });

  it('preserves the table cell selection and its matrix paste', () => {
    const current = openEditor(
      '<p>Keep this</p><table><tr><td>Old first</td><td>Old second</td></tr></table>',
    );
    const cells: number[] = [];
    current.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell') cells.push(pos);
    });
    expect(cells).toHaveLength(2);
    current.view.dispatch(
      current.state.tr.setSelection(CellSelection.create(current.state.doc, cells[0], cells[1])),
    );
    window.getSelection()!.collapse(current.view.dom.querySelector('p')!.firstChild!, 0);

    expect(paste(current.view, 'New first\tNew second')).toBe(true);
    expect(current.state.doc.firstChild?.textContent).toBe('Keep this');
    expect(current.state.doc.lastChild?.firstChild?.child(0).textContent).toBe('New first');
    expect(current.state.doc.lastChild?.firstChild?.child(1).textContent).toBe('New second');
  });

  it('leaves an in-progress composition alone', () => {
    const current = openEditor();
    const before = current.state.selection;
    const composing = vi.spyOn(current.view, 'composing', 'get').mockReturnValue(true);
    try {
      window.getSelection()!.collapse(current.view.dom.querySelector('p')!.firstChild!, 0);
      expect(paste(current.view, 'Reminder: ')).toBe(false);
      expect(current.state.selection.eq(before)).toBe(true);
      expect(current.getText()).toBe(original);
    } finally {
      composing.mockRestore();
    }
  });

  it('leaves a read-only document unchanged', () => {
    const current = openEditor(undefined, false);
    window.getSelection()!.collapse(current.view.dom.querySelector('p')!.firstChild!, 0);

    expect(paste(current.view, 'Reminder: ')).toBe(false);
    expect(current.getText()).toBe(original);
  });
});
