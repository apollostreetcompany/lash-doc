// @vitest-environment jsdom

import { createAnchor } from '@lash/doc-chat';
import { createLashEditorExtensions, readSuggestionRange } from '@lash/editor-core';
import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { ySyncPluginKey, yUndoPluginKey } from 'y-prosemirror';
import * as Y from 'yjs';

import {
  captureChatAnchorRange,
  resolveChatAnchorRange,
} from '../../../../apps/web/components/editor/panels/chatAnchorPositions';
import { prepareRoomSuggestionDecision } from '../../../realtime-worker/src/collaboratorSuggestion';

const copyDocument = (source: Y.Doc) => {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(source));
  return copy;
};

const openEditor = (room: Y.Doc, editable = true) =>
  new Editor({
    element: document.createElement('div'),
    editable,
    extensions: createLashEditorExtensions({ collaboration: { document: room, field: 'content' } }),
  });

const lastWord = 'publish the beta';
const prefix = 'first ';
const suffix = ' tomorrow';
const body = prefix + lastWord + suffix;
const initialRange = { from: prefix.length + 1, to: prefix.length + 1 + lastWord.length };

describe('collaborative text identity', () => {
  it.each(['before', 'after'] as const)(
    'retains the Worker suggestion target when pasting the same text %s it',
    (side) => {
      const owner = new Y.Doc();
      const editor = openEditor(owner);
      let reader: Y.Doc | undefined;
      let readerEditor: Editor | undefined;
      let reopened: Y.Doc | undefined;
      let reopenedEditor: Editor | undefined;
      let candidate: Y.Doc | undefined;
      try {
        editor.commands.insertContent(body);
        reader = copyDocument(owner);
        readerEditor = openEditor(reader, false);
        const relativeRange = captureChatAnchorRange(readerEditor, initialRange)!;
        const proposal = {
          anchor: {
            ...createAnchor({
              baseVersion: null,
              docText: body,
              from: prefix.length,
              to: initialRange.to - 1,
            }),
            relativeRange,
          },
          before: readSuggestionRange(readerEditor.state.doc, initialRange)!.before,
          replacement: 'share the beta',
        };
        const before = side === 'before';
        const pasted = before ? `${lastWord} / ` : ` / ${lastWord}`;
        const changes: unknown[] = [];
        owner.on('update', (_update, origin) => changes.push(origin));
        const previous = Y.encodeStateVector(owner);
        editor.commands.setTextSelection(before ? initialRange.from : initialRange.to);
        expect(editor.view.pasteText(pasted, new Event('paste') as ClipboardEvent)).toBe(true);
        expect(changes).toEqual([ySyncPluginKey]);
        const remote = Symbol('remote');
        const peerChanges: unknown[] = [];
        reader.on('update', (_update, origin) => peerChanges.push(origin));
        Y.applyUpdate(reader, Y.encodeStateAsUpdate(owner, previous), remote);
        expect(peerChanges).toEqual([remote]);
        reopened = copyDocument(reader);
        reopenedEditor = openEditor(reopened, false);
        const expectedText = before
          ? prefix + pasted + lastWord + suffix
          : prefix + lastWord + pasted + suffix;
        const from = initialRange.from + (before ? pasted.length : 0);
        for (const view of [editor, readerEditor, reopenedEditor]) {
          expect(view.getText()).toBe(expectedText);
          expect(resolveChatAnchorRange(view, relativeRange)).toEqual({
            from,
            to: from + lastWord.length,
          });
        }

        candidate = copyDocument(reopened);
        const decision = prepareRoomSuggestionDecision(candidate, proposal);
        expect(decision).not.toBeNull();
        Y.applyUpdate(reopened, decision!);
        expect(reopenedEditor.getText()).toBe(
          before
            ? prefix + pasted + proposal.replacement + suffix
            : prefix + proposal.replacement + pasted + suffix,
        );
      } finally {
        editor.destroy();
        readerEditor?.destroy();
        reopenedEditor?.destroy();
        owner.destroy();
        reader?.destroy();
        reopened?.destroy();
        candidate?.destroy();
      }
    },
  );

  it('tracks exact repeated insertions and deletions and lets native undo restore the range', () => {
    const room = new Y.Doc();
    const editor = openEditor(room);
    try {
      editor.commands.insertContent('A eeee Z');
      const tracked = captureChatAnchorRange(editor, { from: 5, to: 6 })!;
      const undoManager = yUndoPluginKey.getState(editor.state).undoManager as Y.UndoManager;
      undoManager.stopCapturing();
      editor.view.dispatch(editor.state.tr.insertText('e', 4));
      expect(editor.getText()).toBe('A eeeee Z');
      expect(resolveChatAnchorRange(editor, tracked)).toEqual({ from: 6, to: 7 });
      undoManager.stopCapturing();
      editor.view.dispatch(editor.state.tr.delete(4, 5));
      expect(editor.getText()).toBe('A eeee Z');
      expect(resolveChatAnchorRange(editor, tracked)).toEqual({ from: 5, to: 6 });
      expect(editor.commands.undo()).toBe(true);
      expect(editor.getText()).toBe('A eeeee Z');
      expect(resolveChatAnchorRange(editor, tracked)).toEqual({ from: 6, to: 7 });
    } finally {
      editor.destroy();
      room.destroy();
    }
  });

  it('keeps marks, original anchors, and native undo with a marked repeated insertion', () => {
    const room = new Y.Doc();
    const editor = openEditor(room);
    let peer: Y.Doc | undefined;
    let peerEditor: Editor | undefined;
    try {
      editor.commands.setContent(`<p>${prefix}<strong>${lastWord}</strong>${suffix}</p>`);
      const tracked = captureChatAnchorRange(editor, initialRange)!;
      const oldDoc = editor.state.doc;
      const undoManager = yUndoPluginKey.getState(editor.state).undoManager as Y.UndoManager;
      undoManager.stopCapturing();
      const label = `${lastWord} / `;
      const inserted = editor.schema.text(label, [editor.schema.marks.italic.create()]);
      const transaction = editor.state.tr.replaceWith(
        initialRange.from,
        initialRange.from,
        inserted,
      );
      editor.view.dispatch(transaction);
      const movedRange = {
        from: initialRange.from + label.length,
        to: initialRange.to + label.length,
      };
      expect(resolveChatAnchorRange(editor, tracked)).toEqual(movedRange);
      peer = copyDocument(room);
      peerEditor = openEditor(peer, false);
      expect(peerEditor.state.doc.toJSON()).toEqual(transaction.doc.toJSON());
      expect(
        readSuggestionRange(peerEditor.state.doc, movedRange)?.marks.map((mark) => mark.type.name),
      ).toEqual(['bold']);

      expect(editor.commands.undo()).toBe(true);
      expect(editor.state.doc.eq(oldDoc)).toBe(true);
      expect(resolveChatAnchorRange(editor, tracked)).toEqual(initialRange);
    } finally {
      editor.destroy();
      peerEditor?.destroy();
      room.destroy();
      peer?.destroy();
    }
  });

  it('does not transfer a proposal to a deliberately retyped identical selection', () => {
    const room = new Y.Doc();
    const editor = openEditor(room);
    let candidate: Y.Doc | undefined;
    try {
      editor.commands.insertContent(body);
      const relativeRange = captureChatAnchorRange(editor, initialRange)!;
      const proposal = {
        anchor: {
          ...createAnchor({
            baseVersion: null,
            docText: body,
            from: prefix.length,
            to: initialRange.to - 1,
          }),
          relativeRange,
        },
        before: readSuggestionRange(editor.state.doc, initialRange)!.before,
        replacement: 'share the beta',
      };
      const changes: unknown[] = [];
      room.on('update', (_update, origin) => changes.push(origin));
      editor.view.dispatch(
        editor.state.tr.insertText(lastWord, initialRange.from, initialRange.to),
      );
      expect(editor.getText()).toBe(body);
      expect(changes).toEqual([ySyncPluginKey]);
      candidate = copyDocument(room);
      expect(prepareRoomSuggestionDecision(candidate, proposal)).toBeNull();
    } finally {
      editor.destroy();
      room.destroy();
      candidate?.destroy();
    }
  });
});
