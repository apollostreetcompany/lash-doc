import {
  EMPTY_HISTORY_DOC,
  computeDiff,
  createHistoryStore,
  replayOps,
  type HistoryDocumentState,
} from '@lash/history';
import { createDocumentId, hashCanonical, type ActorRef, type HistoryAudit } from '@lash/types';
import { describe, expect, it } from 'vitest';

const actor: ActorRef = { type: 'user', id: 'ada' };
const audit: HistoryAudit = { ua: 'vitest/history-store' };
const docId = createDocumentId('history-doc');

const appendText = async (
  store: ReturnType<typeof createHistoryStore>,
  expectedParentSha: string,
  from: number,
  to: number,
  text: string,
  actorOverride: ActorRef = actor,
) =>
  store.append({
    docId,
    actor: actorOverride,
    expectedParentSha,
    schemaVersion: 'lash-schema-v1',
    ops: [{ op: 'replace_text', from, to, text }],
    intent: actorOverride.type === 'ai' ? 'ai' : 'edit',
    audit,
  });

describe('@lash/history', () => {
  it('replays text ops deterministically', () => {
    expect(replayOps('', [{ op: 'replace_text', from: 0, to: 0, text: 'Hello' }])).toBe('Hello');
    expect(
      replayOps({ type: 'doc', text: 'Hello world' } satisfies HistoryDocumentState, [
        { op: 'delete_range', from: 5, to: 11 },
      ]),
    ).toEqual({ type: 'doc', text: 'Hello' });
  });

  it('appends entries only at the expected parent head', async () => {
    const store = createHistoryStore({ now: () => '2026-05-16T03:40:00.000Z' });
    const emptySha = await hashCanonical(EMPTY_HISTORY_DOC);

    const first = await appendText(store, emptySha, 0, 0, 'Hello');
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.reason);

    expect(first.entry.seq).toBe(1);
    expect(first.entry.parentSha).toBe(emptySha);
    expect(await store.loadAt(docId, first.entry.resultSha)).toEqual({
      type: 'doc',
      text: 'Hello',
    });

    const stale = await appendText(store, emptySha, 5, 5, ' stale');
    expect(stale).toEqual({
      ok: false,
      reason: 'parent-mismatch',
      currentHead: first.entry.resultSha,
    });
  });

  it('lists entries with author, intent, and time filters', async () => {
    const times = ['2026-05-16T03:40:00.000Z', '2026-05-16T03:41:00.000Z'];
    const store = createHistoryStore({ now: () => times.shift() ?? '2026-05-16T03:42:00.000Z' });
    const emptySha = await hashCanonical(EMPTY_HISTORY_DOC);

    const first = await appendText(store, emptySha, 0, 0, 'Hello');
    if (!first.ok) throw new Error(first.reason);
    const second = await appendText(store, first.entry.resultSha, 5, 5, ' AI', {
      type: 'ai',
      id: 'gpt-5p',
    });
    if (!second.ok) throw new Error(second.reason);

    expect(await store.list(docId, { authorType: 'ai' })).toEqual([second.entry]);
    expect(await store.list(docId, { intent: 'edit', until: '2026-05-16T03:40:30.000Z' })).toEqual([
      first.entry,
    ]);
  });

  it('restores by appending a new non-destructive head entry', async () => {
    const store = createHistoryStore({ now: () => '2026-05-16T03:40:00.000Z' });
    const emptySha = await hashCanonical(EMPTY_HISTORY_DOC);

    const first = await appendText(store, emptySha, 0, 0, 'Hello');
    if (!first.ok) throw new Error(first.reason);
    const second = await appendText(store, first.entry.resultSha, 5, 5, ' world');
    if (!second.ok) throw new Error(second.reason);

    const restored = await store.restore(docId, first.entry.resultSha, actor, audit);
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.reason);

    expect(restored.entry.seq).toBe(3);
    expect(restored.entry.restoredFromVersion).toBe(first.entry.resultSha);
    expect(restored.entry.resultSha).toBe(first.entry.resultSha);
    expect(await store.loadAt(docId, restored.entry.resultSha)).toEqual({
      type: 'doc',
      text: 'Hello',
    });
    expect((await store.list(docId)).map((entry) => entry.resultSha)).toEqual([
      first.entry.resultSha,
      second.entry.resultSha,
      first.entry.resultSha,
    ]);
  });

  it('computes byte-stable diff output from history entries', async () => {
    const store = createHistoryStore({ now: () => '2026-05-16T03:40:00.000Z' });
    const emptySha = await hashCanonical(EMPTY_HISTORY_DOC);

    const first = await appendText(store, emptySha, 0, 0, 'Hello');
    if (!first.ok) throw new Error(first.reason);
    const second = await appendText(store, first.entry.resultSha, 5, 5, ' world');
    if (!second.ok) throw new Error(second.reason);
    const entries = await store.list(docId);

    const diffA = computeDiff(first.entry.resultSha, second.entry.resultSha, entries);
    const diffB = computeDiff(first.entry.resultSha, second.entry.resultSha, entries);

    expect(diffA).toEqual(diffB);
    expect(diffA.spans.map((span) => span.kind)).toEqual(['unchanged', 'inserted']);
    expect(diffA.spans[1]).toMatchObject({
      kind: 'inserted',
      from: 5,
      to: 11,
      text: ' world',
      authorId: 'ada',
      actorType: 'user',
    });
  });
});
