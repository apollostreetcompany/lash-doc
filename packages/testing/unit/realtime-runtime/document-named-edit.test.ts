import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  parseNamedCommentSocketProtocols,
  parseNamedEditCommand,
  parseNamedEditSocketProtocols,
} from '../../../realtime-worker/src/namedEdit';
import {
  applyNamedEditYjsUpdate,
  encodePublicYjsProjection,
  isSafePublicYjsProjection,
  loadRoomYjsProjection,
} from '../../../realtime-worker/src/namedEditProjection';
import {
  consumeNamedCommentTicket,
  consumeNamedEditTicket,
  executeNamedEdit,
  initializeNamedEditStorage,
  isCurrentNamedCommentGrant,
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

const openCommentRoom = () => {
  const { db, storage } = makeRoom();
  const dispatch = (
    command: Parameters<typeof executeNamedEdit>[0]['command'],
    principalId = owner,
    overrides: Partial<
      Pick<
        Parameters<typeof executeNamedEdit>[0],
        'nowMs' | 'commentEnabled' | 'commentProjectionAvailable'
      >
    > = {},
  ) =>
    executeNamedEdit({
      storage,
      command,
      principalId,
      roomId,
      requestId: randomUUID(),
      nowMs: now,
      commentEnabled: true,
      commentProjectionAvailable: () => true,
      ...overrides,
    });
  return { db, storage, dispatch };
};

const commentIssue = { ...issue, role: 'comment' as const };

describe('named commenter room authority', () => {
  it('issues a distinct role, validates the verified recipient and origin, and immediately revokes tickets and grants', async () => {
    const { db, storage, dispatch } = openCommentRoom();
    try {
      expect(await dispatch(commentIssue, stranger)).toMatchObject({
        ok: false,
        error: 'forbidden',
      });
      const issued = await dispatch(commentIssue);
      expect(issued).toMatchObject({
        ok: true,
        invite: { inviteId, role: 'comment', status: 'pending' },
      });
      expect(await dispatch({ ...commentIssue, emailCiphertext: 'email-v1.retry' })).toEqual(
        issued,
      );
      expect(await dispatch(issue)).toMatchObject({ ok: false, error: 'conflict' });
      expect(
        await dispatch({ ...issue, inviteId: randomUUID(), tokenHash: 'f'.repeat(43) }),
      ).toMatchObject({
        ok: false,
        error: 'conflict',
      });
      expect(await dispatch({ action: 'list', includeComment: true }, editor)).toMatchObject({
        ok: false,
        error: 'forbidden',
      });
      expect(
        await dispatch({ ...redeem, emailDigest: `email-v1-${'f'.repeat(43)}` }, stranger),
      ).toMatchObject({ ok: false, error: 'forbidden' });

      const accepted = await dispatch(redeem, editor);
      if (!accepted.ok || !('session' in accepted)) throw new Error('Missing Comment session.');
      const { session } = accepted;
      expect(session).toEqual({
        source: 'named',
        role: 'comment',
        protocolVersion: 6,
        roomId,
        actorId: expect.stringMatching(/^named-[a-f0-9]{32}$/u),
        capabilities: ['doc.read', 'doc.comment', 'doc.suggest'],
        socketProtocol: 'lash-realtime-v6',
        ticketProtocol: expect.stringMatching(/^lash-named-comment-ticket\.[A-Za-z0-9_-]{43}$/u),
        expiresAt: new Date(now + 60_000).toISOString(),
      });
      expect(await dispatch(redeem, stranger)).toMatchObject({ ok: false, error: 'forbidden' });
      const socketProtocols = `${session.socketProtocol}, ${session.ticketProtocol}`;
      const token = parseNamedCommentSocketProtocols(socketProtocols);
      if (!token) throw new Error('Invalid v6 Comment transport.');
      expect(parseNamedEditSocketProtocols(socketProtocols)).toBeNull();
      expect(
        parseNamedEditSocketProtocols(`lash-realtime-v5, ${session.ticketProtocol}`),
      ).toBeNull();
      expect(
        parseNamedCommentSocketProtocols(`lash-realtime-v6, lash-named-ticket.${token}`),
      ).toBeNull();

      const socket = {
        storage,
        roomId,
        actorId: session.actorId,
        browserOrigin: origin,
        token,
        nowMs: now + 1,
      };
      expect(await consumeNamedEditTicket(socket)).toBeNull();
      expect(
        await consumeNamedCommentTicket({ ...socket, browserOrigin: 'https://other.example.test' }),
      ).toBeNull();
      expect(
        await consumeNamedCommentTicket({ ...socket, actorId: `named-${'f'.repeat(32)}` }),
      ).toBeNull();
      expect(await consumeNamedCommentTicket({ ...socket, nowMs: now + 60_000 })).toBeNull();
      const grant = await consumeNamedCommentTicket(socket);
      if (!grant) throw new Error('Comment socket not admitted.');
      expect(await consumeNamedCommentTicket(socket)).toBeNull();
      expect(isCurrentNamedCommentGrant({ storage, roomId, grant, nowMs: now + 2 })).toBe(true);
      expect(isCurrentNamedEditGrant({ storage, roomId, grant, nowMs: now + 2 })).toBe(false);
      expect(isCurrentNamedCommentGrant({ storage, roomId, grant, nowMs: grant.expiresAtMs })).toBe(
        false,
      );

      const reopened = await dispatch(reopen, editor);
      if (!reopened.ok || !('session' in reopened)) throw new Error('Comment reopen was denied.');
      expect(reopened.session).toMatchObject({ role: 'comment', actorId: session.actorId });
      expect(reopened.session.ticketProtocol).not.toBe(session.ticketProtocol);
      expect(await dispatch({ action: 'list', includeComment: true })).toMatchObject({
        ok: true,
        invites: [{ inviteId, role: 'comment', status: 'accepted' }],
      });
      expect(
        await dispatch({ action: 'revoke', inviteId, role: 'comment' }, owner, {
          commentEnabled: false,
        }),
      ).toMatchObject({
        ok: true,
        invite: { inviteId, role: 'comment', status: 'revoked' },
      });
      expect(isCurrentNamedCommentGrant({ storage, roomId, grant, nowMs: now + 2 })).toBe(false);
      expect(
        await consumeNamedCommentTicket({
          ...socket,
          token: reopened.session.ticketProtocol.split('.')[1]!,
        }),
      ).toBeNull();
      expect(await dispatch(reopen, editor)).toMatchObject({ ok: false, error: 'forbidden' });
    } finally {
      db.close();
    }
  });

  it('fails closed to ineligible accounts or projection failures and preserves pending invitation state', async () => {
    const { db, dispatch } = openCommentRoom();
    try {
      const projection = { commentProjectionAvailable: () => false };
      expect(await dispatch(commentIssue, stranger, projection)).toMatchObject({
        error: 'forbidden',
      });
      expect(await dispatch(commentIssue, owner, { commentEnabled: false })).toMatchObject({
        error: 'named-comment-disabled',
      });
      expect(await dispatch(commentIssue, owner, projection)).toMatchObject({
        error: 'comment-projection-unavailable',
      });
      expect(await dispatch({ action: 'list', includeComment: true })).toMatchObject({
        ok: true,
        invites: [],
      });
      expect(await dispatch(commentIssue)).toMatchObject({ ok: true });
      expect(await dispatch(commentIssue, owner, projection)).toMatchObject({
        error: 'comment-projection-unavailable',
      });
      expect(
        await dispatch(
          { ...redeem, emailDigest: `email-v1-${'f'.repeat(43)}` },
          stranger,
          projection,
        ),
      ).toMatchObject({ error: 'forbidden' });
      expect(await dispatch(redeem, editor, projection)).toMatchObject({
        error: 'comment-projection-unavailable',
      });
      expect(await dispatch(redeem, editor, { commentEnabled: false })).toMatchObject({
        error: 'named-comment-disabled',
      });
      expect(await dispatch({ action: 'list', includeComment: true })).toMatchObject({
        ok: true,
        invites: [{ inviteId, role: 'comment', status: 'pending' }],
      });
      expect(
        db.prepare('SELECT COUNT(*) AS count FROM named_comment_ticket_v1').get(),
      ).toMatchObject({ count: 0 });
      const expiresAt = now + 7 * 24 * 60 * 60 * 1000;
      expect(await dispatch(redeem, editor, { nowMs: expiresAt })).toMatchObject({
        error: 'forbidden',
      });
      expect(
        await dispatch({ action: 'list', includeComment: true }, owner, { nowMs: expiresAt }),
      ).toMatchObject({
        ok: true,
        invites: [{ inviteId, role: 'comment', status: 'expired' }],
      });
    } finally {
      db.close();
    }
  });

  it('keeps legacy management Edit-only even with existing Comment invitations', async () => {
    const { db, dispatch } = openCommentRoom();
    try {
      const editInvite = {
        ...issue,
        inviteId: randomUUID(),
        emailDigest: `email-v1-${'f'.repeat(43)}`,
        tokenHash: 'g'.repeat(43),
      };
      expect(await dispatch(commentIssue)).toMatchObject({ ok: true });
      expect(await dispatch(editInvite)).toMatchObject({ ok: true });
      expect(await dispatch({ action: 'list' })).toMatchObject({
        ok: true,
        invites: [{ inviteId: editInvite.inviteId, role: 'edit' }],
      });
      const fullInventory = await dispatch({ action: 'list', includeComment: true }, owner, {
        commentEnabled: false,
      });
      if (!fullInventory.ok || !('invites' in fullInventory))
        throw new Error('Missing owner inventory.');
      expect(fullInventory.invites.map((invite) => invite.role).sort()).toEqual([
        'comment',
        'edit',
      ]);
      expect(await dispatch({ action: 'revoke', inviteId })).toMatchObject({ error: 'forbidden' });
      expect(
        await dispatch({ action: 'revoke', inviteId: editInvite.inviteId, role: 'comment' }),
      ).toMatchObject({
        error: 'forbidden',
      });
      expect(await dispatch({ action: 'revoke', inviteId: editInvite.inviteId })).toMatchObject({
        invite: { role: 'edit', status: 'revoked' },
      });
      expect(await dispatch({ action: 'revoke', inviteId, role: 'comment' })).toMatchObject({
        invite: { role: 'comment', status: 'revoked' },
      });
    } finally {
      db.close();
    }
  });

  it('keeps one active role for a verified principal even when email changes', async () => {
    const { db, dispatch } = openCommentRoom();
    try {
      const editInvite = {
        ...issue,
        inviteId: randomUUID(),
        emailDigest: `email-v1-${'f'.repeat(43)}`,
        tokenHash: 'g'.repeat(43),
      };
      expect(await dispatch(commentIssue)).toMatchObject({ ok: true });
      expect(await dispatch(editInvite)).toMatchObject({ ok: true });
      expect(await dispatch(redeem, editor)).toMatchObject({ session: { role: 'comment' } });
      const editRedeem = {
        ...redeem,
        emailDigest: editInvite.emailDigest,
        tokenHash: editInvite.tokenHash,
      };
      expect(await dispatch(editRedeem, editor)).toMatchObject({ error: 'forbidden' });
      expect(await dispatch({ action: 'revoke', inviteId, role: 'comment' })).toMatchObject({
        ok: true,
      });
      expect(await dispatch(editRedeem, editor)).toMatchObject({
        session: { role: 'edit', protocolVersion: 5, capabilities: ['doc.read', 'doc.edit'] },
      });
    } finally {
      db.close();
    }
  });

  it('retries a redemption after a failed ticket write without binding the pending invite', async () => {
    const { db, storage, dispatch } = openCommentRoom();
    try {
      expect(await dispatch(commentIssue)).toMatchObject({ ok: true });
      const attempt = {
        storage,
        command: redeem,
        principalId: editor,
        roomId,
        requestId: randomUUID(),
        nowMs: now,
        commentEnabled: true,
        commentProjectionAvailable: () => true,
      };
      db.exec(`
        CREATE TRIGGER unavailable_comment_ticket
        BEFORE INSERT ON named_comment_ticket_v1
        BEGIN
          SELECT RAISE(ABORT, 'ticket write unavailable');
        END
      `);
      await expect(executeNamedEdit(attempt)).rejects.toThrow('ticket write unavailable');
      expect(await dispatch({ action: 'list', includeComment: true })).toMatchObject({
        ok: true,
        invites: [{ inviteId, role: 'comment', status: 'pending' }],
      });
      expect(await dispatch(reopen, editor)).toMatchObject({ error: 'forbidden' });
      db.exec('DROP TRIGGER unavailable_comment_ticket');
      expect(await executeNamedEdit(attempt)).toMatchObject({
        session: { role: 'comment', protocolVersion: 6 },
      });
      expect(await executeNamedEdit(attempt)).toMatchObject({ error: 'conflict' });
    } finally {
      db.close();
    }
  });

  it('preserves an Edit membership written by a rollback and fences overlapping Comment access', async () => {
    const { db, storage, dispatch } = openCommentRoom();
    try {
      expect(await dispatch(commentIssue)).toMatchObject({ ok: true });
      const accepted = await dispatch(redeem, editor);
      if (!accepted.ok || !('session' in accepted)) throw new Error('Missing Comment session.');
      const socket = {
        storage,
        roomId,
        actorId: accepted.session.actorId,
        browserOrigin: origin,
        token: accepted.session.ticketProtocol.split('.')[1]!,
        nowMs: now + 1,
      };
      const grant = await consumeNamedCommentTicket(socket);
      if (!grant) throw new Error('Missing Comment grant.');
      // An older Worker only knows its separate Edit table.
      db.prepare(
        `INSERT INTO named_edit_invite_v1
         (invite_id, email_digest, email_ciphertext, token_hash, expires_at_ms, accepted_principal_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), emailDigest, issue.emailCiphertext, 'f'.repeat(43), now + 60_000, editor);
      expect(await dispatch(reopen, editor)).toMatchObject({
        session: { role: 'edit', protocolVersion: 5 },
      });
      expect(await dispatch(redeem, editor)).toMatchObject({ error: 'forbidden' });
      expect(isCurrentNamedCommentGrant({ storage, roomId, grant, nowMs: now + 2 })).toBe(false);
    } finally {
      db.close();
    }
  });
});

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

  it('accepts an explicit Comment role while retaining the closed legacy Edit command', () => {
    const { action, ...body } = issue;
    expect(parseNamedEditCommand(action, { version: 1, ...body })).toEqual(issue);
    expect(parseNamedEditCommand(action, { version: 1, ...body, role: 'comment' })).toEqual({
      ...issue,
      role: 'comment',
    });
    expect(parseNamedEditCommand(action, { version: 1, ...body, role: 'owner' })).toBeNull();
    expect(parseNamedEditCommand('list', { version: 1, role: 'comment' })).toBeNull();
    expect(parseNamedEditCommand('list', { version: 1, includeComment: true })).toEqual({
      action: 'list',
      includeComment: true,
    });
    expect(parseNamedEditCommand('list', { version: 1, includeComment: false })).toBeNull();
    expect(parseNamedEditCommand('revoke', { version: 1, inviteId, role: 'comment' })).toEqual({
      action: 'revoke',
      inviteId,
      role: 'comment',
    });
    expect(
      parseNamedEditCommand('revoke', { version: 1, inviteId, includeComment: true }),
    ).toBeNull();
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
