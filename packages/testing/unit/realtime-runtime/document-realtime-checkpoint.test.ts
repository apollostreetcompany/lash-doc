import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import {
  REALTIME_CHECKPOINT_BASE64_LIMIT,
  REALTIME_SNAPSHOT_INTERVAL,
  REALTIME_UPDATE_BASE64_LIMIT,
  buildRealtimeCheckpoint,
  bytesToBase64,
  isRealtimeUpdatePayload,
} from '../../../realtime-worker/src/persistence';
import { LashRealtimeRoom } from '../../../realtime-worker/src/room';
import { imageWithCaption } from '../../fixtures/image-with-caption';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(
      protected readonly ctx: unknown,
      protected readonly env: unknown,
    ) {}
  },
}));

const { DatabaseSync } = createRequire(import.meta.url)(
  'node:sqlite',
) as typeof import('node:sqlite');
const roomId = `doc-v1-${'a'.repeat(64)}`;
const initialUpdate =
  'AQTvjKbdDgAHAQdjb250ZW50AwlwYXJhZ3JhcGgHAO+Mpt0OAAYEAO+Mpt0OAQ1Qcm9tb3RlZCBib2R5KAEZbGFzaDpkb2N1bWVudC1tZXRhZGF0YTp2MQV0aXRsZQF3DlByb21vdGVkIHRpdGxlAA==';

const connectedOwner = () => ({
  readyState: 1,
  deserializeAttachment: () => ({
    protocolVersion: 3,
    hydrated: true,
    actorId: 'owner',
    roomId,
    capabilities: ['doc.read', 'doc.edit'],
    connectedAt: 1,
    historyGeneration: 0,
  }),
  send: vi.fn(),
  close: vi.fn(),
});

const openRoom = (db: InstanceType<typeof DatabaseSync>) => {
  vi.stubGlobal('WebSocketRequestResponsePair', class {});
  return new LashRealtimeRoom(
    {
      setWebSocketAutoResponse: vi.fn(),
      getWebSockets: () => [],
      blockConcurrencyWhile: (callback: () => void) => callback(),
      storage: {
        sql: {
          exec(query: string, ...args: import('node:sqlite').SQLInputValue[]) {
            const rows = db.prepare(query).all(...args);
            return { toArray: () => rows };
          },
        },
        transactionSync(callback: () => unknown) {
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
      },
    } as never,
    { LASH_SHARE_PHASE: 'enabled', LASH_NAMED_EDIT_PHASE: 'enabled' } as never,
  );
};

describe('durable room checkpoints', () => {
  it('rejects input outside the supported encoded journal row bound before decoding', () => {
    expect(isRealtimeUpdatePayload(initialUpdate)).toBe(true);
    expect(isRealtimeUpdatePayload('  not a Yjs update  ')).toBe(false);
    expect(isRealtimeUpdatePayload('A'.repeat(REALTIME_UPDATE_BASE64_LIMIT + 4))).toBe(false);
  });

  it('keeps image history readable while reconnecting from a bounded GC checkpoint', () => {
    const client = new Y.Doc({ gc: false });
    const content = client.getXmlFragment('content');
    const paragraph = new Y.XmlElement('paragraph');
    const text = new Y.XmlText();
    content.push([paragraph]);
    paragraph.push([text]);
    text.insert(0, 'Meeting notes');
    const position = Y.createRelativePositionFromTypeIndex(text, 7);
    const updateLog = [Y.encodeStateAsUpdate(client)];
    client.on('update', (update: Uint8Array) => updateLog.push(update));
    const source = `data:image/png;base64,${imageWithCaption(224 * 1024)}`;

    for (let index = 0; index < 42; index += 1) {
      const image = new Y.XmlElement('image');
      image.setAttribute('src', source);
      content.push([image]);
      content.delete(content.length - 1, 1);
    }
    const past = buildRealtimeCheckpoint(updateLog.slice(0, 2).map(bytesToBase64));
    const checkpoint = buildRealtimeCheckpoint(updateLog.map(bytesToBase64));
    expect(bytesToBase64(Y.mergeUpdates(updateLog)).length).toBeGreaterThan(
      REALTIME_CHECKPOINT_BASE64_LIMIT,
    );
    expect(checkpoint?.length).toBeLessThan(4096);

    const previous = new Y.Doc();
    Y.applyUpdate(previous, Buffer.from(past ?? '', 'base64'));
    expect((previous.getXmlFragment('content').get(1) as Y.XmlElement).getAttribute('src')).toBe(
      source,
    );

    const reconnected = new Y.Doc();
    Y.applyUpdate(reconnected, Buffer.from(checkpoint ?? '', 'base64'));
    expect(reconnected.getXmlFragment('content').toString()).toBe(
      '<paragraph>Meeting notes</paragraph>',
    );
    expect(Y.encodeStateVector(reconnected)).toEqual(Y.encodeStateVector(client));
    expect(Y.createAbsolutePositionFromRelativePosition(position, reconnected)?.index).toBe(7);

    text.insert(text.length, ' after reconnect');
    Y.applyUpdate(reconnected, updateLog.at(-1)!);
    expect(reconnected.getXmlFragment('content').toString()).toBe(content.toString());
    previous.destroy();
    reconnected.destroy();
    client.destroy();
  });

  it('rolls back the due edit and history receipt if the checkpoint write fails', async () => {
    const db = new DatabaseSync(':memory:');
    const client = new Y.Doc();
    try {
      const room = openRoom(db);
      db.prepare(
        `
        INSERT INTO document_projection_v1 VALUES
          (1, ?, 'Promoted title', '{}', 'body', ?, 'initial', 'snapshot', 0, 0, 1, 'now')
      `,
      ).run(roomId, initialUpdate);
      const count = (table: 'yjs_updates' | 'yjs_snapshots' | 'shared_history_revisions_v1') =>
        db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count;

      Y.applyUpdate(client, Buffer.from(initialUpdate, 'base64'));
      const content = client.getXmlFragment('content').get(0) as Y.XmlElement;
      const text = content.get(0) as Y.XmlText;
      const nextMessage = () => {
        const before = Y.encodeStateVector(client);
        text.insert(text.length, 'a');
        return JSON.stringify({
          type: 'yjs-update',
          historyGeneration: 0,
          updateId: randomUUID(),
          update: bytesToBase64(Y.encodeStateAsUpdate(client, before)),
        });
      };
      const owner = connectedOwner();
      for (let index = 1; index < REALTIME_SNAPSHOT_INTERVAL; index += 1) {
        await room.webSocketMessage(owner as never, nextMessage());
      }
      expect(count('yjs_updates')).toBe(REALTIME_SNAPSHOT_INTERVAL - 1);
      expect(count('shared_history_revisions_v1')).toBe(REALTIME_SNAPSHOT_INTERVAL);
      expect(owner.send).toHaveBeenCalledTimes(REALTIME_SNAPSHOT_INTERVAL - 1);
      db.exec(`
        CREATE TRIGGER test_checkpoint_write_failure BEFORE INSERT ON yjs_snapshots
        BEGIN SELECT RAISE(ABORT, 'checkpoint unavailable'); END
      `);
      const pending = nextMessage();
      owner.send.mockClear();
      await room.webSocketMessage(owner as never, pending);
      expect(owner.send).not.toHaveBeenCalled();
      expect(owner.close).toHaveBeenCalledWith(1011, 'document-write-unavailable');
      expect(count('yjs_updates')).toBe(REALTIME_SNAPSHOT_INTERVAL - 1);
      expect(count('shared_history_revisions_v1')).toBe(REALTIME_SNAPSHOT_INTERVAL);
      expect(count('yjs_snapshots')).toBe(0);

      db.exec('DROP TRIGGER test_checkpoint_write_failure');
      const restarted = openRoom(db);
      const reconnectedOwner = connectedOwner();
      await restarted.webSocketMessage(reconnectedOwner as never, pending);
      expect(count('yjs_updates')).toBe(REALTIME_SNAPSHOT_INTERVAL);
      expect(count('shared_history_revisions_v1')).toBe(REALTIME_SNAPSHOT_INTERVAL + 1);
      expect(count('yjs_snapshots')).toBe(1);
      expect(reconnectedOwner.send).toHaveBeenCalledWith(
        expect.stringContaining(`"sequence":${REALTIME_SNAPSHOT_INTERVAL}`),
      );
      const checkpoint = db.prepare('SELECT update_b64 FROM yjs_snapshots').get()?.update_b64;
      const hydrated = new Y.Doc();
      Y.applyUpdate(hydrated, Buffer.from(String(checkpoint), 'base64'));
      expect(hydrated.getXmlFragment('content').toString()).toBe(
        client.getXmlFragment('content').toString(),
      );
      hydrated.destroy();

      const latest = REALTIME_SNAPSHOT_INTERVAL * 2 + 5;
      for (let sequence = REALTIME_SNAPSHOT_INTERVAL + 1; sequence <= latest; sequence += 1) {
        await restarted.webSocketMessage(reconnectedOwner as never, nextMessage());
      }
      // Simulate an old room whose transient checkpoint failures left an
      // interior gap before compaction eventually resumed.
      db.exec('DELETE FROM yjs_snapshots');
      db.prepare('INSERT INTO yjs_snapshots VALUES (?, ?, ?)').run(
        latest,
        bytesToBase64(Y.encodeStateAsUpdate(client)),
        '2026-11-18T00:00:00.000Z',
      );
      reconnectedOwner.send.mockClear();
      await restarted.webSocketMessage(
        reconnectedOwner as never,
        JSON.stringify({
          type: 'shared-history-compare',
          requestId: randomUUID(),
          from: 1,
          to: latest - 1,
        }),
      );
      expect(JSON.parse(reconnectedOwner.send.mock.calls[0]?.[0] ?? '{}')).toMatchObject({
        type: 'shared-history-result',
        outcome: { kind: 'compare' },
      });
      expect(count('yjs_updates')).toBe(latest);
      expect(count('shared_history_revisions_v1')).toBe(latest + 1);
      expect(count('yjs_snapshots')).toBe(3);
    } finally {
      client.destroy();
      db.close();
      vi.unstubAllGlobals();
    }
  });
});
