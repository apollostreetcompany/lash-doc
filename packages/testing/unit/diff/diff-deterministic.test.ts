import { createLashEditorExtensions } from '@lash/editor-core';
import {
  EMPTY_HISTORY_DOC,
  computeDiff,
  createHistoryStore,
  historyBodySnapshotOp,
  type HistoryDocumentState,
} from '@lash/history';
import { createDocumentId, hashCanonical, type ActorRef, type HistoryAudit } from '@lash/types';
import { getSchema, type JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

const schema = getSchema(createLashEditorExtensions());
const text = (value: string, marks?: JSONContent['marks']): JSONContent => ({
  type: 'text',
  text: value,
  marks,
});
const paragraph = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const bold = [{ type: 'bold' }];

const savedBody = (...content: JSONContent[]): HistoryDocumentState => {
  const body = schema.nodeFromJSON({ type: 'doc', content });
  body.check();
  return { type: 'doc', text: body.textBetween(0, body.content.size, '\n'), body: body.toJSON() };
};

describe('diff-deterministic', () => {
  it('returns identical JSON and rendering spans for the same version pair', async () => {
    const docId = createDocumentId('diff-doc');
    const actor: ActorRef = { type: 'user', id: 'lin' };
    const audit: HistoryAudit = { ua: 'vitest/diff-deterministic' };
    const store = createHistoryStore({ now: () => '2026-05-16T04:00:00.000Z' });
    const emptySha = await hashCanonical(EMPTY_HISTORY_DOC);

    const first = await store.append(
      {
        docId,
        actor,
        expectedParentSha: emptySha,
        schemaVersion: 'lash-schema-v1',
        ops: [{ op: 'replace_text', from: 0, to: 0, text: 'Alpha beta' }],
        intent: 'edit',
        audit,
      },
      { commitGuard: () => true },
    );
    if (!first.ok) throw new Error(first.reason);

    const second = await store.append(
      {
        docId,
        actor,
        expectedParentSha: first.entry.resultSha,
        schemaVersion: 'lash-schema-v1',
        ops: [{ op: 'replace_text', from: 6, to: 10, text: 'gamma' }],
        intent: 'edit',
        audit,
      },
      { commitGuard: () => true },
    );
    if (!second.ok) throw new Error(second.reason);

    const entries = await store.list(docId);
    const firstDiff = computeDiff(first.entry.resultSha, second.entry.resultSha, entries);
    const secondDiff = computeDiff(first.entry.resultSha, second.entry.resultSha, entries);

    expect(secondDiff).toEqual(firstDiff);
    expect(firstDiff.spans).toMatchObject([
      { kind: 'unchanged', from: 0, to: 6 },
      { kind: 'deleted', from: 6, to: 6, text: 'bet' },
      { kind: 'inserted', from: 6, to: 10, text: 'gamm' },
      { kind: 'unchanged', from: 10, to: 11 },
    ]);
    expect(firstDiff.spans.map((span) => span.id)).toEqual(secondDiff.spans.map((span) => span.id));
  });

  it.each([
    [
      'typing into an empty paragraph',
      savedBody(paragraph()),
      savedBody(paragraph(text('Draft'))),
      false,
    ],
    [
      'typing in both runs of repeated characters',
      savedBody(paragraph(text('aa'), text('aa', bold))),
      savedBody(paragraph(text('aaa'), text('aaa', bold))),
      false,
    ],
    [
      'typing around retained text inside an existing marked run',
      savedBody(paragraph(text('a'), text('aa', bold))),
      savedBody(paragraph(text('aa'), text('baab', bold))),
      false,
    ],
    [
      'typing in one run and replacing a repeated character in the next',
      savedBody(paragraph(text('aa', bold), text('aa'))),
      savedBody(paragraph(text('aaa', bold), text('ab'))),
      false,
    ],
    [
      'moving a mark boundary while appending text',
      savedBody(paragraph(text('First', bold), text(' draft'))),
      savedBody(paragraph(text('Fir', bold), text('st draft!'))),
      true,
    ],
    [
      'extending bold over existing wording while typing more',
      savedBody(paragraph(text('alpha', bold), text(' beta'))),
      savedBody(paragraph(text('alpha beta', bold), text(' today'))),
      true,
    ],
    [
      'moving a repeated-text mark boundary and typing in a separate paragraph',
      savedBody(paragraph(text('aa '), text('aa', bold)), paragraph(text('Draft'))),
      savedBody(paragraph(text('a'), text('a aa', bold)), paragraph(text('Draft now'))),
      true,
    ],
    [
      'inserting a newly styled word',
      savedBody(paragraph(text('plain'))),
      savedBody(paragraph(text('plain '), text('bold', bold))),
      true,
    ],
    [
      'rewriting the styled word and changing its link',
      savedBody(
        paragraph(text('Draft', [{ type: 'link', attrs: { href: 'https://lash.test/old' } }])),
      ),
      savedBody(
        paragraph(text('Final', [{ type: 'link', attrs: { href: 'https://lash.test/new' } }])),
      ),
      true,
    ],
    [
      'changing heading level and wording',
      savedBody({ type: 'heading', attrs: { level: 1 }, content: [text('Draft')] }),
      savedBody({ type: 'heading', attrs: { level: 2 }, content: [text('Revised draft')] }),
      true,
    ],
    [
      'changing inline formatting without changing text',
      savedBody(paragraph(text('Draft'))),
      savedBody(paragraph(text('Draft', bold))),
      true,
    ],
    [
      'comparing a legacy text snapshot',
      { type: 'doc', text: 'Draft' },
      savedBody(paragraph(text('Revised draft', bold))),
      false,
    ],
  ] as const)('reports formatting accurately when %s', async (_name, before, after, expected) => {
    const docId = createDocumentId('rich-diff');
    const store = createHistoryStore();
    const from = await hashCanonical(before);
    await store.hydrate(docId, before);
    const appended = await store.append(
      {
        docId,
        expectedParentSha: from,
        actor: { type: 'user', id: 'lin' },
        schemaVersion: 'lash-schema-v1',
        ops: [
          ...(before.text === after.text
            ? []
            : [{ op: 'replace_text' as const, from: 0, to: before.text.length, text: after.text }]),
          historyBodySnapshotOp(after, 'body' in before ? before.body : undefined),
        ],
        intent: 'edit',
        audit: { ua: 'vitest' },
      },
      { commitGuard: () => true },
    );
    if (!appended.ok) throw new Error(appended.reason);
    const to = appended.entry.resultSha;
    const result = await store.diff(docId, from, to);
    expect(result.spans.filter(({ kind }) => kind === 'attrChanged')).toHaveLength(
      expected ? 1 : 0,
    );
    expect(result.spans.some(({ kind }) => kind === 'inserted' || kind === 'deleted')).toBe(
      before.text !== after.text,
    );
    expect(computeDiff(from, to, [appended.entry], before)).toEqual(result);
  });

  it('keeps adjacent suggestion attribution and leaves composite wording unattributed', async () => {
    const docId = createDocumentId('multi-author-diff');
    let clock = 0;
    const store = createHistoryStore({
      now: () => new Date(1_800_000_000_000 + clock++).toISOString(),
    });
    const baseline = await hashCanonical(EMPTY_HISTORY_DOC);
    let parent = baseline;
    const save = async (author: string, wording: string, intent: 'edit' | 'suggest' = 'edit') => {
      const entry = await store.append(
        {
          docId,
          expectedParentSha: parent,
          actor: { type: 'user', id: author },
          schemaVersion: 'lash-schema-v1',
          ops: [historyBodySnapshotOp({ type: 'doc', text: wording })],
          intent,
          audit: { ua: 'vitest' },
        },
        { commitGuard: () => true },
      );
      if (!entry.ok) throw new Error(entry.reason);
      parent = entry.entry.resultSha;
      return entry.entry;
    };

    const first = await save('ada', 'A draft.');
    const second = await save('bea', 'A revised draft.');
    const third = await save('cy', 'Our revised draft.', 'suggest');
    expect((await store.diff(docId, second.resultSha, third.resultSha)).spans).toMatchObject([
      {
        kind: 'deleted',
        text: 'A',
        entryId: third.id,
        authorId: 'cy',
        intent: 'suggest',
        ts: third.ts,
      },
      { kind: 'inserted', text: 'Our', entryId: third.id, authorId: 'cy', intent: 'suggest' },
      { kind: 'unchanged' },
    ]);
    const compare = () => store.diff(docId, first.resultSha, third.resultSha);
    const changed = (await compare()).spans.filter(({ kind }) => kind !== 'unchanged');
    expect(changed).toEqual([
      { kind: 'deleted', from: 0, to: 0, text: 'A', id: expect.any(String) },
      { kind: 'inserted', from: 0, to: 11, text: 'Our revised', id: expect.any(String) },
    ]);

    const restore = async (sha: string) => {
      const restored = await store.restore(
        docId,
        sha,
        { type: 'user', id: 'dee' },
        { ua: 'vitest' },
        { commitGuard: () => true },
      );
      if (!restored.ok) throw new Error(restored.reason);
      expect(restored.entry.resultSha).toBe(sha);
    };
    const unqualified = async (from: string, to: string) => {
      const comparison = await store.diff(docId, from, to);
      const textSpans = comparison.spans.filter(
        ({ kind }) => kind === 'inserted' || kind === 'deleted',
      );
      expect(textSpans.length).toBeGreaterThan(0);
      expect(textSpans.every((span) => !('entryId' in span))).toBe(true);
      expect(computeDiff(from, to, await store.list(docId))).toEqual(comparison);
    };

    await restore(baseline);
    await unqualified(baseline, first.resultSha);
    await unqualified(third.resultSha, baseline);
    await restore(third.resultSha);
    await unqualified(second.resultSha, third.resultSha);
    await restore(first.resultSha);
    await unqualified(first.resultSha, second.resultSha);
  });
});
