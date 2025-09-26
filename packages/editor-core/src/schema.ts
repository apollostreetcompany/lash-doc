import { Extension, type Editor, type Extensions } from '@tiptap/core';
import LinkExtension from '@tiptap/extension-link';
import TaskItemExtension from '@tiptap/extension-task-item';
import TaskListExtension from '@tiptap/extension-task-list';
import UnderlineExtension from '@tiptap/extension-underline';
import StarterKitExtension from '@tiptap/starter-kit';

import { LashHeading } from './extensions/heading';
import { OutlineManager, type OutlinePersistenceAdapter } from './plugins/outline';
import { LashImage, type LashImageUploader } from './extensions/image';
import {
  createLashTableExtensions,
  type LashTableOptions,
  createLashTableInteractionPlugin,
} from './extensions/table';

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

export const createLashEditorExtensions = (options?: LashSchemaOptions): Extensions => {
  const outlineOptions = options?.outline ?? {};
  const imageOptions = options?.image;

  const extensions: Extensions = [
    StarterKitExtension.configure({
      heading: false, // We use custom LashHeading instead
      bulletList: {
        keepMarks: true,
        keepAttributes: true,
      },
      orderedList: {
        keepMarks: true,
        keepAttributes: true,
      },
      strike: false,
      blockquote: false,
      codeBlock: false,
      dropcursor: false,
      gapcursor: false,
      horizontalRule: false,
      history: {
        depth: 500,
      },
      code: {
        HTMLAttributes: { class: 'lash-inline-code' },
      },
    }),
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
      HTMLAttributes: {
        rel: 'noopener noreferrer',
      },
    }),
    LashKeyboardShortcuts.configure(options ?? {}),
    Extension.create({
      name: 'lashTableInteraction',
      addProseMirrorPlugins() {
        return [createLashTableInteractionPlugin()];
      },
    }),
  ];

  return extensions;
};
