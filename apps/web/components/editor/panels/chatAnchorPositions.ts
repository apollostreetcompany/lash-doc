import type { ChatRelativeRange } from '@lash/doc-chat';
import { getTextSerializersFromSchema, type Editor, type Range } from '@tiptap/core';
import {
  ProsemirrorBinding,
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from 'y-prosemirror';
import * as Y from 'yjs';

interface TextSpan {
  editor: Range;
  text: Range;
  isText: boolean;
}

/** Map editor positions to the same plaintext offsets used by TipTap getText. */
export function projectChatDocumentText(editor: Editor) {
  const { doc } = editor.state;
  const range = { from: 0, to: doc.content.size };
  const serializers: Partial<ReturnType<typeof getTextSerializersFromSchema>> =
    getTextSerializersFromSchema(editor.schema);
  const spans: TextSpan[] = [];
  let text = '';

  doc.nodesBetween(range.from, range.to, (node, pos, parent, index) => {
    // TipTap getText emits a separator before every block starting after position zero.
    if (node.isBlock && pos > 0) text += '\n';
    const serialize = serializers[node.type.name];
    const value = serialize && parent ? serialize({ node, pos, parent, index, range }) : node.text;
    if (value) {
      spans.push({
        editor: { from: pos, to: pos + node.nodeSize },
        text: { from: text.length, to: text.length + value.length },
        isText: node.isText && !serialize,
      });
      text += value;
    }
    if (serialize) return false;
  });

  return {
    text,
    toTextRange({ from, to }: Range): Range | null {
      if (from >= to) return null;
      const selected = spans.filter((span) => span.editor.from < to && span.editor.to > from);
      const first = selected[0];
      const last = selected[selected.length - 1];
      if (!first || !last) return null;
      return {
        from: first.text.from + (first.isText ? Math.max(0, from - first.editor.from) : 0),
        to: last.text.to - (last.isText ? Math.max(0, last.editor.to - to) : 0),
      };
    },
    toEditorRange({ from, to }: Range): Range | null {
      if (from >= to) return null;
      const first = spans.find((span) => span.text.from <= from && from < span.text.to);
      const last = spans.find((span) => span.text.from < to && to <= span.text.to);
      if (!first || !last) return null;
      if ((!first.isText && from !== first.text.from) || (!last.isText && to !== last.text.to)) {
        return null;
      }
      return {
        from: first.editor.from + (first.isText ? from - first.text.from : 0),
        to: last.editor.to - (last.isText ? last.text.to - to : 0),
      };
    },
  };
}

export type ChatDocumentText = ReturnType<typeof projectChatDocumentText>;

const getBinding = (editor: Editor): ProsemirrorBinding | null => {
  if (editor.isDestroyed) return null;
  const binding: unknown = ySyncPluginKey.getState(editor.state)?.binding;
  return binding instanceof ProsemirrorBinding ? binding : null;
};

export function resolveChatAnchorRange(editor: Editor, range: ChatRelativeRange): Range | null {
  const binding = getBinding(editor);
  const doc = binding?.type.doc;
  if (!binding || !doc) return null;
  const resolve = (position: ChatRelativeRange['start']) =>
    relativePositionToAbsolutePosition(
      doc,
      binding.type,
      Y.createRelativePositionFromJSON(position),
      binding.mapping,
    );
  try {
    const from = resolve(range.start);
    const to = resolve(range.end);
    return from !== null &&
      to !== null &&
      from >= 0 &&
      from < to &&
      to <= editor.state.doc.content.size
      ? { from, to }
      : null;
  } catch {
    return null;
  }
}

export function captureChatAnchorRange(editor: Editor, range: Range): ChatRelativeRange | null {
  const binding = getBinding(editor);
  const doc = binding?.type.doc;
  if (!binding || !doc) return null;
  try {
    const resolve = (pos: number) =>
      absolutePositionToRelativePosition(pos, binding.type, binding.mapping) as Y.RelativePosition;
    const start = resolve(range.from);
    const endPosition = Y.createAbsolutePositionFromRelativePosition(resolve(range.to), doc);
    if (!endPosition) return null;
    // A new character adjacent to either edge stays outside the original selection.
    const end = Y.createRelativePositionFromTypeIndex(endPosition.type, endPosition.index, -1);
    const relativeRange: ChatRelativeRange = {
      start: Y.relativePositionToJSON(start),
      end: Y.relativePositionToJSON(end),
    };
    const resolved = resolveChatAnchorRange(editor, relativeRange);
    return resolved?.from === range.from && resolved.to === range.to ? relativeRange : null;
  } catch {
    return null;
  }
}
