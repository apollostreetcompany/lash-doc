import {
  EMPTY_HISTORY_DOC,
  computeDiff,
  createHistoryStore,
  replayOps,
  type AppendInput,
  type HistoryCommitOptions,
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
  options: HistoryCommitOptions = { commitGuard: () => true },
) =>
  store.append(
    {
      docId,
      actor: actorOverride,
      expectedParentSha,
      schemaVersion: 'lash-schema-v1',
      ops: [{ op: 'replace_text', from, to, text }],
      intent: actorOverride.type === 'ai' ? 'ai' : 'edit',
      audit,
    },
    options,
  );

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

  it('rejects an append revoked while result hashing is in flight without publishing partial state', async () => {
    const store = createHistoryStore({ now: () => '2026-05-16T03:40:00.000Z' });
    const emptySha = await hashCanonical(EMPTY_HISTORY_DOC);
    await expect(store.loadAt(docId, emptySha)).resolves.toEqual(EMPTY_HISTORY_DOC);

    let authorized = true;
    const pending = appendText(store, emptySha, 0, 0, 'revoked', actor, {
      commitGuard: () => authorized,
    });
    await Promise.resolve();
    authorized = false;

    await expect(pending).resolves.toEqual({
      ok: false,
      reason: 'commit-rejected',
      cause: 'guard-denied',
    });
    expect(await store.list(docId)).toEqual([]);
    const rejectedSha = await hashCanonical({ type: 'doc', text: 'revoked' });
    await expect(store.loadAt(docId, rejectedSha)).rejects.toThrow(
      `history.loadAt: unknown version ${rejectedSha}`,
    );

    const retry = await appendText(store, emptySha, 0, 0, 'approved');
    expect(retry.ok).toBe(true);
  });

  it('treats false and throwing commit guards as rejections without moving the head', async () => {
    const store = createHistoryStore({ now: () => '2026-05-16T03:40:00.000Z' });
    const emptySha = await hashCanonical(EMPTY_HISTORY_DOC);
    const throwingGuard = () => {
      throw new Error('authority epoch is stale');
    };

    const [stale, throwing] = await Promise.all([
      appendText(store, emptySha, 0, 0, 'stale', actor, {
        commitGuard: () => false,
      }),
      appendText(store, emptySha, 0, 0, 'throwing', actor, {
        commitGuard: throwingGuard,
      }),
    ]);

    expect(stale).toEqual({
      ok: false,
      reason: 'commit-rejected',
      cause: 'guard-denied',
    });
    expect(throwing).toEqual({
      ok: false,
      reason: 'commit-rejected',
      cause: 'guard-threw',
    });
    expect(await store.list(docId)).toEqual([]);
    const next = await appendText(store, emptySha, 0, 0, 'still current');
    expect(next.ok).toBe(true);
  });

  it.each([
    ['Promise', () => Promise.resolve(true)],
    ['number', () => 1],
    ['object', () => ({ allowed: true })],
  ])(
    'requires literal true instead of accepting a truthy %s guard result',
    async (_label, guard) => {
      const store = createHistoryStore({ now: () => '2026-05-16T03:40:00.000Z' });
      const emptySha = await hashCanonical(EMPTY_HISTORY_DOC);

      const result = await appendText(store, emptySha, 0, 0, 'must not commit', actor, {
        commitGuard: guard as unknown as () => boolean,
      });

      expect(result).toEqual({
        ok: false,
        reason: 'commit-rejected',
        cause: 'guard-denied',
      });
      expect(await store.list(docId)).toEqual([]);
    },
  );

  it('captures the commit guard function identity before the first await', async () => {
    const store = createHistoryStore({ now: () => '2026-05-16T03:40:00.000Z' });
    const emptySha = await hashCanonical(EMPTY_HISTORY_DOC);
    let selectedGuard = () => false;
    let getterReads = 0;
    const options = {
      get commitGuard() {
        getterReads += 1;
        return selectedGuard;
      },
    };

    const pending = appendText(store, emptySha, 0, 0, 'must stay denied', actor, options);
    selectedGuard = () => true;

    await expect(pending).resolves.toEqual({
      ok: false,
      reason: 'commit-rejected',
      cause: 'guard-denied',
    });
    expect(getterReads).toBe(1);
    expect(await store.list(docId)).toEqual([]);
  });

  it('never rereads caller-owned fields after the commit guard approves', async () => {
    const store = createHistoryStore({ now: () => '2026-05-16T03:40:00.000Z' });
    const emptySha = await hashCanonical(EMPTY_HISTORY_DOC);
    const lateReads: Array<keyof AppendInput> = [];
    let guardPassed = false;
    let revoked = false;
    const recordRead = (field: keyof AppendInput) => {
      if (!guardPassed) return;
      lateReads.push(field);
      revoked = true;
    };
    const input: AppendInput = {
      get docId() {
        recordRead('docId');
        return docId;
      },
      get actor() {
        recordRead('actor');
        return actor;
      },
      get expectedParentSha() {
        recordRead('expectedParentSha');
        return emptySha;
      },
      get schemaVersion() {
        recordRead('schemaVersion');
        return 'lash-schema-v1';
      },
      get ops() {
        recordRead('ops');
        return [{ op: 'replace_text', from: 0, to: 0, text: 'guarded' }];
      },
      get intent() {
        recordRead('intent');
        return 'edit';
      },
      get audit() {
        recordRead('audit');
        return audit;
      },
      get restoredFromVersion() {
        recordRead('restoredFromVersion');
        return 'prepared-restore-version';
      },
    };

    const result = await store.append(input, {
      commitGuard: () => {
        guardPassed = true;
        return !revoked;
      },
    });

    expect(result.ok).toBe(true);
    expect(lateReads).toEqual([]);
    expect(revoked).toBe(false);
    if (!result.ok) throw new Error(result.reason);
    expect(result.entry.restoredFromVersion).toBe('prepared-restore-version');
  });

  it('allows exactly one same-parent concurrent append and publishes no losing snapshot', async () => {
    const store = createHistoryStore({
      now: () => '2026-05-16T03:40:00.000Z',
      snapshotInterval: 1,
    });
    const emptySha = await hashCanonical(EMPTY_HISTORY_DOC);
    await store.loadAt(docId, emptySha);

    const [left, right] = await Promise.all([
      appendText(store, emptySha, 0, 0, 'left', actor, { commitGuard: () => true }),
      appendText(store, emptySha, 0, 0, 'right', actor, { commitGuard: () => true }),
    ]);
    const winners = [left, right].filter(
      (result): result is Extract<typeof result, { ok: true }> => result.ok,
    );
    const losers = [left, right].filter(
      (result): result is Extract<typeof result, { ok: false }> => !result.ok,
    );

    expect(winners).toHaveLength(1);
    expect(losers).toEqual([
      {
        ok: false,
        reason: 'parent-mismatch',
        currentHead: winners[0].entry.resultSha,
      },
    ]);
    expect(await store.list(docId)).toEqual([winners[0].entry]);

    const losingText = left.ok ? 'right' : 'left';
    const losingSha = await hashCanonical({ type: 'doc', text: losingText });
    await expect(store.loadAt(docId, losingSha)).rejects.toThrow(
      `history.loadAt: unknown version ${losingSha}`,
    );
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

    const restored = await store.restore(docId, first.entry.resultSha, actor, audit, {
      commitGuard: () => true,
    });
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

  it('applies the same atomic commit guard to restore', async () => {
    const store = createHistoryStore({ now: () => '2026-05-16T03:40:00.000Z' });
    const emptySha = await hashCanonical(EMPTY_HISTORY_DOC);
    const first = await appendText(store, emptySha, 0, 0, 'Hello');
    if (!first.ok) throw new Error(first.reason);
    const second = await appendText(store, first.entry.resultSha, 5, 5, ' world');
    if (!second.ok) throw new Error(second.reason);

    const rejected = await store.restore(docId, first.entry.resultSha, actor, audit, {
      commitGuard: () => false,
    });

    expect(rejected).toEqual({
      ok: false,
      reason: 'commit-rejected',
      cause: 'guard-denied',
    });
    expect(await store.list(docId)).toEqual([first.entry, second.entry]);
    await expect(store.loadAt(docId, second.entry.resultSha)).resolves.toEqual({
      type: 'doc',
      text: 'Hello world',
    });
  });

  it('snapshots restore actor, audit, and guard identity before its first await', async () => {
    const store = createHistoryStore({ now: () => '2026-05-16T03:40:00.000Z' });
    const emptySha = await hashCanonical(EMPTY_HISTORY_DOC);
    const first = await appendText(store, emptySha, 0, 0, 'Hello');
    if (!first.ok) throw new Error(first.reason);
    const second = await appendText(store, first.entry.resultSha, 5, 5, ' world');
    if (!second.ok) throw new Error(second.reason);
    const mutableActor: ActorRef = { type: 'user', id: 'restore-origin' };
    const mutableAudit: HistoryAudit = { ua: 'restore-origin' };
    let selectedGuard = () => false;
    let getterReads = 0;
    const options = {
      get commitGuard() {
        getterReads += 1;
        return selectedGuard;
      },
    };

    const pending = store.restore(
      docId,
      first.entry.resultSha,
      mutableActor,
      mutableAudit,
      options,
    );
    mutableActor.id = 'restore-late';
    mutableAudit.ua = 'restore-late';
    selectedGuard = () => true;

    await expect(pending).resolves.toEqual({
      ok: false,
      reason: 'commit-rejected',
      cause: 'guard-denied',
    });
    expect(getterReads).toBe(1);
    expect(await store.list(docId)).toEqual([first.entry, second.entry]);
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
