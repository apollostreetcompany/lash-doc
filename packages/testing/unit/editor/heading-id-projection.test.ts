/** @vitest-environment jsdom */

import { createLashEditorExtensions, projectDocumentHeadingIds } from '@lash/editor-core';
import type { JSONContent } from '@tiptap/core';
import { Editor } from '@tiptap/core';
import { Schema } from '@tiptap/pm/model';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';

import {
  createHeadingIdPlugin,
  headingInputStabilityKey,
} from '../../../editor-core/src/plugins/heading-id';

const schemaEditor = new Editor({
  extensions: createLashEditorExtensions(),
  content: '<p></p>',
});
const schema = schemaEditor.schema;
schemaEditor.destroy();

const heading = (level: 1 | 2 | 3, text: string, headingId?: unknown): JSONContent => ({
  type: 'heading',
  attrs: {
    level,
    ...(headingId !== undefined ? { headingId } : {}),
  },
  ...(text ? { content: [{ type: 'text', text }] } : {}),
});

const paragraph = (text: string): JSONContent => ({
  type: 'paragraph',
  ...(text ? { content: [{ type: 'text', text }] } : {}),
});

const docFrom = (content: JSONContent[]): ProseMirrorNode =>
  schema.nodeFromJSON({
    type: 'doc',
    content,
  });

const headingEntries = (doc: ProseMirrorNode) => {
  const entries: Array<{ pos: number; headingId: unknown; level: unknown; text: string }> = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      entries.push({
        pos,
        headingId: node.attrs.headingId,
        level: node.attrs.level,
        text: node.textContent,
      });
    }
    return true;
  });
  return entries;
};

const derivedId = (pos: number) => `heading-${pos.toString(36)}`;

describe('projectDocumentHeadingIds', () => {
  it('projects exact base36 ids for H1/H2/H3 at the diagnostic positions', () => {
    const source = docFrom([
      heading(1, 'a'.repeat(85)),
      heading(2, 'b'.repeat(85)),
      heading(3, 'c'),
    ]);

    const projected = projectDocumentHeadingIds(source);

    expect(headingEntries(source).map(({ pos }) => pos)).toEqual([0, 87, 174]);
    expect(headingEntries(projected)).toEqual([
      { pos: 0, headingId: 'heading-0', level: 1, text: 'a'.repeat(85) },
      { pos: 87, headingId: 'heading-2f', level: 2, text: 'b'.repeat(85) },
      { pos: 174, headingId: 'heading-4u', level: 3, text: 'c' },
    ]);
  });

  it('preserves the first trimmed duplicate owner exactly and repairs later duplicates', () => {
    const source = docFrom([
      heading(1, 'First', '  shared-id  '),
      heading(2, 'Second', '\tshared-id\n'),
    ]);

    const projected = projectDocumentHeadingIds(source);
    const entries = headingEntries(projected);

    expect(entries[0]?.headingId).toBe('  shared-id  ');
    expect(entries[1]?.headingId).toBe(derivedId(entries[1]!.pos));
  });

  it('repairs missing, non-string, and blank ids in original document order', () => {
    const source = docFrom([
      heading(1, 'Missing'),
      heading(2, 'Non-string', 42),
      heading(3, 'Blank', ' \t\n '),
    ]);

    const projected = projectDocumentHeadingIds(source);

    expect(
      headingEntries(projected).map(({ pos, headingId }) => headingId === derivedId(pos)),
    ).toEqual([true, true, true]);
  });

  it('reserves later owners before assigning an earlier missing id', () => {
    const source = docFrom([heading(1, ''), heading(2, 'Owner', 'heading-0')]);

    expect(
      headingEntries(projectDocumentHeadingIds(source)).map(({ headingId }) => headingId),
    ).toEqual(['heading-0-2', 'heading-0']);
  });

  it('skips every reserved suffix collision before reserving a generated id', () => {
    const source = docFrom([
      heading(1, ''),
      heading(1, 'Base owner', 'heading-0'),
      heading(2, 'Second owner', 'heading-0-2'),
      heading(3, 'Third owner', 'heading-0-3'),
    ]);

    expect(
      headingEntries(projectDocumentHeadingIds(source)).map(({ headingId }) => headingId),
    ).toEqual(['heading-0-4', 'heading-0', 'heading-0-2', 'heading-0-3']);
  });

  it('projects nested headings where the active schema permits them', () => {
    const source = docFrom([
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [heading(2, 'Nested heading')],
              },
            ],
          },
        ],
      },
    ]);
    const sourceEntry = headingEntries(source)[0]!;

    expect(headingEntries(projectDocumentHeadingIds(source))).toEqual([
      {
        ...sourceEntry,
        headingId: derivedId(sourceEntry.pos),
      },
    ]);
  });

  it('returns the original reference when no heading needs repair', () => {
    const withoutHeadings = docFrom([paragraph('Body')]);
    const validHeadings = docFrom([heading(1, 'Owned', 'existing')]);

    expect(projectDocumentHeadingIds(withoutHeadings)).toBe(withoutHeadings);
    expect(projectDocumentHeadingIds(validHeadings)).toBe(validHeadings);
  });

  it('is deterministic, idempotent, and does not mutate the source document', () => {
    const source = docFrom([
      heading(1, 'First'),
      paragraph('Body'),
      heading(2, 'Second', 'duplicate'),
      heading(3, 'Third', 'duplicate'),
    ]);
    const before = source.toJSON();

    const first = projectDocumentHeadingIds(source);
    const secondFromSource = projectDocumentHeadingIds(source);
    const idempotent = projectDocumentHeadingIds(first);

    expect(source.toJSON()).toEqual(before);
    expect(first).not.toBe(source);
    expect(secondFromSource.toJSON()).toEqual(first.toJSON());
    expect(idempotent).toBe(first);
  });

  it('preserves every non-heading node, mark, content byte, and non-id attribute', () => {
    const source = docFrom([
      heading(3, 'Title'),
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: true },
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'linked',
                    marks: [
                      { type: 'link', attrs: { href: 'https://example.com', target: '_blank' } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
    const sourceJson = source.toJSON();
    const projectedJson = projectDocumentHeadingIds(source).toJSON();

    expect(projectedJson).toEqual({
      ...sourceJson,
      content: [
        {
          ...sourceJson.content[0],
          attrs: {
            ...sourceJson.content[0].attrs,
            headingId: 'heading-0',
          },
        },
        sourceJson.content[1],
      ],
    });
  });

  it('matches the real plugin output while retaining targeted steps and stability metadata', () => {
    const source = docFrom([
      heading(1, ''),
      heading(2, 'First owner', 'duplicate'),
      heading(3, 'Later duplicate', 'duplicate'),
      paragraph('Trigger'),
    ]);
    const plugin = createHeadingIdPlugin();
    const state = EditorState.create({
      schema,
      doc: source,
      plugins: [plugin],
    });
    let paragraphPos = -1;
    state.doc.descendants((node, pos) => {
      if (paragraphPos === -1 && node.type.name === 'paragraph') {
        paragraphPos = pos;
      }
      return true;
    });
    const trigger = state.tr.setNodeMarkup(
      paragraphPos,
      undefined,
      state.doc.nodeAt(paragraphPos)?.attrs,
    );
    const projected = projectDocumentHeadingIds(trigger.doc);

    const applied = state.applyTransaction(trigger);

    expect(applied.transactions).toHaveLength(2);
    const appended = applied.transactions[1]!;
    expect(appended.steps).toHaveLength(2);
    expect(appended.steps.map((step) => step.toJSON().stepType)).toEqual([
      'replaceAround',
      'replaceAround',
    ]);
    const repairedPositions = headingEntries(source)
      .filter(({ headingId }, index) => !headingId || index === 2)
      .map(({ pos }) => pos);
    expect(
      appended.steps.map((step) => {
        const json = step.toJSON() as {
          from: number;
          gapFrom: number;
          gapTo: number;
          to: number;
        };
        return {
          from: json.from,
          gapFromOffset: json.gapFrom - json.from,
          gapToOffset: json.to - json.gapTo,
          replacedNodeSize: json.to - json.from,
        };
      }),
    ).toEqual(
      repairedPositions.map((pos) => ({
        from: pos,
        gapFromOffset: 1,
        gapToOffset: 1,
        replacedNodeSize: source.nodeAt(pos)!.nodeSize,
      })),
    );
    expect(appended.getMeta(headingInputStabilityKey)).toBe('arm');
    expect(applied.state.doc.toJSON()).toEqual(projected.toJSON());
  });

  it('keeps the first typed character and heading id stable after converting an empty block', () => {
    const editor = new Editor({
      extensions: createLashEditorExtensions(),
      content: '<p></p>',
    });

    expect(editor.commands.toggleHeading({ level: 2 })).toBe(true);
    const before = headingEntries(editor.state.doc)[0]!;
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp('handleTextInput', (handler) =>
      handler(editor.view, from, to, 'A'),
    );
    const after = headingEntries(editor.state.doc)[0]!;

    expect(handled).toBe(true);
    expect(after.text).toBe('A');
    expect(after.headingId).toBe(before.headingId);
    editor.destroy();
  });

  it('advances the caret on first input after a heading or paragraph split', () => {
    const editor = new Editor({
      extensions: createLashEditorExtensions(),
      content: { type: 'doc', content: [heading(1, 'Chapter One', 'chapter')] },
    });
    try {
      const end = () => editor.state.doc.content.size - 1;
      editor.commands.setTextSelection(end());
      expect(editor.commands.splitBlock()).toBe(true);
      expect(headingInputStabilityKey.getState(editor.state)).toBe(true);
      const position = editor.state.selection.from;
      expect(
        editor.view.someProp('handleTextInput', (insert) =>
          insert(editor.view, position, position, 'O', () =>
            editor.state.tr.insertText('O', position),
          ),
        ),
      ).toBe(true);
      expect(editor.state.selection.from).toBe(position + 1);
      expect(editor.state.doc.lastChild?.textContent).toBe('O');
      expect(headingEntries(editor.state.doc)).toEqual([
        { pos: 0, headingId: 'chapter', level: 1, text: 'Chapter One' },
      ]);
      expect(headingInputStabilityKey.getState(editor.state)).toBe(false);

      editor.commands.setTextSelection(end());
      expect(editor.commands.splitBlock()).toBe(true);
      expect(headingInputStabilityKey.getState(editor.state)).toBe(true);
      editor.commands.setTextSelection(1);
      expect(headingInputStabilityKey.getState(editor.state)).toBe(false);
    } finally {
      editor.destroy();
    }
  });

  it('throws for a heading schema that cannot represent the required id', () => {
    const incompatibleSchema = new Schema({
      nodes: {
        doc: { content: 'heading+' },
        heading: { content: 'text*' },
        text: {},
      },
    });
    const incompatibleDoc = incompatibleSchema.node(
      'doc',
      null,
      incompatibleSchema.node('heading', null, incompatibleSchema.text('Title')),
    );

    expect(() => projectDocumentHeadingIds(incompatibleDoc)).toThrow(/headingId/u);
  });
});
