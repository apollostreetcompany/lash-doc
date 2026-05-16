import { createLocalCollabRoom } from '@lash/collab-service';
import { createDocumentId, type EditorOp } from '@lash/types';
import { describe, expect, test } from 'vitest';

const actor = { type: 'user', id: 'local-user' } as const;

describe('offline local collab room', () => {
  test('queues updates while offline and replays them on reconnect', async () => {
    const room = createLocalCollabRoom({
      docId: createDocumentId('offline-doc'),
      actor,
      wsEndpoint: 'local://test',
    });
    const seen: EditorOp[] = [];
    room.onYjsUpdate((update) => {
      seen.push(...room.toEditorOps(update));
    });

    room.setOnline(false);
    room.applyYjsUpdate(room.fromEditorOps([{ op: 'replace_text', from: 0, to: 0, text: 'A' }]));
    room.applyYjsUpdate(room.fromEditorOps([{ op: 'replace_text', from: 1, to: 1, text: 'B' }]));

    expect(room.getQueueDepth()).toBe(2);
    expect(seen).toHaveLength(0);

    room.setOnline(true);
    await room.flushQueue();

    expect(room.getQueueDepth()).toBe(0);
    expect(seen).toMatchObject([
      { op: 'replace_text', text: 'A' },
      { op: 'replace_text', text: 'B' },
    ]);
  });

  test('emits presence pause and resume states', () => {
    const room = createLocalCollabRoom({
      docId: createDocumentId('presence-doc'),
      actor,
      wsEndpoint: 'local://test',
    });
    const states: string[] = [];
    room.onPresence((peers) => {
      states.push(peers[0]?.connection ?? 'missing');
    });

    room.setOnline(false);
    room.setOnline(true);

    expect(states).toEqual(['online', 'offline', 'online']);
  });
});
