import { Extension } from '@tiptap/core';
import { Plugin, TextSelection } from '@tiptap/pm/state';

export const LashListTextInput = Extension.create({
  name: 'lashListTextInput',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            beforeinput(view, event) {
              const { data, inputType } = event;
              if (
                inputType !== 'insertText' ||
                !event.cancelable ||
                event.isComposing ||
                !data ||
                /[\r\n]/.test(data) ||
                !view.editable ||
                !view.hasFocus() ||
                view.composing
              ) {
                return false;
              }

              const { selection } = view.state;
              const { $from, from, to } = selection;
              if (
                !(selection instanceof TextSelection) ||
                !selection.empty ||
                $from.parent.type.name !== 'paragraph' ||
                $from.parent.content.size !== 0 ||
                $from.depth < 2 ||
                $from.node(-1).type.name !== 'listItem'
              ) {
                return false;
              }

              const domSelection = view.dom.ownerDocument.getSelection();
              if (
                !domSelection?.isCollapsed ||
                !domSelection.anchorNode ||
                !view.dom.contains(domSelection.anchorNode)
              ) {
                return false;
              }
              try {
                if (view.posAtDOM(domSelection.anchorNode, domSelection.anchorOffset) !== from) {
                  return false;
                }
              } catch {
                return false;
              }

              // Blink can insert text directly into the list, ahead of the empty item.
              // Apply the first text at the confirmed paragraph caret before that DOM edit.
              event.preventDefault();
              const insert = () => view.state.tr.insertText(data, from, to).scrollIntoView();
              if (
                !view.someProp('handleTextInput', (handle) => handle(view, from, to, data, insert))
              ) {
                view.dispatch(insert());
              }
              return true;
            },
          },
        },
      }),
    ];
  },
});
