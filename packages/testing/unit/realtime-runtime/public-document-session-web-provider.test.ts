import { createLashEditorExtensions } from '@lash/editor-core';
import { getSchema } from '@tiptap/core';
import { describe, expect, it, vi } from 'vitest';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';
import * as Y from 'yjs';

import {
  createPublicDocumentProvider,
  type PublicDocumentBrowserSession,
} from '../../../../apps/web/lib/publicDocumentAccess/provider';
import { writeRealtimeDocumentTitle } from '../../../../apps/web/lib/realtimeCollaboration';

const ROOM_ID = `doc-v1-${'c'.repeat(64)}`;
const BODY = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1, headingId: null },
      content: [{ type: 'text', text: 'Launch brief' }],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'The owner’s latest sentence.' }],
    },
  ],
};
const SESSION: PublicDocumentBrowserSession = {
  authorization: {
    roomId: ROOM_ID,
    mode: 'read',
    policyVersion: 5,
    cutoffGeneration: 2,
  },
  actorId: 'public-reader-7',
  socketUrl: `wss://worker.example/api/realtime/rooms/${ROOM_ID}/socket?protocolVersion=4&actorId=public-reader-7`,
  socketProtocol: 'lash-realtime-v4',
  ticketProtocol: `lash-public-ticket.${'f'.repeat(43)}`,
};

class FakeSocket {
  readonly listeners = new Map<string, Set<(event: Event) => void>>();
  readonly send = vi.fn();
  readonly close = vi.fn();

  addEventListener(type: string, listener: (event: Event) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, init: Record<string, unknown> = {}) {
    const event = Object.assign(new Event(type), init);
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  frame(value: unknown) {
    this.emit('message', { data: JSON.stringify(value) });
  }
}

const documentUpdates = () => {
  const doc = prosemirrorJSONToYDoc(getSchema(createLashEditorExtensions()), BODY, 'content');
  writeRealtimeDocumentTitle(doc, 'Account ownership handoff');
  const hydration = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
  const stateVector = Y.encodeStateVector(doc);
  writeRealtimeDocumentTitle(doc, 'Account ownership handoff — updated');
  const live = Buffer.from(Y.encodeStateAsUpdate(doc, stateVector)).toString('base64');
  return { hydration, live };
};

const hydrationUpdate = () => documentUpdates().hydration;

const ready = (overrides: Record<string, unknown> = {}) => ({
  type: 'room-ready',
  roomId: ROOM_ID,
  protocolVersion: 4,
  mode: 'read',
  policyVersion: 5,
  cutoffGeneration: 2,
  highWaterSequence: 17,
  ...overrides,
});

const complete = (overrides: Record<string, unknown> = {}) => ({
  type: 'room-hydration-complete',
  roomId: ROOM_ID,
  protocolVersion: 4,
  mode: 'read',
  policyVersion: 5,
  cutoffGeneration: 2,
  highWaterSequence: 17,
  persistedUpdates: 1,
  ...overrides,
});

describe('public protocol-v4 document provider', () => {
  it('uses only fixed protocol plus one-use ticket and reveals after exact complete hydration', async () => {
    expect(getSchema(createLashEditorExtensions()).nodeFromJSON(BODY).toJSON()).toEqual(BODY);
    const socket = new FakeSocket();
    const createSocket = vi.fn((_url: string, _protocols: string[]) => socket);
    const provider = createPublicDocumentProvider(SESSION, { createSocket });
    const snapshots: string[] = [];
    provider.subscribe((snapshot) => snapshots.push(snapshot.phase));
    const started = provider.start();
    const updates = documentUpdates();

    expect(createSocket).toHaveBeenCalledWith(SESSION.socketUrl, [
      'lash-realtime-v4',
      SESSION.ticketProtocol,
    ]);
    expect(SESSION.socketUrl).not.toContain('ticket');
    expect(provider.getSnapshot()).toMatchObject({
      phase: 'authorizing',
      projection: null,
    });

    socket.frame(ready());
    socket.frame({ type: 'yjs-update', roomId: ROOM_ID, update: updates.hydration });
    expect(provider.getSnapshot()).toMatchObject({
      phase: 'hydrating',
      projection: null,
    });

    socket.frame(complete());
    await expect(started).resolves.toEqual({
      title: 'Account ownership handoff',
      body: BODY,
    });
    expect(provider.getSnapshot()).toEqual({
      phase: 'ready',
      mode: 'read',
      projection: {
        title: 'Account ownership handoff',
        body: BODY,
      },
    });
    expect(snapshots).toEqual(['authorizing', 'hydrating', 'ready']);

    socket.frame({ type: 'yjs-update', roomId: ROOM_ID, update: updates.live });
    expect(provider.getSnapshot()).toMatchObject({
      phase: 'ready',
      projection: {
        title: 'Account ownership handoff — updated',
        body: BODY,
      },
    });
    expect(socket.send).not.toHaveBeenCalled();
  });

  it.each([
    ['room', complete({ roomId: `doc-v1-${'d'.repeat(64)}` })],
    ['mode', complete({ mode: 'comment' })],
    ['policy version', complete({ policyVersion: 6 })],
    ['cutoff', complete({ cutoffGeneration: 3 })],
    ['high water', complete({ highWaterSequence: 18 })],
  ])('denies a %s mismatch without revealing title or body', async (_label, completion) => {
    const socket = new FakeSocket();
    const provider = createPublicDocumentProvider(SESSION, {
      createSocket: () => socket,
    });
    const started = provider.start();
    socket.frame(ready());
    socket.frame({ type: 'yjs-update', roomId: ROOM_ID, update: hydrationUpdate() });
    socket.frame(completion);

    await expect(started).rejects.toThrow('public-document-unavailable');
    expect(provider.getSnapshot()).toEqual({
      phase: 'unavailable',
      projection: null,
    });
    expect(socket.close).toHaveBeenCalled();
  });

  it('clears the projection immediately on terminal policy cutoff', async () => {
    const socket = new FakeSocket();
    const provider = createPublicDocumentProvider(
      { ...SESSION, authorization: { ...SESSION.authorization, mode: 'comment' } },
      { createSocket: () => socket },
    );
    const started = provider.start();
    socket.frame(ready({ mode: 'comment' }));
    socket.frame({ type: 'yjs-update', roomId: ROOM_ID, update: hydrationUpdate() });
    socket.frame(complete({ mode: 'comment' }));
    await started;
    expect(provider.getSnapshot().phase).toBe('ready');

    socket.emit('close', { code: 4403, reason: 'public-policy-changed' });
    expect(provider.getSnapshot()).toEqual({
      phase: 'unavailable',
      projection: null,
    });
  });
});
