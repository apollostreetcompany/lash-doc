import { Extension } from '@tiptap/core';
import { Plugin, TextSelection } from '@tiptap/pm/state';

const belongsToEditor = (node: Node, editor: HTMLElement) => {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest('[contenteditable]') === editor;
};

export const LashNativePasteSelection = Extension.create({
  name: 'lashNativePasteSelection',
  priority: 101,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            paste(view, event) {
              const { doc, selection } = view.state;
              if (
                event.defaultPrevented ||
                !view.editable ||
                view.composing ||
                !view.hasFocus() ||
                !(selection instanceof TextSelection)
              ) {
                return false;
              }

              const native = view.dom.ownerDocument.getSelection();
              if (
                native?.rangeCount !== 1 ||
                !native.anchorNode ||
                !native.focusNode ||
                !belongsToEditor(native.anchorNode, view.dom) ||
                !belongsToEditor(native.focusNode, view.dom)
              ) {
                return false;
              }

              let target: TextSelection;
              try {
                const anchor = doc.resolve(view.posAtDOM(native.anchorNode, native.anchorOffset));
                const head = doc.resolve(view.posAtDOM(native.focusNode, native.focusOffset));
                if (!anchor.parent.inlineContent || !head.parent.inlineContent) return false;
                target = new TextSelection(anchor, head);
              } catch (error) {
                if (error instanceof RangeError) return false;
                throw error;
              }

              if (!target.eq(selection)) {
                // Paste can arrive before selectionchange has copied the browser caret into the
                // editor state. Sync the text range and leave normal clipboard handling in place.
                view.dispatch(view.state.tr.setSelection(target).setMeta('addToHistory', false));
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});
