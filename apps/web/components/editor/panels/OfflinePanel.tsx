/** panels/OfflinePanel — local offline queue and presence status. */
'use client';

import { createLocalCollabRoom } from '@lash/collab-service';
import { createDocumentId, type EditorOp } from '@lash/types';
import type { Editor } from '@tiptap/core';
import { useEffect, useMemo, useRef, useState } from 'react';

export interface OfflinePanelProps {
  editor: Editor | null;
  documentId: string;
}

const actor = { type: 'user', id: 'local-user' } as const;

const editorText = (editor: Editor) => editor.getText({ blockSeparator: '\n' });

const textReplaceOp = (before: string, after: string): EditorOp => {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    op: 'replace_text',
    from: prefix,
    to: before.length - suffix,
    text: after.slice(prefix, after.length - suffix),
  };
};

const applyTextOp = (text: string, op: EditorOp) => {
  if (op.op !== 'replace_text') return text;
  return `${text.slice(0, op.from)}${op.text}${text.slice(op.to)}`;
};

export function OfflinePanel({ editor, documentId }: OfflinePanelProps) {
  const room = useMemo(
    () =>
      createLocalCollabRoom({
        docId: createDocumentId(documentId),
        actor,
        wsEndpoint: 'local://lash-web',
      }),
    [documentId],
  );
  const [online, setOnline] = useState(room.isOnline());
  const [queueDepth, setQueueDepth] = useState(room.getQueueDepth());
  const [serverText, setServerText] = useState('');
  const [presence, setPresence] = useState<'online' | 'offline'>('online');
  const lastTextRef = useRef('');
  const serverTextRef = useRef('');

  useEffect(() => {
    const offQueue = room.onQueue(setQueueDepth);
    const offPresence = room.onPresence((peers) => {
      setPresence(peers[0]?.connection === 'offline' ? 'offline' : 'online');
    });
    const offUpdates = room.onYjsUpdate((update) => {
      const next = room
        .toEditorOps(update)
        .reduce((text, op) => applyTextOp(text, op), serverTextRef.current);
      serverTextRef.current = next;
      setServerText(next);
    });
    return () => {
      offQueue();
      offPresence();
      offUpdates();
      void room.close();
    };
  }, [room]);

  useEffect(() => {
    if (!editor) return;
    lastTextRef.current = editorText(editor);

    const publishEdit = () => {
      const before = lastTextRef.current;
      const after = editorText(editor);
      if (before !== after) {
        room.applyYjsUpdate(room.fromEditorOps([textReplaceOp(before, after)]), 'local-editor');
        lastTextRef.current = after;
      }
      const selection = editor.state.selection;
      room.setLocalPresence({ cursor: { from: selection.from, to: selection.to } });
    };

    editor.on('transaction', publishEdit);
    editor.on('selectionUpdate', publishEdit);
    return () => {
      editor.off('transaction', publishEdit);
      editor.off('selectionUpdate', publishEdit);
    };
  }, [editor, room]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const api = {
      setOnline: async (nextOnline: boolean) => {
        room.setOnline(nextOnline);
        setOnline(room.isOnline());
        if (nextOnline) await room.flushQueue();
      },
      getQueueDepth: () => room.getQueueDepth(),
      getServerText: () => serverTextRef.current,
      getPresence: () => presence,
    };
    (window as Window & { __lashOffline?: typeof api }).__lashOffline = api;
    return () => {
      delete (window as Window & { __lashOffline?: typeof api }).__lashOffline;
    };
  }, [presence, room]);

  const handleSetOnline = async (nextOnline: boolean) => {
    room.setOnline(nextOnline);
    setOnline(room.isOnline());
    if (nextOnline) await room.flushQueue();
  };

  return (
    <section className="lash-offline-panel" data-testid="offline-panel" aria-label="Offline status">
      <div className="offline-status-row">
        <span data-testid="offline-status">{online ? 'Online' : 'Offline'}</span>
        <span data-testid="offline-queue-depth">Queue: {queueDepth}</span>
        <span data-testid="presence-status">
          {presence === 'online' ? 'Presence active' : 'Presence paused'}
        </span>
      </div>
      <div className="offline-actions">
        <button
          type="button"
          className="offline-action"
          data-testid="offline-disconnect"
          onClick={() => void handleSetOnline(false)}
        >
          Disconnect
        </button>
        <button
          type="button"
          className="offline-action"
          data-testid="offline-reconnect"
          onClick={() => void handleSetOnline(true)}
        >
          Reconnect
        </button>
      </div>
      <span data-testid="offline-merge-status">Merged: {serverText || 'none'}</span>
    </section>
  );
}
