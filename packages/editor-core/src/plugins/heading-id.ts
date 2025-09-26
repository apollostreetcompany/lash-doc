import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';

const headingIdKey = new PluginKey('lashHeadingId');

const deriveHeadingId = (pos: number) => `heading-${pos.toString(36)}`;

const annotateHeadings = (doc: ProseMirrorNode, state: EditorState): Transaction | null => {
  let tr: Transaction | null = null;
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') {
      return true;
    }
    if (!node.attrs.headingId) {
      const headingId = deriveHeadingId(pos);
      const nextTr = (tr ?? state.tr).setNodeMarkup(pos, undefined, {
        ...node.attrs,
        headingId,
      });
      tr = nextTr;
    }
    return true;
  });
  return tr;
};

export const createHeadingIdPlugin = () =>
  new Plugin({
    key: headingIdKey,
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((transaction) => transaction.docChanged)) {
        return null;
      }
      const tr = annotateHeadings(newState.doc, newState);
      return tr ?? null;
    },
  });
