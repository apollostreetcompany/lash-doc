import { applyTextOperations } from '@lash/ai';
import { createLocalCollabRoom } from '@lash/collab-service';
import { createDocumentId, type ActorRef, type EditorOp } from '@lash/types';
import { describe, expect, it } from 'vitest';

const actorA: ActorRef = { type: 'user', id: 'client-a' };
const actorB: ActorRef = { type: 'user', id: 'client-b' };
const replaySequentially = (ops: EditorOp[]) =>
  ops.reduce((text, op) => applyTextOperations(text, [op]), '');

describe('multi-client-converge', () => {
  it('converges two local replicas after queued offline updates replay', async () => {
    const docId = createDocumentId('qa-multi-client');
    const clientA = createLocalCollabRoom({ docId, actor: actorA, wsEndpoint: 'local://room' });
    const clientB = createLocalCollabRoom({ docId, actor: actorB, wsEndpoint: 'local://room' });
    const ops: EditorOp[] = [
      { op: 'replace_text', from: 0, to: 0, text: 'Hello' },
      { op: 'replace_text', from: 5, to: 5, text: ' shared' },
      { op: 'replace_text', from: 12, to: 12, text: ' doc' },
    ];

    clientB.setOnline(false);
    for (const op of ops) {
      const update = clientA.fromEditorOps([op]);
      clientA.applyYjsUpdate(update, 'client-a');
      clientB.applyYjsUpdate(update, 'network');
    }
    expect(clientB.getQueueDepth()).toBe(ops.length);

    clientB.setOnline(true);
    await clientB.flushQueue();

    expect(clientA.getAppliedOps()).toEqual(ops);
    expect(clientB.getAppliedOps()).toEqual(ops);
    expect(replaySequentially(clientA.getAppliedOps())).toBe('Hello shared doc');
    expect(replaySequentially(clientB.getAppliedOps())).toBe('Hello shared doc');

    await clientA.close();
    await clientB.close();
  });
});
