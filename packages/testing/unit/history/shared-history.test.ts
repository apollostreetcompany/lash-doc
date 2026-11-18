import { createLashEditorExtensions } from '@lash/editor-core';
import { canonicalize, type SharedHistoryCommand } from '@lash/types';
import { getSchema } from '@tiptap/core';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { prosemirrorToYXmlFragment } from 'y-prosemirror';
import * as Y from 'yjs';

import {
  base64ToBytes,
  bytesToBase64,
  type PersistedRealtimeUpdate,
} from '../../../realtime-worker/src/persistence';
import {
  appendSharedHistoryEdit,
  compareSharedHistoryBodies,
  initializeSharedHistoryStorage,
  parseSharedHistoryCommand,
  readSharedHistoryBody,
  resolveSharedHistoryRequest,
  sharedHistoryGeneration,
} from '../../../realtime-worker/src/sharedHistory';

const { DatabaseSync } = createRequire(import.meta.url)(
  'node:sqlite',
) as typeof import('node:sqlite');
const schema = getSchema(createLashEditorExtensions());
const timestamp = '2026-11-18T13:00:00.000Z';

const makeRoom = () => {
  const db = new DatabaseSync(':memory:');
  const storage = {
    sql: {
      exec(query: string, ...values: import('node:sqlite').SQLInputValue[]) {
        const rows = db.prepare(query).all(...values);
        return { toArray: () => rows };
      },
    },
    transactionSync<T>(apply: () => T): T {
      db.exec('BEGIN');
      try {
        const result = apply();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as Parameters<typeof initializeSharedHistoryStorage>[0];
  db.exec(`CREATE TABLE yjs_updates (sequence INTEGER PRIMARY KEY AUTOINCREMENT, update_b64 TEXT);
           CREATE TABLE yjs_snapshots (sequence INTEGER PRIMARY KEY, update_b64 TEXT);`);
  initializeSharedHistoryStorage(storage);

  const doc = new Y.Doc();
  const root = doc.getXmlFragment('content');
  const metadata = doc.getMap('lash:document-metadata:v1');
  metadata.set('title', 'Current title');
  prosemirrorToYXmlFragment(
    schema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original copy' }] }],
    }),
    root,
  );
  const initialUpdate = bytesToBase64(Y.encodeStateAsUpdate(doc));
  const actorId = 'private-account-id';
  const roomId = 'example-shared-room';

  const insert = (
    update: string,
    source: PersistedRealtimeUpdate['source'],
  ): PersistedRealtimeUpdate => ({
    sequence: Number(
      db.prepare('INSERT INTO yjs_updates (update_b64) VALUES (?)').run(update).lastInsertRowid,
    ),
    update,
    actorId,
    createdAt: timestamp,
    source,
  });

  function change(text: string | null, kind?: 'suggestion-accept') {
    const vector = Y.encodeStateVector(doc);
    const beforeBody = readSharedHistoryBody(doc)!;
    if (text === null) {
      metadata.set('title', 'Renamed title');
    } else {
      const paragraph = root.get(0) as Y.XmlElement;
      const content = paragraph.get(0) as Y.XmlText;
      content.delete(0, content.length);
      content.insert(0, text);
    }
    const afterBody = readSharedHistoryBody(doc)!;
    return storage.transactionSync(() => {
      const update = insert(bytesToBase64(Y.encodeStateAsUpdate(doc, vector)), 'client');
      appendSharedHistoryEdit({
        storage,
        roomId,
        actorRole: 'editor',
        beforeBody,
        afterBody,
        update,
        source: kind,
      });
      return update.sequence;
    });
  }

  const request = (
    command: SharedHistoryCommand,
    actorRole: 'owner' | 'editor' = 'owner',
    isCurrent = () => true,
  ) =>
    resolveSharedHistoryRequest({
      storage,
      roomId,
      actorId,
      actorRole,
      command,
      isCurrent,
      getCurrentProjection: () => doc,
      initialUpdate: () => initialUpdate,
      insertRestoreUpdate: (update) => insert(update, 'restore'),
    });

  return { change, db, doc, request, storage };
};

describe('shared room history', () => {
  it('records authoritative body versions, omits private fields, and restores a new head idempotently', () => {
    const room = makeRoom();
    const list = () => ({
      type: 'shared-history-list' as const,
      requestId: randomUUID(),
      before: null,
    });
    const compare = (from: number, to: number) => ({
      type: 'shared-history-compare' as const,
      requestId: randomUUID(),
      from,
      to,
    });
    const first = room.change('Updated copy');
    room.change(null);
    const newest = room.change('Accepted copy', 'suggestion-accept');
    const history = room.request(list(), 'editor').frame.outcome;
    expect(history).toMatchObject({
      head: newest,
      canRestore: false,
      revisions: [
        { sequence: newest, parentSequence: first, kind: 'suggestion-accept' },
        { sequence: first, parentSequence: 0, kind: 'edit' },
        { sequence: 0, kind: 'baseline' },
      ],
    });
    expect(JSON.stringify(history)).not.toContain('private-account-id');
    expect(JSON.stringify(history)).not.toContain('Renamed title');
    expect(room.request(compare(0, first), 'editor').frame.outcome).toMatchObject({
      kind: 'compare',
      changes: [{ before: 'Original', after: 'Updated', suffix: ' copy' }],
    });
    expect(room.request(list(), 'editor', () => false).frame.outcome).toEqual({
      kind: 'error',
      code: 'forbidden',
    });
    const restore = {
      type: 'shared-history-restore' as const,
      requestId: randomUUID(),
      expectedHead: newest,
      target: 0,
    };
    expect(room.request(restore, 'editor').frame.outcome).toEqual({
      kind: 'error',
      code: 'forbidden',
    });
    const stale = { ...restore, expectedHead: first };
    expect(room.request(stale).frame.outcome).toEqual({ kind: 'error', code: 'stale-head' });
    const revoked = room.request(
      restore,
      'owner',
      (() => {
        let checks = 0;
        return () => ++checks === 1;
      })(),
    );
    expect(revoked.frame.outcome).toEqual({ kind: 'error', code: 'forbidden' });
    expect(sharedHistoryGeneration(room.storage)).toBe(0);

    const restored = room.request(restore);
    expect(restored.frame.outcome).toEqual({ kind: 'restored', sequence: newest + 1 });
    expect(restored.restored).toBeDefined();
    Y.applyUpdate(room.doc, base64ToBytes(restored.restored!.update));
    expect(room.doc.getText('untouched').toString()).toBe('');
    expect(readSharedHistoryBody(room.doc)).toContain('Original copy');
    expect(room.doc.getMap('lash:document-metadata:v1').get('title')).toBe('Renamed title');
    expect(sharedHistoryGeneration(room.storage)).toBe(1);
    expect(room.request(restore).restored).toBeUndefined();
    expect(room.request(restore).frame.outcome).toEqual(restored.frame.outcome);
    expect(room.request(list()).frame.outcome).toMatchObject({
      revisions: [
        { sequence: newest + 1, parentSequence: newest, restoredFrom: 0, kind: 'restore' },
        { sequence: newest, kind: 'suggestion-accept' },
        { sequence: first, kind: 'edit' },
        { sequence: 0, kind: 'baseline' },
      ],
    });
  });

  it('fails closed on a corrupted replay target and rolls back a restore if history cannot commit', () => {
    const room = makeRoom();
    const head = room.change('Second version');
    const restore = {
      type: 'shared-history-restore' as const,
      requestId: randomUUID(),
      expectedHead: head,
      target: 0,
    };
    room.db.exec(`INSERT INTO yjs_snapshots VALUES (0, 'broken')`);
    expect(room.request(restore).frame.outcome).toEqual({ kind: 'error', code: 'unavailable' });
    room.db.exec(`DELETE FROM yjs_snapshots;
      CREATE TRIGGER reject_restore BEFORE INSERT ON shared_history_revisions_v1
      WHEN NEW.kind = 'restore' BEGIN SELECT RAISE(ABORT, 'injected storage failure'); END;`);
    expect(room.request(restore).frame.outcome).toEqual({ kind: 'error', code: 'unavailable' });
    expect(sharedHistoryGeneration(room.storage)).toBe(0);
    expect(room.db.prepare('SELECT MAX(sequence) AS sequence FROM yjs_updates').get()).toEqual({
      sequence: head,
    });
    expect(readSharedHistoryBody(room.doc)).toContain('Second version');
  });

  it('uses a historical checkpoint and preserves the revision when the room has a newer checkpoint', () => {
    const room = makeRoom();
    const first = room.change('Earlier checkpoint');
    const save = (sequence: number) =>
      room.db
        .prepare('INSERT INTO yjs_snapshots VALUES (?, ?)')
        .run(sequence, bytesToBase64(Y.encodeStateAsUpdate(room.doc)));
    save(first);
    const last = room.change('Later checkpoint');
    save(last);
    expect(
      room.request({
        type: 'shared-history-compare',
        from: first,
        to: last,
        requestId: randomUUID(),
      }).frame.outcome,
    ).toMatchObject({
      kind: 'compare',
      changes: [{ before: 'Earli', after: 'Lat', suffix: 'er checkpoint' }],
    });
  });

  it('redacts mention labels, recognizes formatting, and rejects unexpected frame fields', () => {
    const body = (label: string, bold: boolean) =>
      canonicalize({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'mention', attrs: { label } },
              { type: 'text', text: ' Hello', ...(bold ? { marks: [{ type: 'bold' }] } : {}) },
            ],
          },
        ],
      });
    const diff = compareSharedHistoryBodies(
      body('Private label one', false),
      body('Private label two', true),
    );
    expect(JSON.stringify(diff)).not.toContain('Private label');
    expect(diff).toMatchObject({ changes: [{ structureChanged: true, before: '', after: '' }] });
    const command = {
      type: 'shared-history-restore',
      requestId: randomUUID(),
      expectedHead: 2,
      target: 1,
    };
    expect(parseSharedHistoryCommand(command)).toEqual(command);
    expect(parseSharedHistoryCommand({ ...command, actorRole: 'owner' })).toBeNull();
    expect(parseSharedHistoryCommand({ ...command, target: -1 })).toBeNull();
  });
});
