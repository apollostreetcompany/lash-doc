import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { parseNamedEditCommand } from '../../../realtime-worker/src/namedEdit';
import {
  applyNamedEditYjsUpdate,
  encodePublicYjsProjection,
  isSafePublicYjsProjection,
  loadRoomYjsProjection,
} from '../../../realtime-worker/src/namedEditProjection';
import {
  consumeNamedEditTicket,
  executeNamedEdit,
  initializeNamedEditStorage,
  isCurrentNamedEditGrant,
} from '../../../realtime-worker/src/namedEditStore';

const { DatabaseSync } = createRequire(import.meta.url)(
  'node:sqlite',
) as typeof import('node:sqlite');

const roomId = `doc-v1-${'a'.repeat(64)}`;
const owner = `account:v1:${'a'.repeat(43)}`;
const editor = `account:v1:${'b'.repeat(43)}`;
const stranger = `account:v1:${'c'.repeat(43)}`;
const emailDigest = `email-v1-${'d'.repeat(43)}`;
const tokenHash = 'e'.repeat(43);
const inviteId = '0aa00000-a000-4000-8000-000000000000';
const origin = 'https://lash.example.test';
const now = Date.parse('2026-11-18T12:00:00.000Z');
const issue = {
  action: 'issue' as const,
  inviteId,
  emailDigest,
  emailCiphertext: 'email-v1.encrypted',
  tokenHash,
};
const redeem = {
  action: 'session' as const,
  browserOrigin: origin,
  tokenHash,
  emailDigest,
};
const reopen = { ...redeem, tokenHash: null, emailDigest: null };
const initialUpdate =
  'AQTvjKbdDgAHAQdjb250ZW50AwlwYXJhZ3JhcGgHAO+Mpt0OAAYEAO+Mpt0OAQ1Qcm9tb3RlZCBib2R5KAEZbGFzaDpkb2N1bWVudC1tZXRhZGF0YTp2MQV0aXRsZQF3DlByb21vdGVkIHRpdGxlAA==';

const makeRoom = () => {
  const db = new DatabaseSync(':memory:');
  const storage = {
    sql: {
      exec(query: string, ...values: import('node:sqlite').SQLInputValue[]) {
        const statement = db.prepare(query);
        const rows = statement.all(...values);
        return { toArray: () => rows };
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
  } as unknown as Parameters<typeof initializeNamedEditStorage>[0];
  db.exec(`
    CREATE TABLE document_owner_v1 (singleton INTEGER, owner_principal_id TEXT, acl_version INTEGER);
    CREATE TABLE document_projection_v1 (singleton INTEGER, room_id TEXT, snapshot_sha256 TEXT, shareable INTEGER);
    CREATE TABLE document_promotion_receipt_v1 (singleton INTEGER, snapshot_sha256 TEXT, owner_principal_id TEXT);
    CREATE TABLE owner_session_control_v1 (singleton INTEGER, frozen INTEGER, block_new_sessions INTEGER);
  `);
  db.prepare('INSERT INTO document_owner_v1 VALUES (1, ?, 1)').run(owner);
  db.prepare("INSERT INTO document_projection_v1 VALUES (1, ?, 'sha', 1)").run(roomId);
  db.prepare("INSERT INTO document_promotion_receipt_v1 VALUES (1, 'sha', ?)").run(owner);
  initializeNamedEditStorage(storage);
  return { db, storage };
};

describe('named editor room authority', () => {
  it('issues one durable invitation, accepts its matching account, and fences the revoked grant', async () => {
    const { db, storage } = makeRoom();
    const dispatch = (
      command: Parameters<typeof executeNamedEdit>[0]['command'],
      principalId = owner,
      nowMs = now,
    ) =>
      executeNamedEdit({
        storage,
        command,
        principalId,
        roomId,
        requestId: randomUUID(),
        nowMs,
      });

    expect(await dispatch(issue, stranger)).toMatchObject({ ok: false, error: 'forbidden' });
    const issued = await dispatch(issue);
    expect(issued).toMatchObject({
      ok: true,
      invite: { inviteId, role: 'edit', status: 'pending' },
    });
    expect(await dispatch({ ...issue, emailCiphertext: 'email-v1.retry' })).toEqual(issued);
    expect(await dispatch(reopen, editor)).toMatchObject({ ok: false, error: 'forbidden' });
    expect(
      await dispatch({ ...redeem, emailDigest: `email-v1-${'f'.repeat(43)}` }, stranger),
    ).toMatchObject({ ok: false, error: 'forbidden' });
    const accepted = await dispatch(redeem, editor);
    if (!accepted.ok || !('session' in accepted)) throw new Error('Named session was not issued.');
    expect(accepted.session).toMatchObject({
      source: 'named',
      role: 'edit',
      capabilities: ['doc.read', 'doc.edit'],
      roomId,
      protocolVersion: 5,
    });
    expect(await dispatch(redeem, stranger)).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await dispatch({ action: 'list' })).toMatchObject({
      ok: true,
      invites: [{ inviteId, status: 'accepted' }],
    });

    const socket = {
      storage,
      roomId,
      browserOrigin: origin,
      actorId: accepted.session.actorId,
      token: accepted.session.ticketProtocol.split('.')[1]!,
      nowMs: now + 1,
    };
    expect(
      await consumeNamedEditTicket({ ...socket, browserOrigin: 'https://other.example.test' }),
    ).toBeNull();
    const grant = await consumeNamedEditTicket(socket);
    if (!grant) throw new Error('Named socket ticket was not accepted.');
    expect(await consumeNamedEditTicket(socket)).toBeNull();
    expect(isCurrentNamedEditGrant({ storage, roomId, grant, nowMs: now + 2 })).toBe(true);

    const reopened = await dispatch(reopen, editor, now + 8 * 24 * 60 * 60 * 1000);
    expect(reopened).toMatchObject({ ok: true, session: { actorId: accepted.session.actorId } });
    expect(await dispatch({ action: 'revoke', inviteId }, owner, now + 3)).toMatchObject({
      ok: true,
      invite: { inviteId, status: 'revoked' },
    });
    expect(isCurrentNamedEditGrant({ storage, roomId, grant, nowMs: now + 4 })).toBe(false);
    expect(await dispatch(reopen, editor, now + 4)).toMatchObject({
      ok: false,
      error: 'forbidden',
    });
    db.close();
  });

  it('parses only closed named-edit commands', () => {
    expect(parseNamedEditCommand('issue', { version: 1, ...issue, action: undefined })).toBeNull();
    expect(
      parseNamedEditCommand('session', {
        version: 1,
        tokenHash,
        emailDigest: null,
        browserOrigin: origin,
      }),
    ).toBeNull();
    expect(
      parseNamedEditCommand('session', {
        version: 1,
        tokenHash,
        emailDigest,
        browserOrigin: origin,
      }),
    ).toEqual(redeem);
  });

  it('applies named title and body edits through the canonical projection without making private review shared', () => {
    const room = loadRoomYjsProjection([initialUpdate]);
    if (!room) throw new Error('A valid room fixture could not hydrate.');
    const client = loadRoomYjsProjection([initialUpdate]);
    if (!client) throw new Error('A valid client fixture could not hydrate.');
    const body = client.getXmlFragment('content').get(0) as Y.XmlElement;
    const text = body.get(0) as Y.XmlText;
    client.transact(() => {
      text.insert(text.length, ' plus a named edit');
      client.getMap('lash:document-metadata:v1').set('title', 'Collaborative draft');
    });
    const visibleUpdate = Y.encodeStateAsUpdate(client, Y.encodeStateVector(room));
    expect(
      applyNamedEditYjsUpdate(room, Buffer.from(visibleUpdate).toString('base64')),
    ).not.toBeNull();
    expect(room.getXmlFragment('content').toString()).toContain('plus a named edit');
    expect(room.getMap('lash:document-metadata:v1').get('title')).toBe('Collaborative draft');
    expect(isSafePublicYjsProjection(room)).toBe(true);
    client.getMap('lash:chat-threads').set('thread-1', 'Private collaborator note');
    const privateUpdate = Y.encodeStateAsUpdate(client, Y.encodeStateVector(room));
    expect(applyNamedEditYjsUpdate(room, Buffer.from(privateUpdate).toString('base64'))).toBeNull();
    expect(isSafePublicYjsProjection(room)).toBe(false);
    client.destroy();
    room.destroy();
  });

  it('emits only current text when serializing the public projection', () => {
    const editor = new Y.Doc({ gc: false });
    Y.applyUpdate(editor, Buffer.from(initialUpdate, 'base64'));
    const before = Y.encodeStateVector(editor);
    const paragraph = editor.getXmlFragment('content').get(0) as Y.XmlElement;
    const text = paragraph.get(0) as Y.XmlText;
    text.insert(text.length, 'removed before sharing');
    const draft = Y.encodeStateAsUpdate(editor, before);
    text.delete(text.length - 22, 22);
    const saved = Y.encodeStateAsUpdate(editor, before);
    expect(Buffer.from(saved).includes('removed before sharing')).toBe(true);

    const reader = loadRoomYjsProjection([
      initialUpdate,
      Buffer.from(draft).toString('base64'),
      Buffer.from(saved).toString('base64'),
    ]);
    if (!reader) throw new Error('Saved projection did not hydrate.');
    for (const vector of [undefined, before]) {
      const update = encodePublicYjsProjection(reader, vector);
      if (!update) throw new Error('Public projection did not serialize.');
      expect(Buffer.from(update, 'base64').includes('removed before sharing')).toBe(false);
      const current = loadRoomYjsProjection(vector ? [initialUpdate, update] : [update]);
      expect(current?.getXmlFragment('content').toString()).toContain('Promoted body');
      expect(current?.getXmlFragment('content').toString()).not.toContain('removed before sharing');
      current?.destroy();
    }
    reader.destroy();
    editor.destroy();
  });
});
