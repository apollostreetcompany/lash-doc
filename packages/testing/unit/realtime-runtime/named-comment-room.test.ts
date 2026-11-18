import { createAnchor } from '@lash/doc-chat';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));

const { DatabaseSync } = createRequire(import.meta.url)(
  'node:sqlite',
) as typeof import('node:sqlite');
const ROOM_ID = `doc-v1-${'a'.repeat(64)}`;
const ACTOR_ID = `named-${'b'.repeat(32)}`;
const INVITE_ID = '338c91e5-e809-4264-b005-269a8442647d';
const TITLE = 'Ready for comment';
const BODY = 'review this paragraph';

const makeDocument = () => {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement('paragraph');
  const text = new Y.XmlText();
  doc.getXmlFragment('content').insert(0, [paragraph]);
  paragraph.insert(0, [text]);
  text.insert(0, BODY);
  doc.getMap('lash:document-metadata:v1').set('title', TITLE);
  return { doc, text };
};

const anchorFor = (text: Y.XmlText, from: number, to: number) => ({
  ...createAnchor({ baseVersion: null, docText: BODY, from, to }),
  relativeRange: {
    start: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, from, 0)),
    end: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, to, -1)),
  },
});

const socket = (attachment: unknown) => ({
  readyState: 1,
  deserializeAttachment: () => attachment,
  send: vi.fn<(serialized: string) => void>(),
  close: vi.fn(),
});

const commentAttachment = (expiresAtMs: number) => ({
  protocolVersion: 6,
  actorId: ACTOR_ID,
  roomId: ROOM_ID,
  connectedAt: 1,
  hydrated: true,
  capabilities: ['doc.read', 'doc.comment', 'doc.suggest'],
  scope: 'comment',
  namedCommentGrant: { inviteId: INVITE_ID, expiresAtMs },
  historyGeneration: 0,
});

const frames = (peer: ReturnType<typeof socket>) =>
  peer.send.mock.calls.map(([serialized]) => JSON.parse(serialized) as Record<string, unknown>);

const makeRoom = async (sockets: Array<ReturnType<typeof socket>>) => {
  const { LashRealtimeRoom } = await import('../../../realtime-worker/src/room');
  const { initializeNamedEditStorage } = await import(
    '../../../realtime-worker/src/namedEditStore'
  );
  const { initializeSharedHistoryStorage } = await import(
    '../../../realtime-worker/src/sharedHistory'
  );
  const { initializeCollaboratorReviewStorage, readCollaboratorReviewSnapshot } = await import(
    '../../../realtime-worker/src/collaboratorReviewStore'
  );
  const { doc, text } = makeDocument();
  const db = new DatabaseSync(':memory:');
  const storage = {
    sql: {
      exec(query: string, ...values: import('node:sqlite').SQLInputValue[]) {
        const rows = db.prepare(query).all(...values);
        return { toArray: () => rows, one: () => rows[0] };
      },
    },
    transactionSync<T>(callback: () => T): T {
      db.exec('BEGIN');
      try {
        const result = callback();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as Parameters<typeof initializeNamedEditStorage>[0];
  initializeNamedEditStorage(storage);
  initializeCollaboratorReviewStorage(storage);
  initializeSharedHistoryStorage(storage);
  db.exec(`
    CREATE TABLE document_owner_v1 (singleton INTEGER, owner_principal_id TEXT);
    CREATE TABLE document_projection_v1 (singleton INTEGER, room_id TEXT, snapshot_sha256 TEXT, shareable INTEGER, initial_update_b64 TEXT);
    CREATE TABLE document_promotion_receipt_v1 (singleton INTEGER, snapshot_sha256 TEXT, owner_principal_id TEXT);
    CREATE TABLE owner_session_control_v1 (singleton INTEGER, frozen INTEGER, block_new_sessions INTEGER);
    INSERT INTO document_owner_v1 VALUES (1, 'owner');
    INSERT INTO document_promotion_receipt_v1 VALUES (1, 'matching', 'owner');
    CREATE TABLE yjs_updates (sequence INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT, source TEXT, update_b64 TEXT, created_at TEXT);
    CREATE TABLE yjs_snapshots (sequence INTEGER PRIMARY KEY, update_b64 TEXT, created_at TEXT);
  `);
  db.prepare("INSERT INTO document_projection_v1 VALUES (1, ?, 'matching', 1, ?)").run(
    ROOM_ID,
    Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'),
  );
  db.prepare(
    `INSERT INTO named_comment_invite_v1
     (invite_id, email_digest, email_ciphertext, token_hash, expires_at_ms, accepted_principal_id)
     VALUES (?, 'digest', 'cipher', 'token', ?, 'comment-account')`,
  ).run(INVITE_ID, Date.now() + 60_000);
  const room = Object.assign(
    Object.create(LashRealtimeRoom.prototype) as InstanceType<typeof LashRealtimeRoom>,
    {
      ctx: { storage, getWebSockets: () => sockets },
      env: {
        LASH_SHARE_PHASE: 'enabled',
        LASH_NAMED_EDIT_PHASE: 'enabled',
        LASH_NAMED_COMMENT_PHASE: 'enabled',
      },
      projectionCache: doc,
      canonicalBodyCache: null,
      commentReviewFingerprint: null,
    },
  );
  return {
    room,
    doc,
    text,
    db,
    snapshot: () => readCollaboratorReviewSnapshot(storage),
    close: () => {
      doc.destroy();
      db.close();
    },
  };
};

describe('named Comment room scope', () => {
  it('accepts only the typed v6 Comment attachment without edit or private socket fields', async () => {
    const { isCurrentSocketAttachment } = await import('../../../realtime-worker/src/room');
    const attachment = commentAttachment(1000);
    expect(isCurrentSocketAttachment(attachment)).toBe(true);
    expect(
      isCurrentSocketAttachment({ ...attachment, capabilities: ['doc.read', 'doc.edit'] }),
    ).toBe(false);
    expect(isCurrentSocketAttachment({ ...attachment, protocolVersion: 5 })).toBe(false);
    expect(
      isCurrentSocketAttachment({ ...attachment, namedEditGrant: attachment.namedCommentGrant }),
    ).toBe(false);
  });

  it('projects live content with stable coordinates and refuses a room containing private roots', async () => {
    const { encodeNamedCommentYjsProjection } = await import(
      '../../../realtime-worker/src/namedEditProjection'
    );
    const { createRoomCommentAnchorReader } = await import(
      '../../../realtime-worker/src/collaboratorSuggestion'
    );
    const { doc, text } = makeDocument();
    const copy = new Y.Doc();
    try {
      text.insert(text.length, ' Deleted private phrase.');
      text.delete(BODY.length, text.length - BODY.length);
      const metadata = doc.getMap('lash:document-metadata:v1');
      metadata.set('title', 'Previous title');
      metadata.set('title', TITLE);
      const anchor = anchorFor(text, 7, 11);
      const snapshot = encodeNamedCommentYjsProjection(doc);
      expect(snapshot).toBeTruthy();
      const snapshotBytes = Buffer.from(snapshot!, 'base64');
      expect(snapshotBytes.includes('Deleted private phrase.')).toBe(false);
      expect(snapshotBytes.includes('Previous title')).toBe(false);
      Y.applyUpdate(copy, snapshotBytes);
      expect(createRoomCommentAnchorReader(copy)(anchor)?.token.text).toBe('this');
      expect(
        createRoomCommentAnchorReader(copy)({
          ...anchor,
          token: { ...anchor.token, text: 'that' },
        }),
      ).toBeNull();
      const state = Y.encodeStateVector(doc);
      text.insert(0, 'please ');
      const next = encodeNamedCommentYjsProjection(doc, state);
      expect(next).toBeTruthy();
      Y.applyUpdate(copy, Buffer.from(next!, 'base64'));
      expect(createRoomCommentAnchorReader(copy)(anchor)?.token.text).toBe('this');
      doc.getMap('lash:chat-threads').set('historical', 'do not send');
      expect(encodeNamedCommentYjsProjection(doc)).toBeNull();
    } finally {
      copy.destroy();
      doc.destroy();
    }
  });

  it('admits typed replies on a current anchor and rejects decisions, stale quotes, and direct writes', async () => {
    const expiresAt = Date.now() + 60_000;
    const commenter = socket(commentAttachment(expiresAt));
    const owner = socket({
      protocolVersion: 3,
      actorId: 'owner',
      roomId: ROOM_ID,
      hydrated: true,
      capabilities: ['doc.read', 'doc.edit'],
      historyGeneration: 0,
      connectedAt: 1,
    });
    const fixture = await makeRoom([commenter, owner]);
    try {
      const message = async (peer: typeof commenter, payload: object) =>
        fixture.room.webSocketMessage(peer as never, JSON.stringify(payload));
      const review = (operation: object, operationId = randomUUID()) =>
        message(commenter, { type: 'review-operation', operationId, operation });
      const anchor = anchorFor(fixture.text, 7, 11);
      const threadId = randomUUID();
      const opening = { type: 'create', threadId, anchor, body: 'Specific comment.' };
      const openingId = randomUUID();
      await review(opening, openingId);
      await review({ type: 'reply', threadId, body: 'Follow-up.' });
      await review({
        type: 'propose',
        threadId: randomUUID(),
        anchor,
        before: '{"content":[{"text":"this","type":"text"}]}',
        replacement: 'that',
        body: 'Proposed edit.',
      });
      for (const blocked of [
        { type: 'status', threadId, status: 'resolved' },
        { type: 'decide', threadId, decision: 'accepted' },
      ]) {
        await review(blocked);
      }
      await review({
        type: 'create',
        threadId: randomUUID(),
        anchor: { ...anchor, token: { ...anchor.token, text: 'that' } },
        body: 'Forged quote.',
      });
      expect(fixture.snapshot().map(({ operation }) => operation.type)).toEqual([
        'create',
        'reply',
        'propose',
      ]);
      expect(frames(commenter).map(({ type, code }) => [type, code])).toEqual([
        ['review-snapshot', undefined],
        ['review-ack', undefined],
        ['review-snapshot', undefined],
        ['review-ack', undefined],
        ['review-snapshot', undefined],
        ['review-ack', undefined],
        ['review-error', 'review_scope_mismatch'],
        ['review-error', 'review_scope_mismatch'],
        ['review-error', 'review_anchor_stale'],
      ]);
      expect(frames(commenter)[0]).toMatchObject({
        threads: [{ anchor: { token: { before: '', after: '' } } }],
      });
      expect(frames(owner)[0]).toMatchObject({
        operation: { operation: { anchor: { token: { before: 'review ', after: ' paragraph' } } } },
      });

      for (const type of [
        'yjs-update',
        'awareness-update',
        'broadcast',
        'shared-history-request',
      ]) {
        const candidate = socket(commentAttachment(expiresAt));
        await message(candidate, { type });
        expect(candidate.close).toHaveBeenCalledWith(4403, 'named-comment-scope');
        expect(candidate.send).not.toHaveBeenCalled();
      }
      expect(fixture.text.toString()).toBe(BODY);
      const previousState = Y.encodeStateVector(fixture.doc);
      fixture.text.delete(7, 4);
      const update = Buffer.from(Y.encodeStateAsUpdate(fixture.doc, previousState)).toString(
        'base64',
      );
      const { broadcastYjsUpdate } = fixture.room as unknown as {
        broadcastYjsUpdate(
          roomId: string,
          persisted: {
            actorId: string;
            sequence: number;
            source: 'client';
            update: string;
            createdAt: string;
          },
          options: { publicStateVector: Uint8Array },
        ): void;
      };
      commenter.send.mockClear();
      broadcastYjsUpdate.call(
        fixture.room,
        ROOM_ID,
        {
          actorId: 'owner',
          sequence: 8,
          source: 'client',
          update,
          createdAt: '2026-11-19T00:00:00Z',
        },
        { publicStateVector: previousState },
      );
      expect(frames(commenter)).toEqual([
        { roomId: ROOM_ID, type: 'yjs-update', update: expect.any(String) },
        {
          roomId: ROOM_ID,
          type: 'review-snapshot',
          threads: [
            expect.objectContaining({
              anchor: null,
              id: threadId,
              messages: [
                expect.objectContaining({ body: 'Specific comment.' }),
                expect.objectContaining({ body: 'Follow-up.' }),
              ],
            }),
            expect.objectContaining({
              anchor: null,
              proposal: expect.objectContaining({ status: 'pending', replacement: 'that' }),
            }),
          ],
        },
      ]);
      await review(opening, openingId);
      expect(frames(commenter).at(-1)).toMatchObject({
        type: 'review-ack',
        operationId: openingId,
        sequence: 1,
      });
      await review({ type: 'reply', threadId, body: 'Stale.' });
      expect(frames(commenter).at(-1)).toMatchObject({ code: 'review_thread_missing' });

      fixture.db.exec('UPDATE named_comment_invite_v1 SET revoked_at_ms = 1');
      await review({ type: 'create', threadId: randomUUID(), anchor, body: 'Revoked.' });
      expect(commenter.close).toHaveBeenCalledWith(4403, 'named-access-revoked');
      expect(fixture.snapshot()).toHaveLength(3);
    } finally {
      fixture.close();
    }
  });

  it('retains a detached accepted receipt for the proposer but no old rich slice or unrelated stale thread', async () => {
    const commenter = socket(commentAttachment(Date.now() + 60_000));
    const owner = socket({
      protocolVersion: 3,
      actorId: 'owner',
      roomId: ROOM_ID,
      hydrated: true,
      capabilities: ['doc.read', 'doc.edit'],
      historyGeneration: 0,
      connectedAt: 1,
    });
    const fixture = await makeRoom([commenter, owner]);
    try {
      const review = (peer: typeof owner, operation: object) =>
        fixture.room.webSocketMessage(
          peer as never,
          JSON.stringify({
            type: 'review-operation',
            operationId: randomUUID(),
            operation,
          }),
        );
      const anchor = anchorFor(fixture.text, 7, 11);
      const threadId = randomUUID();
      await review(owner, {
        type: 'create',
        threadId: randomUUID(),
        anchor,
        body: 'Older unrelated discussion.',
      });
      await review(commenter, {
        type: 'propose',
        threadId,
        anchor,
        before: '{"content":[{"text":"this","type":"text"}]}',
        replacement: 'that',
        body: 'Proposed wording.',
      });
      commenter.send.mockClear();
      await review(owner, { type: 'decide', threadId, decision: 'accepted' });

      expect(fixture.text.toString()).toBe('review that paragraph');
      const view = frames(commenter).find((frame) => frame.type === 'review-snapshot');
      expect(view).toMatchObject({
        roomId: ROOM_ID,
        threads: [
          {
            id: threadId,
            anchor: null,
            messages: [{ body: 'Proposed wording.' }],
            proposal: { status: 'accepted', replacement: 'that' },
          },
        ],
      });
      expect(JSON.stringify(view)).not.toMatch(
        /Older unrelated|bodySequence|relativeRange|"before"|"this"/u,
      );
      expect(fixture.snapshot().at(-1)).toMatchObject({
        operation: { type: 'decide', decision: 'accepted' },
        bodySequence: 1,
      });
    } finally {
      fixture.close();
    }
  });
});
