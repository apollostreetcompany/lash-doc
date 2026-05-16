import { EMPTY_HISTORY_DOC, computeDiff, createHistoryStore } from '@lash/history';
import { createDocumentId, hashCanonical, type ActorRef, type HistoryAudit } from '@lash/types';
import { describe, expect, it } from 'vitest';

describe('diff-deterministic', () => {
  it('returns identical JSON and rendering spans for the same version pair', async () => {
    const docId = createDocumentId('diff-doc');
    const actor: ActorRef = { type: 'user', id: 'lin' };
    const audit: HistoryAudit = { ua: 'vitest/diff-deterministic' };
    const store = createHistoryStore({ now: () => '2026-05-16T04:00:00.000Z' });
    const emptySha = await hashCanonical(EMPTY_HISTORY_DOC);

    const first = await store.append({
      docId,
      actor,
      expectedParentSha: emptySha,
      schemaVersion: 'lash-schema-v1',
      ops: [{ op: 'replace_text', from: 0, to: 0, text: 'Alpha beta' }],
      intent: 'edit',
      audit,
    });
    if (!first.ok) throw new Error(first.reason);

    const second = await store.append({
      docId,
      actor,
      expectedParentSha: first.entry.resultSha,
      schemaVersion: 'lash-schema-v1',
      ops: [{ op: 'replace_text', from: 6, to: 10, text: 'gamma' }],
      intent: 'edit',
      audit,
    });
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
});
