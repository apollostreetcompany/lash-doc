import {
  createAnchor,
  parseReviewMutation,
  type CommittedReviewOperation,
  type ReviewMutation,
} from '@lash/doc-chat';
import { createDocumentId } from '@lash/types';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import {
  RealtimeChatStore,
  withLegacyChatThreads,
} from '../../../../apps/web/lib/realtimeChatStore';
import {
  commitCollaboratorReviewOperation,
  initializeCollaboratorReviewStorage,
  readCollaboratorReviewSnapshot,
} from '../../../realtime-worker/src/collaboratorReviewStore';

const { DatabaseSync } = createRequire(import.meta.url)(
  'node:sqlite',
) as typeof import('node:sqlite');
const docId = createDocumentId('shared:document');
const roomId = 'room';
const threadId = 'ba7bbce0-bf93-4a19-b63d-42cae6231111';
const create: ReviewMutation = {
  type: 'create',
  threadId,
  anchor: {
    ...createAnchor({ baseVersion: null, docText: 'publish the beta', from: 0, to: 16 }),
    relativeRange: {
      start: { item: { client: 1, clock: 2 } },
      end: { item: { client: 1, clock: 17 } },
    },
  },
  body: 'Could this sound less final?',
};

const makeStorage = (initialize = true) => {
  const db = new DatabaseSync(':memory:');
  const storage = {
    sql: {
      exec(query: string, ...values: import('node:sqlite').SQLInputValue[]) {
        const rows = db.prepare(query).all(...values);
        return { toArray: () => rows, one: () => rows[0] };
      },
    },
    transactionSync<T>(fn: () => T): T {
      db.exec('BEGIN');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as Parameters<typeof initializeCollaboratorReviewStorage>[0];
  if (initialize) initializeCollaboratorReviewStorage(storage);
  return { storage, close: () => db.close() };
};

const operationsOf = (store: Parameters<typeof readCollaboratorReviewSnapshot>[0]) =>
  readCollaboratorReviewSnapshot(store);

describe('private shared review threads', () => {
  it('migrates existing v1 review rows in order and only copies them once', () => {
    const { storage, close } = makeStorage(false);
    try {
      storage.sql.exec(`
        CREATE TABLE collaborator_review_operation_v1 (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          operation_id TEXT NOT NULL UNIQUE,
          actor_id TEXT NOT NULL,
          committed_at TEXT NOT NULL,
          thread_id TEXT NOT NULL,
          operation_type TEXT NOT NULL CHECK (operation_type IN ('create', 'reply', 'status')),
          operation_json TEXT NOT NULL
        )
      `);
      const oldOperations = [
        {
          sequence: 1,
          operationId: crypto.randomUUID(),
          actorId: 'collaborator',
          operation: parseReviewMutation(create)!,
        },
        {
          sequence: 3,
          operationId: crypto.randomUUID(),
          actorId: 'owner',
          operation: { type: 'reply', threadId, body: 'Good call' },
        },
      ];
      const committedAt = '2026-11-18T00:00:00.000Z';
      for (const { sequence, operationId, actorId, operation } of oldOperations) {
        storage.sql.exec(
          'INSERT INTO collaborator_review_operation_v1 VALUES (?, ?, ?, ?, ?, ?, ?)',
          sequence,
          operationId,
          actorId,
          committedAt,
          threadId,
          operation.type,
          JSON.stringify(operation),
        );
      }
      initializeCollaboratorReviewStorage(storage);
      expect(operationsOf(storage)).toEqual(oldOperations.map((row) => ({ ...row, committedAt })));
      const resolution = commitCollaboratorReviewOperation({
        storage,
        actorId: 'owner',
        operationId: crypto.randomUUID(),
        operation: { type: 'status', threadId, status: 'resolved' },
      });
      expect(resolution).toMatchObject({ ok: true, operation: { sequence: 4 } });
      initializeCollaboratorReviewStorage(storage);
      expect(operationsOf(storage).map(({ sequence }) => sequence)).toEqual([1, 3, 4]);
      expect(
        storage.sql
          .exec('SELECT sequence FROM collaborator_review_operation_v1 ORDER BY sequence')
          .toArray(),
      ).toEqual([{ sequence: 1 }, { sequence: 3 }]);
    } finally {
      close();
    }
  });

  it('keeps both simultaneous replies and a resolution, then replays them on reconnect and reload', async () => {
    const { storage, close } = makeStorage();
    try {
      const outgoing: CommittedReviewOperation[] = [];
      const browserFor = (actorId: string) =>
        new RealtimeChatStore((operationId, operation) => {
          const result = commitCollaboratorReviewOperation({
            storage,
            actorId,
            operationId,
            operation,
          });
          if (!result.ok) return false;
          outgoing.push(result.operation);
          return true;
        });
      const collaborator = browserFor('collaborator');
      const owner = browserFor('owner');
      const reconnect = (browser: RealtimeChatStore) =>
        browser.receive({
          type: 'review-snapshot',
          roomId,
          operations: operationsOf(storage),
        });
      reconnect(collaborator);
      reconnect(owner);
      const onOwnerUpdate = vi.fn();
      const unsubscribe = owner.subscribe(onOwnerUpdate);

      const distribute = (record: CommittedReviewOperation) => {
        for (const browser of [collaborator, owner]) {
          browser.receive({ type: 'review-operation', roomId, operation: record });
        }
      };
      const created = collaborator.submit(create);
      distribute(outgoing.shift()!);
      await expect(created).resolves.toEqual({ ok: true });
      expect(onOwnerUpdate).toHaveBeenCalledOnce();
      expect(owner.readThreads(docId)[0]).toMatchObject({
        anchor: { baseVersion: null },
        messages: [{ body: 'Could this sound less final?', author: { id: 'collaborator' } }],
      });

      const first = collaborator.submit({ type: 'reply', threadId, body: 'Thanks.' });
      const second = owner.submit({ type: 'reply', threadId, body: 'Good call.' });
      // Interleave visibility with disconnect: the owner has not observed either durable reply.
      owner.disconnect();
      const decision = collaborator.submit({ type: 'status', threadId, status: 'resolved' });
      for (const record of outgoing.splice(0).reverse()) distribute(record);
      await expect(first).resolves.toEqual({ ok: true });
      await expect(decision).resolves.toEqual({ ok: true });
      reconnect(owner);
      await expect(second).resolves.toEqual({ ok: true });
      const reloaded = browserFor('owner');
      reconnect(reloaded);

      const expected = [
        {
          id: threadId,
          status: 'resolved',
          messages: [
            { body: 'Could this sound less final?', author: { id: 'collaborator' } },
            { body: 'Thanks.', author: { id: 'collaborator' } },
            { body: 'Good call.', author: { id: 'owner' } },
          ],
        },
      ];
      expect(collaborator.readThreads(docId)).toMatchObject(expected);
      expect(owner.readThreads(docId)).toEqual(collaborator.readThreads(docId));
      expect(reloaded.readThreads(docId)).toEqual(collaborator.readThreads(docId));

      const reopened = owner.submit({ type: 'status', threadId, status: 'open' });
      distribute(outgoing.shift()!);
      await expect(reopened).resolves.toEqual({ ok: true });
      expect(collaborator.readThreads(docId)[0]).toMatchObject({
        status: 'open',
        resolvedAt: null,
      });
      unsubscribe();
    } finally {
      close();
    }
  });

  it('rejects reused identities and keeps malformed or orphan operations out of storage', () => {
    const { storage, close } = makeStorage();
    try {
      const operationId = 'b8608781-b3c4-4b6e-ad5c-4d9260bf9999';
      const commit = (operation: unknown, actorId = 'collaborator') =>
        commitCollaboratorReviewOperation({ storage, operationId, actorId, operation });

      expect(commit({ type: 'reply', threadId, body: 'Orphaned' })).toEqual({
        ok: false,
        code: 'review_thread_missing',
      });
      expect(commit({ ...create, anchor: { ...create.anchor, baseVersion: 'made-up' } })).toEqual({
        ok: false,
        code: 'invalid_review_operation',
      });
      const first = commit(create);
      expect(first).toMatchObject({
        ok: true,
        duplicate: false,
        operation: { sequence: 1, actorId: 'collaborator' },
      });
      expect(commit(create)).toEqual({ ...first, duplicate: true });
      expect(commit(create, 'owner')).toEqual({ ok: false, code: 'review_operation_conflict' });
      expect(commit({ ...create, body: 'Changed' })).toEqual({
        ok: false,
        code: 'review_operation_conflict',
      });
      expect(operationsOf(storage)).toHaveLength(1);
    } finally {
      close();
    }
  });

  it('commits accepted text once with its decision and records rejection without a body write', () => {
    const { storage, close } = makeStorage();
    try {
      storage.sql.exec('CREATE TABLE body_updates (sequence INTEGER PRIMARY KEY, text TEXT)');
      const start = { type: { client: 1, clock: 1 }, item: { client: 1, clock: 2 }, assoc: 0 };
      const end = { type: { client: 1, clock: 1 }, item: { client: 1, clock: 17 }, assoc: -1 };
      const proposal: ReviewMutation = {
        type: 'propose',
        threadId,
        anchor: { ...create.anchor, relativeRange: { start, end } },
        body: create.body,
        before: '{"content":[{"text":"publish the beta","type":"text"}]}',
        replacement: 'share the beta',
      };
      const decision: ReviewMutation = { type: 'decide', threadId, decision: 'accepted' };
      const writeBody = vi.fn(() => {
        storage.sql.exec("INSERT INTO body_updates VALUES (1, 'share the beta')");
        return 1;
      });
      const commit = (
        operation: ReviewMutation,
        operationId = crypto.randomUUID(),
        applyProposal: () => number | null = writeBody,
      ) =>
        commitCollaboratorReviewOperation({
          storage,
          actorId: 'owner',
          operationId,
          operation,
          suggestions: { validateProposal: () => true, applyProposal },
        });
      const readBodies = () => storage.sql.exec('SELECT * FROM body_updates').toArray();
      expect(commit(proposal)).toMatchObject({ ok: true, duplicate: false });
      expect(commit(decision, crypto.randomUUID(), () => null)).toEqual({
        ok: false,
        code: 'review_suggestion_stale',
      });
      expect(() =>
        commit(decision, crypto.randomUUID(), () => {
          storage.sql.exec("INSERT INTO body_updates VALUES (1, 'uncommitted')");
          return -1;
        }),
      ).toThrow('Stored review operation is invalid.');
      expect(readBodies()).toEqual([]);
      expect(operationsOf(storage)).toHaveLength(1);

      const operationId = crypto.randomUUID();
      const receipt = commit(decision, operationId);
      expect(receipt).toMatchObject({ ok: true, operation: { bodySequence: 1 } });
      expect(commit(decision, operationId)).toEqual({ ...receipt, duplicate: true });
      expect(commit({ ...decision, decision: 'rejected' })).toEqual({
        ok: false,
        code: 'review_suggestion_decided',
      });
      const another = crypto.randomUUID();
      expect(commit({ ...proposal, threadId: another })).toMatchObject({ ok: true });
      expect(commit({ type: 'decide', threadId: another, decision: 'rejected' })).toMatchObject({
        ok: true,
        operation: { operation: { decision: 'rejected' } },
      });
      expect(writeBody).toHaveBeenCalledOnce();
      expect(readBodies()).toEqual([{ sequence: 1, text: 'share the beta' }]);
      expect(operationsOf(storage)).toHaveLength(4);
    } finally {
      close();
    }
  });

  it('keeps previously persisted Yjs threads readable without uploading or rewriting them', () => {
    const doc = new Y.Doc();
    const legacy = doc.getMap<string>('lash:chat-threads');
    const legacyThread = {
      id: 'thread:legacy',
      docId,
      anchor: createAnchor({ baseVersion: 'recorded-head', docText: 'Before', from: 0, to: 6 }),
      historyText: 'Before',
      messages: [],
      filters: {},
      status: 'open',
      resolvedAt: null,
      updatedAt: '',
    };
    const payload = JSON.stringify(legacyThread);
    const send = vi.fn(() => true);
    const store = withLegacyChatThreads(new RealtimeChatStore(send), doc);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    legacy.set(`${docId}:${legacyThread.id}`, payload);
    legacy.set(`another-document:${legacyThread.id}`, payload);

    expect(listener).toHaveBeenCalled();
    expect(store.readThreads(docId)).toEqual([legacyThread]);
    expect(send).not.toHaveBeenCalled();
    expect(legacy.get(`${docId}:${legacyThread.id}`)).toBe(payload);
    unsubscribe();
    doc.destroy();
  });
});
