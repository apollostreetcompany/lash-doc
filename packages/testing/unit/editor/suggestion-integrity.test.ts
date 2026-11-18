import { createAnchor, type ReviewProposal } from '@lash/doc-chat';
import {
  createLashEditorExtensions,
  prepareSuggestionReplacement,
  readSuggestionRange,
} from '@lash/editor-core';
import { getSchema } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import {
  absolutePositionToRelativePosition,
  initProseMirrorDoc,
  prosemirrorToYDoc,
} from 'y-prosemirror';
import * as Y from 'yjs';

import {
  loadLocalDocumentBody,
  localBodyExpectedRevision,
  saveLocalDocumentBody,
} from '../../../../apps/web/lib/localDocumentBodyPersistence';
import {
  mapLocalSuggestions,
  type LocalSuggestion,
} from '../../../../apps/web/lib/localSuggestions';
import {
  createRoomCommentReviewAccess,
  isCurrentRoomSuggestion,
  prepareRoomSuggestionDecision,
} from '../../../realtime-worker/src/collaboratorSuggestion';

const schema = getSchema(createLashEditorExtensions());
const quote = 'publish the beta';
const replacement = 'share the beta';
const headline = schema.node('heading', { level: 2, id: 'notes' }, schema.text('Notes'));
const paragraph = schema.node('paragraph', null, [
  schema.text(`${quote} before `),
  schema.text(quote, [schema.mark('bold')]),
  schema.text(' after.'),
]);
const document = schema.node('doc', null, [headline, paragraph]);
const paragraphText = paragraph.textContent;
const start = headline.nodeSize + 1 + paragraphText.lastIndexOf(quote);
const range = { from: start, to: start + quote.length };
const target = readSuggestionRange(document, range)!;
const local: LocalSuggestion = {
  id: 'ba7bbce0-bf93-4a19-b63d-42cae6231111',
  before: target.before,
  replacement,
  quote,
  range,
  note: '',
  createdAt: '2026-11-18T00:00:00.000Z',
};

const clone = (room: Y.Doc) => {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(room));
  return copy;
};

const roomDocument = (room: Y.Doc): Node =>
  initProseMirrorDoc(room.getXmlFragment('content'), schema).doc;

const proposalFor = (room: Y.Doc, replacementText = replacement): ReviewProposal => {
  const content = room.getXmlFragment('content');
  const { mapping } = initProseMirrorDoc(content, schema);
  const start = absolutePositionToRelativePosition(range.from, content, mapping);
  const end = absolutePositionToRelativePosition(range.to, content, mapping);
  const pos = Y.createAbsolutePositionFromRelativePosition(end, room)!;
  return {
    anchor: {
      ...createAnchor({
        baseVersion: null,
        docText: paragraphText,
        from: paragraphText.lastIndexOf(quote),
        to: paragraphText.lastIndexOf(quote) + quote.length,
      }),
      relativeRange: {
        start: Y.relativePositionToJSON(start),
        end: Y.relativePositionToJSON(
          Y.createRelativePositionFromTypeIndex(pos.type, pos.index, -1),
        ),
      },
    },
    replacement: replacementText,
    before: target.before,
  };
};

const yText = (room: Y.Doc) =>
  (room.getXmlFragment('content').get(1) as Y.XmlElement).get(0) as Y.XmlText;

describe('targeted writing suggestions', () => {
  it('maps a local proposal across adjacent edits and preserves structure and marks', () => {
    const state = EditorState.create({ doc: document });
    const tr = state.tr.insertText('new ', range.from).insertText(' old', range.to + 4);
    const [mapped] = mapLocalSuggestions([local], tr);
    expect(mapped.range).toEqual({ from: range.from + 4, to: range.to + 4 });
    const result = prepareSuggestionReplacement(tr.doc, mapped.range!, mapped.before, replacement);
    expect(result?.doc.firstChild?.eq(headline)).toBe(true);
    expect(result?.doc.lastChild?.textContent).toBe(
      `${quote} before new ${replacement} old after.`,
    );
    expect(
      readSuggestionRange(result!.doc, {
        from: mapped.range!.from,
        to: mapped.range!.from + replacement.length,
      })?.marks.map((mark) => mark.type.name),
    ).toEqual(['bold']);
  });

  it('invalidates local deletion or replacement of the original occurrence', () => {
    const state = EditorState.create({ doc: document });
    const tr = state.tr.insertText(quote, range.from, range.to);
    expect(mapLocalSuggestions([local], tr)[0].range).toBeNull();
    const styled = state.tr.removeMark(range.from, range.to, schema.marks.bold);
    expect(mapLocalSuggestions([local], styled)[0].range).toBeNull();
    expect(readSuggestionRange(document, { from: 1, to: range.to })).toBeNull();
  });

  it('reopens the body and decision from the same verified local revision', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const settings = {
      storage,
      documentId: 'suggestion-draft',
      validateSchema: (value: unknown) => schema.nodeFromJSON(value).check(),
    };
    const initial = saveLocalDocumentBody({
      ...settings,
      doc: document.toJSON(),
      expected: null,
      suggestions: [local],
    });
    const prepared = prepareSuggestionReplacement(document, range, target.before, replacement)!;
    const accepted = { ...local, decision: { action: 'accepted' as const, at: local.createdAt } };
    saveLocalDocumentBody({
      ...settings,
      doc: prepared.doc.toJSON(),
      expected: localBodyExpectedRevision(initial),
      suggestions: [accepted],
    });
    expect(() =>
      saveLocalDocumentBody({
        ...settings,
        doc: document.toJSON(),
        expected: localBodyExpectedRevision(initial),
        suggestions: [local],
      }),
    ).toThrow(/changed/i);
    expect(loadLocalDocumentBody(settings)).toMatchObject({
      state: 'ready',
      envelope: { doc: prepared.doc.toJSON(), suggestions: [accepted] },
    });
  });

  it('only changes the intended formatted occurrence after remote boundary edits', () => {
    const room = prosemirrorToYDoc(document, 'content');
    const proposal = proposalFor(room);
    const offset = paragraphText.lastIndexOf(quote);
    expect(isCurrentRoomSuggestion(clone(room), proposal)).toBe(true);
    const concurrent = clone(room);
    const vector = Y.encodeStateVector(concurrent);
    yText(concurrent).insert(offset, 'new ', {});
    yText(concurrent).insert(offset + 4 + quote.length, ' old', {});
    Y.applyUpdate(room, Y.encodeStateAsUpdate(concurrent, vector));
    const delta = prepareRoomSuggestionDecision(clone(room), proposal);
    expect(delta).not.toBeNull();
    Y.applyUpdate(room, delta!);
    Y.applyUpdate(concurrent, delta!);
    Y.applyUpdate(room, delta!);
    const next = roomDocument(room);
    expect(roomDocument(concurrent).eq(next)).toBe(true);
    expect(next.firstChild?.eq(headline)).toBe(true);
    expect(next.lastChild?.textContent).toBe(`${quote} before new ${replacement} old after.`);
    expect(next.lastChild?.child(1).marks.map((mark) => mark.type.name)).toEqual(['bold']);
    expect(prepareRoomSuggestionDecision(clone(room), proposal)).toBeNull();
  });

  it('refuses a replaced CRDT identity even when the new quote is identical', () => {
    const room = prosemirrorToYDoc(document, 'content');
    const proposal = proposalFor(room);
    const offset = paragraphText.lastIndexOf(quote);
    yText(room).delete(offset, quote.length);
    yText(room).insert(offset, quote, { bold: {} });
    expect(roomDocument(room).eq(document)).toBe(true);
    expect(isCurrentRoomSuggestion(clone(room), proposal)).toBe(false);
    expect(prepareRoomSuggestionDecision(clone(room), proposal)).toBeNull();
  });

  it('shares read-only validation for several proposals and rechecks formatting on a fresh pass', () => {
    const room = prosemirrorToYDoc(document, 'content');
    try {
      const proposal = proposalFor(room);
      const alternate = { ...proposal, replacement: 'open the beta' };
      const original = Y.encodeStateAsUpdate(room);
      const access = createRoomCommentReviewAccess(room);
      expect(access.readAnchor(proposal.anchor)?.token.text).toBe(quote);
      expect(access.validateProposal(proposal)).toBe(true);
      expect(access.validateProposal(alternate)).toBe(true);
      expect(Y.encodeStateAsUpdate(room)).toEqual(original);

      yText(room).format(paragraphText.lastIndexOf(quote), quote.length, { bold: null });
      const next = createRoomCommentReviewAccess(room);
      expect(next.readAnchor(proposal.anchor)?.token.text).toBe(quote);
      expect(next.validateProposal(proposal)).toBe(false);
      expect(next.validateProposal(alternate)).toBe(false);
      expect(prepareRoomSuggestionDecision(room, proposal)).toBeNull();
    } finally {
      room.destroy();
    }
  });

  it('accepts an explicit deletion and leaves the first occurrence intact', () => {
    const room = prosemirrorToYDoc(document, 'content');
    const delta = prepareRoomSuggestionDecision(clone(room), proposalFor(room, ''));
    expect(delta).not.toBeNull();
    Y.applyUpdate(room, delta!);
    expect(roomDocument(room).lastChild?.textContent).toBe(`${quote} before  after.`);
  });
});
