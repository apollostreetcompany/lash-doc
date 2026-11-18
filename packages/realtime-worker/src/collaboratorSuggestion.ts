import type { ChatAnchor, ReviewProposal } from '@lash/doc-chat';
import {
  createLashEditorExtensions,
  prepareSuggestionReplacement,
  readSuggestionRange,
} from '@lash/editor-core';
import { canonicalize } from '@lash/types';
import { getSchema, getTextBetween, getTextSerializersFromSchema } from '@tiptap/core';
import { initProseMirrorDoc, relativePositionToAbsolutePosition } from 'y-prosemirror';
import * as Y from 'yjs';

const schema = getSchema(createLashEditorExtensions());
const textOptions = {
  blockSeparator: '\n',
  textSerializers: getTextSerializersFromSchema(schema),
};

export function createRoomCommentAnchorReader(room: Y.Doc) {
  const root = room.getXmlFragment('content');
  const { doc, mapping } = initProseMirrorDoc(root, schema);
  doc.check();
  return (anchor: ChatAnchor<null>): ChatAnchor<null> | null => {
    const range = anchor.relativeRange;
    if (!range) return null;
    try {
      const resolve = (point: typeof range.start) =>
        relativePositionToAbsolutePosition(
          room,
          root,
          Y.createRelativePositionFromJSON(point),
          mapping,
        );
      const from = resolve(range.start);
      const to = resolve(range.end);
      if (from === null || to === null || from >= to || from < 0 || to > doc.content.size) {
        return null;
      }
      const text = getTextBetween(doc, { from, to }, textOptions);
      if (text !== anchor.token.text) return null;
      // Older anchor context can include text since removed from the current document.
      return { ...anchor, token: { ...anchor.token, before: '', after: '' } };
    } catch {
      return null;
    }
  };
}

function resolveTarget(room: Y.Doc, proposal: ReviewProposal) {
  const range = proposal.anchor.relativeRange;
  if (!range) return null;
  const root = room.getXmlFragment('content');
  const { doc, mapping } = initProseMirrorDoc(root, schema);
  doc.check();
  const start = Y.createRelativePositionFromJSON(range.start);
  const end = Y.createRelativePositionFromJSON(range.end);
  const first = Y.createAbsolutePositionFromRelativePosition(start, room);
  const last = Y.createAbsolutePositionFromRelativePosition(end, room);
  if (
    !first ||
    !last ||
    !(first.type instanceof Y.XmlText) ||
    first.type !== last.type ||
    first.index >= last.index ||
    !Y.compareRelativePositions(
      start,
      Y.createRelativePositionFromTypeIndex(first.type, first.index, 0),
    ) ||
    !Y.compareRelativePositions(
      end,
      Y.createRelativePositionFromTypeIndex(last.type, last.index, -1),
    )
  ) {
    return null;
  }
  const from = relativePositionToAbsolutePosition(room, root, start, mapping);
  const to = relativePositionToAbsolutePosition(room, root, end, mapping);
  if (from === null || to === null || to - from !== last.index - first.index) return null;
  const parts = first.type.toDelta() as { insert: string; attributes?: Record<string, unknown> }[];
  if (parts.some(({ insert }) => typeof insert !== 'string')) return null;
  const text = parts.map(({ insert }) => insert).join('');
  const target = readSuggestionRange(doc, { from, to });
  if (
    !target ||
    target.text !== proposal.anchor.token.text ||
    text.slice(first.index, last.index) !== target.text
  )
    return null;
  const expected = prepareSuggestionReplacement(
    doc,
    { from, to },
    proposal.before,
    proposal.replacement,
  );
  return expected
    ? { root, type: first.type, start: first.index, end: last.index, expected, parts }
    : null;
}

export function isCurrentRoomSuggestion(room: Y.Doc, proposal: ReviewProposal) {
  try {
    return Boolean(resolveTarget(room, proposal));
  } catch {
    return false;
  }
}

/** Only call with a disposable authoritative copy of the room state. */
export function prepareRoomSuggestionDecision(room: Y.Doc, proposal: ReviewProposal) {
  try {
    const target = resolveTarget(room, proposal);
    if (!target) return null;
    const { type, start, end, expected, root, parts } = target;
    let index = 0;
    let attributes: Record<string, unknown> | undefined;
    for (const part of parts) {
      const partEnd = index + part.insert.length;
      if (index < end && partEnd > start) {
        const current = part.attributes ?? {};
        attributes =
          attributes === undefined
            ? { ...current }
            : Object.fromEntries(
                Object.entries(attributes).filter(
                  ([key, value]) =>
                    Object.hasOwn(current, key) &&
                    canonicalize(current[key]) === canonicalize(value),
                ),
              );
      }
      index = partEnd;
    }
    const updates: Uint8Array[] = [];
    const collect = (update: Uint8Array) => updates.push(update);
    room.on('update', collect);
    try {
      room.transact(() => {
        type.delete(start, end - start);
        if (proposal.replacement) type.insert(start, proposal.replacement, attributes ?? {});
      });
    } finally {
      room.off('update', collect);
    }
    const projected = initProseMirrorDoc(root, schema).doc;
    return updates.length === 1 && projected.eq(expected.doc) ? updates[0] : null;
  } catch {
    return null;
  }
}
