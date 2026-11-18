import { Extension } from '@tiptap/core';
import PlaceholderExtension from '@tiptap/extension-placeholder';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export const EMPTY_DOCUMENT_INVITATION = 'Start writing…';

/**
 * ProseMirror root semantics are supplied as editor props rather than DOM
 * mutations so they refresh whenever editable state changes. The invitation
 * itself remains a decoration owned by TipTap's Placeholder extension and
 * therefore never enters the document schema, history, or autosave payload.
 */
const LashDocumentEditorSemantics = Extension.create({
  name: 'lashDocumentEditorSemantics',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('lashDocumentEditorSemantics'),
        props: {
          attributes: () => ({
            role: 'textbox',
            'aria-label': 'Document editor',
            'aria-multiline': 'true',
            ...(this.editor.isEditable && this.editor.isEmpty
              ? { 'aria-placeholder': EMPTY_DOCUMENT_INVITATION }
              : this.editor.isEditable
                ? {}
                : { 'aria-readonly': 'true' }),
          }),
        },
      }),
    ];
  },
});

export const createEmptyDocumentInvitationExtensions = () => [
  PlaceholderExtension.configure({
    placeholder: EMPTY_DOCUMENT_INVITATION,
    showOnlyWhenEditable: true,
    showOnlyCurrent: true,
    includeChildren: false,
    emptyEditorClass: 'is-editor-empty',
    emptyNodeClass: 'is-empty',
  }),
  LashDocumentEditorSemantics,
];
