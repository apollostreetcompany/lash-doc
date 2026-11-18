import { InputRule } from '@tiptap/core';
// eslint-disable-next-line import/no-named-as-default
import HeadingExtension from '@tiptap/extension-heading';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';

import { createUniqueHeadingId, headingInputStabilityKey } from '../plugins/heading-id';

const withStableHeadingId = (
  state: EditorState,
  headingTypeName: string,
  attributes: { level: number },
) => {
  const { $anchor, $head } = state.selection;
  if (!$anchor.sameParent($head) || $anchor.depth === 0) {
    return attributes;
  }

  const parent = $anchor.parent;
  const currentHeadingId =
    parent.type.name === headingTypeName && typeof parent.attrs.headingId === 'string'
      ? parent.attrs.headingId.trim()
      : '';

  return {
    ...attributes,
    headingId: currentHeadingId || createUniqueHeadingId(state.doc, $anchor.before()),
  };
};

export const LashHeading = HeadingExtension.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      headingId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-heading-id'),
        renderHTML: (attributes: { headingId?: string | null }) => {
          if (!attributes.headingId) {
            return {};
          }
          return {
            'data-heading-id': attributes.headingId,
          };
        },
      },
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setHeading:
        (attributes) =>
        ({ chain, state }) => {
          if (!this.options.levels.includes(attributes.level)) {
            return false;
          }
          return chain()
            .setNode(this.name, withStableHeadingId(state, this.name, attributes))
            .command(({ state: nextState, tr }) => {
              const parent = nextState.selection.$from.parent;
              if (parent.type === this.type && parent.content.size === 0) {
                tr.setMeta(headingInputStabilityKey, 'arm');
              }
              return true;
            })
            .run();
        },
      toggleHeading:
        (attributes) =>
        ({ chain, state }) => {
          if (!this.options.levels.includes(attributes.level)) {
            return false;
          }
          return chain()
            .toggleNode(this.name, 'paragraph', withStableHeadingId(state, this.name, attributes))
            .command(({ state: nextState, tr }) => {
              const parent = nextState.selection.$from.parent;
              if (parent.type === this.type && parent.content.size === 0) {
                tr.setMeta(headingInputStabilityKey, 'arm');
              }
              return true;
            })
            .run();
        },
    };
  },

  addInputRules() {
    const minimumLevel = Math.min(...this.options.levels);
    return this.options.levels.map(
      (level) =>
        new InputRule({
          find: new RegExp(`^(#{${minimumLevel},${level}})\\s$`),
          handler: ({ state, range }) => {
            const $start = state.doc.resolve(range.from);
            if (
              !$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), this.type)
            ) {
              return null;
            }

            const headingPos = $start.before();
            const transaction = state.tr
              .delete(range.from, range.to)
              .setBlockType(range.from, range.from, this.type, {
                level,
                headingId: createUniqueHeadingId(state.doc, headingPos),
              });
            transaction
              .setSelection(TextSelection.create(transaction.doc, range.from))
              .setMeta(headingInputStabilityKey, 'arm');
          },
        }),
    );
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<boolean>({
        key: headingInputStabilityKey,
        state: {
          init: () => false,
          apply(transaction, armed) {
            const action = transaction.getMeta(headingInputStabilityKey) as
              | 'arm'
              | 'consume'
              | undefined;
            if (action === 'arm') return true;
            if (action === 'consume') return false;
            if (armed && (transaction.docChanged || transaction.selectionSet)) return false;
            return armed;
          },
        },
        props: {
          handleTextInput(view, _from, _to, text) {
            if (!headingInputStabilityKey.getState(view.state) || view.composing || !text) {
              return false;
            }

            const { from, to } = view.state.selection;
            view.dispatch(
              view.state.tr.insertText(text, from, to).setMeta(headingInputStabilityKey, 'consume'),
            );
            return true;
          },
        },
      }),
    ];
  },
});
