import type { Editor } from '@tiptap/core';

import type { LashTableCellType } from './extensions/table';
import {
  cycleSelectionCellOption,
  getActiveCellAttrs,
  setSelectionCellType,
  setSelectionCellValue,
} from './table/commands';

export type HeadingLevel = 1 | 2 | 3;
export type ToolbarCommandId =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'code'
  | 'link'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'bullet-list'
  | 'ordered-list'
  | 'checklist'
  | 'insert-table';

export const lashCommands = {
  toggleBold(editor: Editor) {
    return editor.chain().focus().toggleBold().run();
  },
  toggleItalic(editor: Editor) {
    return editor.chain().focus().toggleItalic().run();
  },
  toggleUnderline(editor: Editor) {
    return editor.chain().focus().toggleUnderline().run();
  },
  toggleCode(editor: Editor) {
    return editor.chain().focus().toggleCode().run();
  },
  toggleHeading(editor: Editor, level: HeadingLevel) {
    return editor.chain().focus().toggleHeading({ level }).run();
  },
  toggleBulletList(editor: Editor) {
    return editor.chain().focus().toggleBulletList().run();
  },
  toggleOrderedList(editor: Editor) {
    return editor.chain().focus().toggleOrderedList().run();
  },
  toggleChecklist(editor: Editor) {
    return editor.chain().focus().toggleTaskList().run();
  },
  toggleHeadingCollapse(editor: Editor, headingId: string) {
    const commands = editor.commands as typeof editor.commands & {
      toggleHeadingCollapse?: (id: string) => boolean;
    };
    if (!commands.toggleHeadingCollapse) {
      return false;
    }
    return commands.toggleHeadingCollapse(headingId);
  },
  expandAllHeadings(editor: Editor) {
    const commands = editor.commands as typeof editor.commands & {
      expandAllHeadings?: () => boolean;
    };
    if (!commands.expandAllHeadings) {
      return false;
    }
    return commands.expandAllHeadings();
  },
  setLink(editor: Editor, href: string) {
    return editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  },
  unsetLink(editor: Editor) {
    return editor.chain().focus().extendMarkRange('link').unsetLink().run();
  },
  insertTable(editor: Editor, options: { rows?: number; cols?: number } = {}) {
    const rows = options.rows ?? 3;
    const cols = options.cols ?? 3;
    return editor.chain().focus().insertTable({ rows, cols, withHeaderRow: false }).run();
  },
  setTableCellType(editor: Editor, cellType: LashTableCellType, options?: string[]) {
    return setSelectionCellType(editor, cellType, options);
  },
  setTableCellValue(editor: Editor, value: string) {
    return setSelectionCellValue(editor, value);
  },
  cycleTableCellOption(editor: Editor, direction: 1 | -1 = 1) {
    return cycleSelectionCellOption(editor, direction);
  },
  getTableCellAttrs(editor: Editor) {
    return getActiveCellAttrs(editor);
  },
};

export const runToolbarCommand = (
  editor: Editor,
  id: ToolbarCommandId,
  options?: { href?: string },
): boolean => {
  switch (id) {
    case 'bold':
      return lashCommands.toggleBold(editor);
    case 'italic':
      return lashCommands.toggleItalic(editor);
    case 'underline':
      return lashCommands.toggleUnderline(editor);
    case 'code':
      return lashCommands.toggleCode(editor);
    case 'heading-1':
      return lashCommands.toggleHeading(editor, 1);
    case 'heading-2':
      return lashCommands.toggleHeading(editor, 2);
    case 'heading-3':
      return lashCommands.toggleHeading(editor, 3);
    case 'bullet-list':
      return lashCommands.toggleBulletList(editor);
    case 'ordered-list':
      return lashCommands.toggleOrderedList(editor);
    case 'checklist':
      return lashCommands.toggleChecklist(editor);
    case 'insert-table':
      return lashCommands.insertTable(editor);
    case 'link': {
      const currentHref = options?.href;
      if (!currentHref) {
        return lashCommands.unsetLink(editor);
      }
      return lashCommands.setLink(editor, currentHref);
    }
    default:
      return false;
  }
};
