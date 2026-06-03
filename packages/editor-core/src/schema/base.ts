/**
 * @lash/editor-core/schema/base — foundational TipTap extensions for Lash.
 *
 * This module owns the schema pieces that EVERY editor instance needs:
 *  - Rich-text basics (paragraph, lists, marks) via TipTap StarterKit
 *  - Custom heading with stable IDs
 *  - Outline plugin (collapse + persistence)
 *  - Image upload pipeline + NodeView
 *  - Table extensions + interaction plugin (status/select cells, Tab nav)
 *  - Task list / task item (checklists)
 *  - Underline + Link
 *  - Keyboard shortcuts (Mod-b/i/u, headings, etc.)
 *
 * Feature-specific schema lives in sibling modules (see ./index.ts):
 *  - ./chips.ts     — internal-link chips (M1/B1)
 *  - ./mentions.ts  — @user/@group/@date mentions (M3/D1)
 *  - ./suggest.ts   — track-changes marks (M4/E4)
 *  - ./ai.ts        — AI-emitted node attrs / labels (M4/E1+E2)
 *
 * Lanes that add new extensions touch ONLY their own sibling module +
 * register their builder in ./index.ts. They do NOT edit base.ts unless
 * they're modifying a foundational extension.
 */

import { Extension, type Editor, type Extensions } from '@tiptap/core';
import CollaborationExtension from '@tiptap/extension-collaboration';
import LinkExtension from '@tiptap/extension-link';
import TaskItemExtension from '@tiptap/extension-task-item';
import TaskListExtension from '@tiptap/extension-task-list';
import UnderlineExtension from '@tiptap/extension-underline';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import StarterKitExtension from '@tiptap/starter-kit';
import type * as Y from 'yjs';

import { LashHeading } from '../extensions/heading';
import { LashImage, type LashImageUploader } from '../extensions/image';
import {
  createLashTableExtensions,
  type LashTableOptions,
  createLashTableInteractionPlugin,
} from '../extensions/table';
import { OutlineManager, type OutlinePersistenceAdapter } from '../plugins/outline';

export interface LashSchemaOptions {
  onRequestLink?: (editor: Editor) => boolean;
  outline?: {
    persistence?: OutlinePersistenceAdapter;
    documentId?: string;
  };
  image?: {
    uploader: LashImageUploader;
    initialWidth?: number;
  };
  table?: LashTableOptions;
  collaboration?: {
    document: Y.Doc;
    field?: string;
  };
}

const LashKeyboardShortcuts = Extension.create<LashSchemaOptions>({
  name: 'lashKeyboardShortcuts',
  addKeyboardShortcuts() {
    return {
      'Mod-b': () => this.editor.chain().focus().toggleBold().run(),
      'Mod-i': () => this.editor.chain().focus().toggleItalic().run(),
      'Mod-u': () => this.editor.chain().focus().toggleUnderline().run(),
      'Mod-e': () => this.editor.chain().focus().toggleCode().run(),
      'Mod-Alt-1': () => this.editor.chain().focus().toggleHeading({ level: 1 }).run(),
      'Mod-Alt-2': () => this.editor.chain().focus().toggleHeading({ level: 2 }).run(),
      'Mod-Alt-3': () => this.editor.chain().focus().toggleHeading({ level: 3 }).run(),
      'Mod-Shift-8': () => this.editor.chain().focus().toggleBulletList().run(),
      'Mod-Shift-7': () => this.editor.chain().focus().toggleOrderedList().run(),
      'Mod-Shift-x': () => this.editor.chain().focus().toggleTaskList().run(),
      'Mod-Shift-t': () => this.editor.chain().focus().insertTable({ rows: 3, cols: 3 }).run(),
      'Mod-k': () => {
        const handler = this.options?.onRequestLink;
        if (handler) {
          return handler(this.editor);
        }
        return this.editor.chain().focus().extendMarkRange('link').unsetLink().run();
      },
    };
  },
});

// Table navigation extension — must use a keymap plugin for proper priority.
const LashTableNavigation = Extension.create({
  name: 'lashTableNavigation',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('lashTableNavigation'),
        props: {
          handleKeyDown: (_view, event) => {
            if (event.key !== 'Tab') {
              return false;
            }

            const editor = this.editor as Editor;
            event.preventDefault();

            if (event.shiftKey) {
              return editor
                .chain()
                .goToPreviousCell()
                .command(({ tr, dispatch: cmdDispatch }) => {
                  if (cmdDispatch && tr.selection) {
                    const { $from } = tr.selection;
                    const endPos = $from.end($from.depth);
                    const newSelection = TextSelection.create(tr.doc, endPos);
                    tr.setSelection(newSelection);
                  }
                  return true;
                })
                .run();
            }
            return editor
              .chain()
              .goToNextCell()
              .command(({ tr, dispatch: cmdDispatch }) => {
                if (cmdDispatch && tr.selection) {
                  const { $from } = tr.selection;
                  const endPos = $from.end($from.depth);
                  const newSelection = TextSelection.create(tr.doc, endPos);
                  tr.setSelection(newSelection);
                }
                return true;
              })
              .run();
          },
        },
      }),
    ];
  },
});

export const buildBaseExtensions = (options?: LashSchemaOptions): Extensions => {
  const outlineOptions = options?.outline ?? {};
  const imageOptions = options?.image;

  return [
    StarterKitExtension.configure({
      heading: false,
      bulletList: { keepMarks: true, keepAttributes: true },
      orderedList: { keepMarks: true, keepAttributes: true },
      strike: false,
      blockquote: false,
      codeBlock: false,
      dropcursor: false,
      gapcursor: false,
      horizontalRule: false,
      history: options?.collaboration ? false : { depth: 500 },
      code: { HTMLAttributes: { class: 'lash-inline-code' } },
    }),
    ...(options?.collaboration
      ? [
          CollaborationExtension.configure({
            document: options.collaboration.document,
            field: options.collaboration.field,
          }),
        ]
      : []),
    LashHeading.configure({ levels: [1, 2, 3] }),
    OutlineManager.configure({
      documentId: outlineOptions.documentId ?? 'default',
      persistence: outlineOptions.persistence,
    }),
    LashImage.configure({
      uploader:
        imageOptions?.uploader ??
        ({
          upload: async () => ({ src: '', width: 360 }),
        } as LashImageUploader),
      initialWidth: imageOptions?.initialWidth ?? 360,
    }),
    ...createLashTableExtensions(options?.table),
    TaskListExtension.configure({
      HTMLAttributes: { 'data-type': 'taskList' },
    }),
    TaskItemExtension.configure({
      nested: true,
      HTMLAttributes: { 'data-type': 'taskItem' },
    }),
    UnderlineExtension,
    LinkExtension.configure({
      openOnClick: false,
      linkOnPaste: true,
      HTMLAttributes: { rel: 'noopener noreferrer' },
    }),
    LashKeyboardShortcuts.configure(options ?? {}),
    LashTableNavigation,
    Extension.create({
      name: 'lashTableInteraction',
      addProseMirrorPlugins() {
        return [createLashTableInteractionPlugin()];
      },
    }),
  ];
};
