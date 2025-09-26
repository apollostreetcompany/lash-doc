/** @vitest-environment jsdom */

import { createLashEditorExtensions, lashCommands } from '@lash/editor-core';
import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

const createEditor = (content = '<p>Example</p>') =>
  new Editor({
    extensions: createLashEditorExtensions(),
    content,
  });

describe('Lash editor schema', () => {
  it('includes doc as the top node', () => {
    const editor = createEditor('<p>Check</p>');
    expect(editor.schema.topNodeType.name).toBe('doc');
    editor.destroy();
  });

  it('restricts headings to levels 1-3', () => {
    const editor = createEditor('<p>Heading</p>');
    expect(editor.chain().focus().toggleHeading({ level: 4 }).run()).toBe(false);
    expect(editor.chain().focus().toggleHeading({ level: 3 }).run()).toBe(true);
    const json = editor.getJSON();
    const headingNode = json.content?.[0];
    expect(headingNode?.type).toBe('heading');
    expect(headingNode?.attrs?.level).toBe(3);
    editor.destroy();
  });

  it('prevents bold mark from coexisting with inline code', () => {
    const editor = createEditor('<p>code</p>');
    editor.chain().focus().setTextSelection({ from: 1, to: 5 }).toggleBold().run();
    editor.chain().focus().setTextSelection({ from: 1, to: 5 }).toggleCode().run();
    const marks = editor.getJSON().content?.[0]?.content?.[0]?.marks ?? [];
    const markTypes = marks.map((mark) => mark.type);
    expect(markTypes).toEqual(['code']);
    editor.destroy();
  });

  it('creates checklist items with checked attribute', () => {
    const editor = createEditor('<p>Task</p>');
    lashCommands.toggleChecklist(editor);
    const doc = editor.getJSON();
    const taskList = doc.content?.[0];
    expect(taskList?.type).toBe('taskList');
    const taskItem = taskList?.content?.[0];
    expect(taskItem?.type).toBe('taskItem');
    expect(taskItem?.attrs?.checked).toBe(false);
    editor.destroy();
  });

  it('supports underline mark via command utilities', () => {
    const editor = createEditor('<p>underline</p>');
    editor.commands.setTextSelection({ from: 1, to: 10 });
    lashCommands.toggleUnderline(editor);
    const marks = editor.getJSON().content?.[0]?.content?.[0]?.marks ?? [];
    expect(marks.some((mark) => mark.type === 'underline')).toBe(true);
    editor.destroy();
  });

  it('sets and unsets link mark using command utilities', () => {
    const editor = createEditor('<p>example</p>');
    editor.commands.setTextSelection({ from: 1, to: 8 });
    lashCommands.setLink(editor, 'https://example.com');
    const linkMarks = editor.getJSON().content?.[0]?.content?.[0]?.marks ?? [];
    expect(linkMarks.some((mark) => mark.type === 'link' && mark.attrs?.href === 'https://example.com')).toBe(true);

    lashCommands.unsetLink(editor);
    const updatedMarks = editor.getJSON().content?.[0]?.content?.[0]?.marks ?? [];
    expect(updatedMarks.some((mark) => mark.type === 'link')).toBe(false);
    editor.destroy();
  });
});
