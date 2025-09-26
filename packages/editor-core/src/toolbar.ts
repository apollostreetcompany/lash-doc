import type { Editor } from '@tiptap/core';

import { runToolbarCommand, type ToolbarCommandId } from './commands';

export interface ToolbarButtonSpec {
  id: ToolbarCommandId;
  label: string;
  icon: string;
  hotkey?: string;
  group: 'marks' | 'blocks';
}

export const toolbarButtons: ToolbarButtonSpec[] = [
  { id: 'bold', label: 'Bold', icon: 'B', hotkey: 'Mod+B', group: 'marks' },
  { id: 'italic', label: 'Italic', icon: 'I', hotkey: 'Mod+I', group: 'marks' },
  { id: 'underline', label: 'Underline', icon: 'U', hotkey: 'Mod+U', group: 'marks' },
  { id: 'code', label: 'Code', icon: '</>', hotkey: 'Mod+E', group: 'marks' },
  { id: 'link', label: 'Link', icon: '🔗', hotkey: 'Mod+K', group: 'marks' },
  { id: 'heading-1', label: 'Heading 1', icon: 'H1', hotkey: 'Mod+Alt+1', group: 'blocks' },
  { id: 'heading-2', label: 'Heading 2', icon: 'H2', hotkey: 'Mod+Alt+2', group: 'blocks' },
  { id: 'heading-3', label: 'Heading 3', icon: 'H3', hotkey: 'Mod+Alt+3', group: 'blocks' },
  { id: 'bullet-list', label: 'Bullet List', icon: '•', hotkey: 'Mod+Shift+8', group: 'blocks' },
  { id: 'ordered-list', label: 'Ordered List', icon: '1.', hotkey: 'Mod+Shift+7', group: 'blocks' },
  { id: 'checklist', label: 'Checklist', icon: '☑︎', hotkey: 'Mod+Shift+X', group: 'blocks' },
  { id: 'insert-table', label: 'Insert Table', icon: 'Tbl', hotkey: 'Mod+Shift+T', group: 'blocks' },
];

export const runToolbarAction = (
  editor: Editor,
  id: ToolbarCommandId,
  options?: { href?: string },
): boolean => runToolbarCommand(editor, id, options);

export const isToolbarButtonActive = (editor: Editor, id: ToolbarCommandId): boolean => {
  switch (id) {
    case 'bold':
      return editor.isActive('bold');
    case 'italic':
      return editor.isActive('italic');
    case 'underline':
      return editor.isActive('underline');
    case 'code':
      return editor.isActive('code');
    case 'link':
      return editor.isActive('link');
    case 'heading-1':
      return editor.isActive('heading', { level: 1 });
    case 'heading-2':
      return editor.isActive('heading', { level: 2 });
    case 'heading-3':
      return editor.isActive('heading', { level: 3 });
    case 'bullet-list':
      return editor.isActive('bulletList');
    case 'ordered-list':
      return editor.isActive('orderedList');
    case 'checklist':
      return editor.isActive('taskList');
    case 'insert-table':
      return false;
    default:
      return false;
  }
};

export const toolbarGroups = {
  marks: toolbarButtons.filter((button) => button.group === 'marks'),
  blocks: toolbarButtons.filter((button) => button.group === 'blocks'),
};
