import { createLashEditorExtensions, normalizeYProsemirrorProjectionJson } from '@lash/editor-core';
import {
  canonicalize,
  type PublicDocumentAccessModeV1,
  type PublicRoomHydrationCompleteFrameV1,
  type PublicRoomReadyFrameV1,
} from '@lash/types';
import { getSchema } from '@tiptap/core';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';

import { readRealtimeDocumentTitle } from '../realtimeCollaboration';

const PUBLIC_SOCKET_PROTOCOL = 'lash-realtime-v4' as const;
const PUBLIC_TICKET = /^lash-public-ticket\.[A-Za-z0-9_-]{43}$/u;
const ROOM_ID = /^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u;
const ACTOR_ID = /^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/u;
const STANDARD_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const DEFAULT_HYDRATION_TIMEOUT_MS = 8_000;
const lashSchema = getSchema(createLashEditorExtensions());

export type PublicDocumentProjection = Readonly<{
  title: string;
  body: unknown;
}>;

export type PublicDocumentProviderSnapshot =
  | Readonly<{ phase: 'authorizing' | 'hydrating' | 'unavailable'; projection: null }>
  | Readonly<{
      phase: 'ready';
      mode: PublicDocumentAccessModeV1;
      projection: PublicDocumentProjection;
    }>;

export type PublicDocumentBrowserSession = Readonly<{
  authorization: Readonly<{
    roomId: string;
    mode: PublicDocumentAccessModeV1;
    policyVersion: number;
    cutoffGeneration: number;
  }>;
  actorId: string;
  socketUrl: string;
  socketProtocol: typeof PUBLIC_SOCKET_PROTOCOL;
  ticketProtocol: string;
}>;

type PublicSocket = Readonly<{
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  close(code?: number, reason?: string): void;
}>;

export type PublicDocumentProviderDependencies = Readonly<{
  createSocket(url: string, protocols: string[]): PublicSocket;
  hydrationTimeoutMs?: number;
}>;

export type PublicDocumentProvider = Readonly<{
  start(): Promise<PublicDocumentProjection>;
  getSnapshot(): PublicDocumentProviderSnapshot;
  subscribe(listener: (snapshot: PublicDocumentProviderSnapshot) => void): () => void;
  destroy(): void;
}>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
};

const isPolicyVersion = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;

const isNonnegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

const parseReadyFrame = (
  value: unknown,
  session: Pick<PublicDocumentBrowserSession, 'authorization'>,
): PublicRoomReadyFrameV1 | null => {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      'type',
      'roomId',
      'protocolVersion',
      'mode',
      'policyVersion',
      'cutoffGeneration',
      'highWaterSequence',
    ]) ||
    value.type !== 'room-ready' ||
    value.roomId !== session.authorization.roomId ||
    value.protocolVersion !== 4 ||
    value.mode !== session.authorization.mode ||
    value.policyVersion !== session.authorization.policyVersion ||
    value.cutoffGeneration !== session.authorization.cutoffGeneration ||
    !isPolicyVersion(value.policyVersion) ||
    !isNonnegativeInteger(value.cutoffGeneration) ||
    !isNonnegativeInteger(value.highWaterSequence)
  ) {
    return null;
  }
  return value as unknown as PublicRoomReadyFrameV1;
};

const parseCompletionFrame = (
  value: unknown,
  ready: PublicRoomReadyFrameV1,
): PublicRoomHydrationCompleteFrameV1 | null => {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      'type',
      'roomId',
      'protocolVersion',
      'mode',
      'policyVersion',
      'cutoffGeneration',
      'highWaterSequence',
      'persistedUpdates',
    ]) ||
    value.type !== 'room-hydration-complete' ||
    value.roomId !== ready.roomId ||
    value.protocolVersion !== ready.protocolVersion ||
    value.mode !== ready.mode ||
    value.policyVersion !== ready.policyVersion ||
    value.cutoffGeneration !== ready.cutoffGeneration ||
    value.highWaterSequence !== ready.highWaterSequence ||
    !isNonnegativeInteger(value.persistedUpdates)
  ) {
    return null;
  }
  return value as unknown as PublicRoomHydrationCompleteFrameV1;
};

const decodeUpdate = (value: unknown) => {
  if (typeof value !== 'string' || !STANDARD_BASE64.test(value)) {
    throw new Error('invalid-public-yjs-update');
  }
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const canonical = btoa(binary);
  if (canonical !== value) throw new Error('invalid-public-yjs-update');
  return bytes;
};

const readProjection = (doc: Y.Doc): PublicDocumentProjection => {
  const title = readRealtimeDocumentTitle(doc);
  if (title === null) throw new Error('invalid-public-title');
  const body = normalizeYProsemirrorProjectionJson(
    yXmlFragmentToProsemirrorJSON(doc.getXmlFragment('content')),
  );
  const validated = lashSchema.nodeFromJSON(body).toJSON();
  canonicalize(validated);
  return Object.freeze({ title, body: validated });
};

const defaultCreateSocket = (url: string, protocols: string[]): PublicSocket =>
  new WebSocket(url, protocols);

export const createPublicDocumentProvider = (
  suppliedSession: PublicDocumentBrowserSession,
  dependencies: PublicDocumentProviderDependencies = { createSocket: defaultCreateSocket },
): PublicDocumentProvider => {
  const session = Object.freeze({
    authorization: Object.freeze({ ...suppliedSession.authorization }),
    actorId: suppliedSession.actorId,
    socketUrl: suppliedSession.socketUrl,
    socketProtocol: suppliedSession.socketProtocol,
  });
  let ticketProtocol = suppliedSession.ticketProtocol;
  if (
    !ROOM_ID.test(session.authorization.roomId) ||
    !ACTOR_ID.test(session.actorId) ||
    session.socketProtocol !== PUBLIC_SOCKET_PROTOCOL ||
    !PUBLIC_TICKET.test(ticketProtocol)
  ) {
    throw new Error('invalid-public-session');
  }

  const listeners = new Set<(snapshot: PublicDocumentProviderSnapshot) => void>();
  const doc = new Y.Doc();
  let snapshot: PublicDocumentProviderSnapshot = Object.freeze({
    phase: 'authorizing',
    projection: null,
  });
  let socket: PublicSocket | null = null;
  let readyFrame: PublicRoomReadyFrameV1 | null = null;
  let started = false;
  let settled = false;
  let destroyed = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let resolveStart: ((projection: PublicDocumentProjection) => void) | null = null;
  let rejectStart: ((error: Error) => void) | null = null;

  const emit = () => {
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch {
        // Observers cannot interrupt the authorization or terminal clearing boundary.
      }
    }
  };
  const publish = (next: PublicDocumentProviderSnapshot) => {
    snapshot = Object.freeze(next);
    emit();
  };
  const detach = () => {
    if (!socket) return;
    socket.removeEventListener('message', onMessage);
    socket.removeEventListener('close', onClose);
    socket.removeEventListener('error', onError);
  };
  const deny = () => {
    if (destroyed) return;
    if (timeout) clearTimeout(timeout);
    readyFrame = null;
    publish({ phase: 'unavailable', projection: null });
    const activeSocket = socket;
    detach();
    socket = null;
    activeSocket?.close(4403, 'public-document-unavailable');
    doc.destroy();
    if (!settled) {
      settled = true;
      rejectStart?.(new Error('public-document-unavailable'));
    }
    resolveStart = null;
    rejectStart = null;
  };
  const applyUpdateFrame = (value: Record<string, unknown>) => {
    if (
      !hasExactKeys(value, ['type', 'roomId', 'update']) ||
      value.type !== 'yjs-update' ||
      value.roomId !== session.authorization.roomId ||
      (!readyFrame && snapshot.phase !== 'ready')
    ) {
      deny();
      return;
    }
    try {
      Y.applyUpdate(doc, decodeUpdate(value.update));
      if (snapshot.phase === 'ready') {
        publish({
          phase: 'ready',
          mode: session.authorization.mode,
          projection: readProjection(doc),
        });
      }
    } catch {
      deny();
    }
  };
  function onMessage(event: Event) {
    if (destroyed || typeof (event as MessageEvent).data !== 'string') {
      deny();
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse((event as MessageEvent).data) as unknown;
    } catch {
      deny();
      return;
    }
    if (isPlainObject(value) && value.type === 'room-ready') {
      if (readyFrame || snapshot.phase !== 'authorizing') {
        deny();
        return;
      }
      readyFrame = parseReadyFrame(value, session);
      if (!readyFrame) {
        deny();
        return;
      }
      publish({ phase: 'hydrating', projection: null });
      return;
    }
    if (isPlainObject(value) && value.type === 'yjs-update') {
      applyUpdateFrame(value);
      return;
    }
    if (isPlainObject(value) && value.type === 'room-hydration-complete') {
      if (
        !readyFrame ||
        snapshot.phase !== 'hydrating' ||
        !parseCompletionFrame(value, readyFrame)
      ) {
        deny();
        return;
      }
      try {
        const projection = readProjection(doc);
        if (timeout) clearTimeout(timeout);
        publish({
          phase: 'ready',
          mode: session.authorization.mode,
          projection,
        });
        readyFrame = null;
        if (!settled) {
          settled = true;
          resolveStart?.(projection);
        }
        resolveStart = null;
        rejectStart = null;
      } catch {
        deny();
      }
      return;
    }
    deny();
  }
  function onClose() {
    deny();
  }
  function onError() {
    deny();
  }

  return Object.freeze({
    start() {
      if (started || destroyed) {
        return Promise.reject(new Error('public-document-unavailable'));
      }
      started = true;
      const promise = new Promise<PublicDocumentProjection>((resolve, reject) => {
        resolveStart = resolve;
        rejectStart = reject;
      });
      try {
        socket = dependencies.createSocket(session.socketUrl, [
          PUBLIC_SOCKET_PROTOCOL,
          ticketProtocol,
        ]);
        ticketProtocol = '';
        socket.addEventListener('message', onMessage);
        socket.addEventListener('close', onClose);
        socket.addEventListener('error', onError);
        timeout = setTimeout(deny, dependencies.hydrationTimeoutMs ?? DEFAULT_HYDRATION_TIMEOUT_MS);
      } catch {
        ticketProtocol = '';
        deny();
      }
      return promise;
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      try {
        listener(snapshot);
      } catch {
        // Immediate observer failure cannot change provider state.
      }
      return () => listeners.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (timeout) clearTimeout(timeout);
      const activeSocket = socket;
      detach();
      socket = null;
      activeSocket?.close(1000, 'public-reader-closed');
      doc.destroy();
      snapshot = Object.freeze({ phase: 'unavailable', projection: null });
      emit();
      if (!settled) {
        settled = true;
        rejectStart?.(new Error('public-document-unavailable'));
      }
      resolveStart = null;
      rejectStart = null;
    },
  });
};
