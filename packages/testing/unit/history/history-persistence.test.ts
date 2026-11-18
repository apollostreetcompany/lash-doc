
import {
  EMPTY_HISTORY_DOC,
  createHistoryStore,
  entryHasHistoryBody,
  historyBodySnapshotOp,
  type HistoryDocumentState,
  type HistoryPersistenceAdapter,
  type HistoryPersistenceCommitInput,
  type HistoryPersistenceCommitResult,
} from '@lash/history';
import { createDocumentId } from '@lash/types';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

class MemoryHistoryPersistence implements HistoryPersistenceAdapter {
  primary = new Map<string, string>();
  backup = new Map<string, string>();

  async read(documentId: string) {
    return {
      primaryRaw: this.primary.get(documentId) ?? null,
      backupRaw: this.backup.get(documentId) ?? null,
    };
  }

  async commit(input: HistoryPersistenceCommitInput): Promise<HistoryPersistenceCommitResult> {
    const currentRaw = this.primary.get(input.documentId) ?? null;
    if (currentRaw !== input.expectedPrimaryRaw) {
      return { ok: false, reason: 'cas-mismatch', currentRaw };
    }

    let guardResult: unknown;
    try {
      guardResult = input.commitGuard();
    } catch {
      return { ok: false, reason: 'guard-threw' };
    }
    if (guardResult !== true) {
      return { ok: false, reason: 'guard-denied' };
    }

    if (currentRaw !== null) {
      this.backup.set(input.documentId, currentRaw);
    }
    this.primary.set(input.documentId, input.nextPrimaryRaw);
    return { ok: true, primaryRaw: input.nextPrimaryRaw };
  }
}

const appendText = async (
  store: ReturnType<typeof createHistoryStore>,
  documentId: ReturnType<typeof createDocumentId>,
  expectedParentSha: string,
  before: string,
  after: string,
) =>
  store.append(
    {
      docId: documentId,
      actor: { type: 'user', id: 'local-user' },
      expectedParentSha,
      schemaVersion: 'lash-schema-v1',
      ops: [{ op: 'replace_text', from: 0, to: before.length, text: after }],
      intent: 'edit',
      audit: { ua: 'history-persistence-test' },
    },
    { commitGuard: () => true },
  );

describe('durable local history projection', () => {
  it('keeps structured versions with embedded image bytes through 101 edits, reload, and restore', async () => {
    const persistence = new MemoryHistoryPersistence();
    const documentId = createDocumentId('history-rich-media');
    const media = (await readFile(new URL('../../../../artifacts/stranger-test/baseline/desktop-formatting-success.png', import.meta.url))).toString('base64');
    const image = { type: 'image', attrs: { src: `data:image/png;base64,${media}`, alt: 'Fixture image' } };
    const historicalBody = (index: number) => ({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2, headingId: 'fixture' }, content: [{ type: 'text', text: 'Agenda' }] },
        image,
        { type: 'paragraph', content: [{ type: 'text', text: `Revision ${index}`, marks: [{ type: 'bold' }] }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'List item' }] }] }] },
      ],
    });
    const snapshot = (index: number): HistoryDocumentState => ({
      type: 'doc', text: `Agenda\nRevision ${index}\nList item`, body: historicalBody(index),
    });
    const options = { snapshotInterval: 48, persistence };
    const store = createHistoryStore(options);
    const baseline = await store.hydrate(documentId, snapshot(0));
    if (baseline.state !== 'empty-baseline') throw new Error('expected baseline');
    const actor = { type: 'user', id: 'local-user' } as const;
    const audit = { ua: 'history-media-test' };
    const guard = { commitGuard: () => true };
    let current = baseline.head;
    let historical = '';
    for (let index = 1; index <= 101; index += 1) {
      const before = snapshot(index - 1);
      const after = snapshot(index);
      const result = await store.append({
        docId: documentId, actor, expectedParentSha: current, schemaVersion: 'lash-schema-v1',
        ops: [
          { op: 'replace_text', from: 0, to: before.text.length, text: after.text },
          historyBodySnapshotOp(after, before.body),
        ],
        intent: 'edit', audit,
      }, guard);
      if (!result.ok) throw new Error(result.reason);
      expect(entryHasHistoryBody(result.entry)).toBe(true);
      expect(JSON.stringify(result.entry)).not.toContain(media);
      current = result.entry.resultSha;
      if (index === 5) historical = current;
    }
    const raw = persistence.primary.get(String(documentId))!;
    expect(raw.split(media)).toHaveLength(4); // baseline and two retained checkpoints
    const reopened = createHistoryStore(options);
    await expect(reopened.hydrate(documentId)).resolves.toMatchObject({ state: 'ready', entryCount: 101, head: current });
    await expect(reopened.loadAt(documentId, historical)).resolves.toEqual(snapshot(5));
    await expect(reopened.diff(documentId, historical, current)).resolves.toMatchObject({
      spans: expect.arrayContaining([expect.objectContaining({ kind: 'inserted', text: '101' })]),
    });
    const restore = await reopened.restore(documentId, historical, actor, audit, guard);
    expect(restore).toMatchObject({ ok: true, entry: { seq: 102, parentSha: current, restoredFromVersion: historical } });
    if (!restore.ok) throw new Error(restore.reason);
    await expect(reopened.loadAt(documentId, restore.entry.resultSha)).resolves.toEqual(snapshot(5));
    await expect(reopened.loadAt(documentId, current)).resolves.toEqual(snapshot(101));
  }, 30_000);

  it('hydrates the exact ordered timeline in a new store and keeps Restore append-only', async () => {
    const persistence = new MemoryHistoryPersistence();
    const documentId = createDocumentId('history-durable-a');
    const firstStore = createHistoryStore({
      snapshotInterval: 20,
      persistence,
      now: () => '2026-07-30T00:00:00.000Z',
    });

    const empty = await firstStore.hydrate(documentId, EMPTY_HISTORY_DOC);
    expect(empty.state).toBe('empty-baseline');
    if (empty.state !== 'empty-baseline') throw new Error('expected empty baseline');

    const first = await appendText(firstStore, documentId, empty.head, '', 'Alpha launch note');
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.reason);

    const reloadedStore = createHistoryStore({
      snapshotInterval: 20,
      persistence,
      now: () => '2026-07-30T00:00:01.000Z',
    });
    const hydrated = await reloadedStore.hydrate(documentId, EMPTY_HISTORY_DOC);
    expect(hydrated).toMatchObject({
      state: 'ready',
      head: first.entry.resultSha,
      entryCount: 1,
    });
    expect(await reloadedStore.list(documentId)).toEqual([first.entry]);
    await expect(reloadedStore.loadAt(documentId, first.entry.resultSha)).resolves.toMatchObject({
      text: 'Alpha launch note',
    });

    const second = await appendText(
      reloadedStore,
      documentId,
      first.entry.resultSha,
      'Alpha launch note',
      'Alpha launch note Revised',
    );
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.reason);

    const restored = await reloadedStore.restore(
      documentId,
      first.entry.resultSha,
      { type: 'user', id: 'local-user' },
      { ua: 'history-persistence-test' },
      { commitGuard: () => true },
    );
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.reason);
    expect(restored.entry.restoredFromVersion).toBe(first.entry.resultSha);
    expect(restored.entry.seq).toBe(3);

    const afterRestoreReload = createHistoryStore({ snapshotInterval: 20, persistence });
    const finalHydration = await afterRestoreReload.hydrate(documentId, EMPTY_HISTORY_DOC);
    expect(finalHydration).toMatchObject({
      state: 'ready',
      head: restored.entry.resultSha,
      entryCount: 3,
    });
    expect(await afterRestoreReload.list(documentId)).toHaveLength(3);
    await expect(
      afterRestoreReload.loadAt(documentId, restored.entry.resultSha),
    ).resolves.toMatchObject({ text: 'Alpha launch note' });
  });

  it('offers a verified backup instead of treating a corrupt primary as empty', async () => {
    const persistence = new MemoryHistoryPersistence();
    const documentId = createDocumentId('history-backup');
    const store = createHistoryStore({ persistence });
    const empty = await store.hydrate(documentId, EMPTY_HISTORY_DOC);
    if (empty.state !== 'empty-baseline') throw new Error('expected empty baseline');
    const first = await appendText(store, documentId, empty.head, '', 'Alpha');
    if (!first.ok) throw new Error(first.reason);
    const second = await appendText(
      store,
      documentId,
      first.entry.resultSha,
      'Alpha',
      'Alpha beta',
    );
    if (!second.ok) throw new Error(second.reason);

    persistence.primary.set(String(documentId), '{"broken":');
    const reloaded = createHistoryStore({ persistence });
    await expect(reloaded.hydrate(documentId, EMPTY_HISTORY_DOC)).resolves.toMatchObject({
      state: 'recovery-available',
      entryCount: 1,
    });
    expect(await reloaded.list(documentId)).toEqual([]);
  });

  it('lets one same-parent writer win the durable CAS and rejects the stale writer', async () => {
    const persistence = new MemoryHistoryPersistence();
    const documentId = createDocumentId('history-cas');
    const first = createHistoryStore({ persistence });
    const second = createHistoryStore({ persistence });
    const firstHydration = await first.hydrate(documentId, EMPTY_HISTORY_DOC);
    const secondHydration = await second.hydrate(documentId, EMPTY_HISTORY_DOC);
    if (firstHydration.state !== 'empty-baseline' || secondHydration.state !== 'empty-baseline') {
      throw new Error('expected empty baselines');
    }

    const winner = await appendText(first, documentId, firstHydration.head, '', 'Winner');
    expect(winner.ok).toBe(true);
    const loser = await appendText(second, documentId, secondHydration.head, '', 'Loser');
    expect(loser).toMatchObject({
      ok: false,
      reason: 'parent-mismatch',
    });

    const reloaded = createHistoryStore({ persistence });
    await expect(reloaded.hydrate(documentId, EMPTY_HISTORY_DOC)).resolves.toMatchObject({
      state: 'ready',
      entryCount: 1,
    });
    await expect(reloaded.list(documentId)).resolves.toMatchObject([
      { seq: 1, resultSha: winner.ok ? winner.entry.resultSha : '' },
    ]);
  });

  it('preserves an unknown envelope version and fails closed', async () => {
    const persistence = new MemoryHistoryPersistence();
    const documentId = createDocumentId('history-unknown-version');
    persistence.primary.set(
      String(documentId),
      '{"integrity":{"algorithm":"SHA-256","canonical":"lash-canonical-json-v1","payloadSha":"0"},"payload":{"documentId":"history-unknown-version","kind":"lash-history","version":2}}',
    );

    const store = createHistoryStore({ persistence });
    await expect(store.hydrate(documentId, EMPTY_HISTORY_DOC)).resolves.toMatchObject({
      state: 'unsupported-version',
    });
    expect(persistence.primary.has(String(documentId))).toBe(true);
  });
});
