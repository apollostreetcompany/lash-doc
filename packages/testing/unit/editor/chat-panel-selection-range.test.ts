/** @vitest-environment jsdom */

import { createLashEditorExtensions } from '@lash/editor-core';
import { createDocumentId } from '@lash/types';
import { Editor, type JSONContent } from '@tiptap/core';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import {
  captureChatAnchorRange,
  projectChatDocumentText,
  resolveChatAnchorRange,
} from '../../../../apps/web/components/editor/panels/chatAnchorPositions';
import {
  ChatPanel,
  type ChatRealtimeStore,
} from '../../../../apps/web/components/editor/panels/ChatPanel';
import * as React from '../../../../apps/web/node_modules/react';
import { createRoot, type Root } from '../../../../apps/web/node_modules/react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.assign(globalThis, { React });

const docId = createDocumentId('chat-selection-range');
const roots: Root[] = [];
const editors: Editor[] = [];
const rooms: Y.Doc[] = [];

beforeAll(() => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

afterAll(() => {
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

const openEditor = (content?: string | JSONContent, room?: Y.Doc) => {
  const editor = new Editor({
    content,
    extensions: createLashEditorExtensions({
      collaboration: room ? { document: room, field: 'body' } : undefined,
    }),
  });
  editors.push(editor);
  return editor;
};

const openRoom = (update?: Uint8Array) => {
  const room = new Y.Doc();
  rooms.push(room);
  if (update) Y.applyUpdate(room, update);
  return room;
};

const mountChat = async (
  editor: Editor,
  range: { from: number; to: number },
  realtimeStore?: ChatRealtimeStore,
) => {
  editor.commands.setTextSelection(range);

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const requestDocumentNavigation = vi.fn((navigate: () => void) => navigate());

  await React.act(async () => {
    root.render(
      React.createElement(ChatPanel, {
        editor,
        docId,
        baseVersion: realtimeStore ? null : 'base-version',
        currentText: editor.getText({ blockSeparator: '\n' }),
        mutationEnabled: true,
        realtimeStore,
        requestDocumentNavigation,
        runDocumentMutation: (mutate) => {
          mutate();
          return true;
        },
      }),
    );
  });
  const button = (testId: string) => {
    const result = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
    if (!result) throw new Error(`Missing ${testId}`);
    return result;
  };
  return { editor, container, button, requestDocumentNavigation };
};

const postComment = async (container: HTMLElement, create: HTMLButtonElement) => {
  await React.act(async () => create.click());
  const input = container.querySelector<HTMLTextAreaElement>(
    '[data-testid="chat-new-thread-textarea"]',
  );
  if (!input) throw new Error('Missing comment composer');
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
      input,
      'Please review this wording.',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await React.act(async () => input.form?.requestSubmit());
};

afterEach(async () => {
  while (roots.length) {
    const root = roots.pop();
    await React.act(async () => root?.unmount());
  }
  while (editors.length) editors.pop()?.destroy();
  while (rooms.length) rooms.pop()?.destroy();
  window.localStorage.removeItem(`lash:chat-threads:${docId}`);
  document.body.replaceChildren();
});

describe('ChatPanel exact selection anchors', () => {
  it.each([
    {
      document: '<p>publish the beta or <strong>publish the beta</strong></p>',
      range: { from: 21, to: 37 },
      offset: 20,
    },
    {
      document: '<p>publish the beta</p><ul><li><p>publish the beta</p></li></ul>',
      range: { from: 21, to: 37 },
      offset: 19,
    },
    {
      document: '<p>aaaa</p>',
      range: { from: 2, to: 4 },
      offset: 1,
    },
  ])(
    'posts and jumps to the selected occurrence at offset $offset',
    async ({ document, range, offset }) => {
      const { editor, container, button, requestDocumentNavigation } = await mountChat(
        openEditor(document),
        range,
      );
      const quote = editor.state.doc.textBetween(range.from, range.to);
      expect(quote).toBe(offset === 1 ? 'aa' : 'publish the beta');

      await postComment(container, button('chat-create-thread'));

      const saved = JSON.parse(window.localStorage.getItem(`lash:chat-threads:${docId}`) ?? '[]');
      expect(saved[0]?.anchor).toMatchObject({ from: offset, to: offset + quote.length });

      editor.commands.setTextSelection(1);
      await React.act(async () => button('chat-jump-anchor').click());

      expect(requestDocumentNavigation).toHaveBeenCalledOnce();
      expect({ from: editor.state.selection.from, to: editor.state.selection.to }).toEqual(range);
    },
  );

  it('maps text spanning inline mentions and structural separators with the editor serializer', () => {
    const editor = openEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { kind: 'user', refId: 'ada', display: 'Ada' } },
            { type: 'text', text: ' says hi' },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second line' }] },
      ],
    });
    const projection = projectChatDocumentText(editor);
    const range = { from: 1, to: 19 };
    const textRange = projection.toTextRange(range);
    expect(projection.text).toBe(editor.getText({ blockSeparator: '\n' }));
    expect(textRange && projection.text.slice(textRange.from, textRange.to)).toBe(
      '@Ada says hi\nSecond ',
    );
    expect(textRange && projection.toEditorRange(textRange)).toEqual(range);
  });

  it('submits a current shared anchor without needing or copying local history', async () => {
    const editor = openEditor(undefined, openRoom());
    editor.commands.insertContent('publish the beta or publish the beta');
    const range = { from: 21, to: 37 };
    const submit = vi.fn<ChatRealtimeStore['submit']>(async () => ({ ok: true }));
    const { container, button } = await mountChat(editor, range, {
      isReady: () => true,
      readThreads: () => [],
      subscribe: () => () => undefined,
      submit,
    });
    const createButton = button('chat-create-thread');
    expect(createButton.disabled).toBe(false);
    await postComment(container, createButton);
    const operation = submit.mock.calls[0]?.[0];
    expect(operation).toMatchObject({
      type: 'create',
      body: 'Please review this wording.',
      anchor: { baseVersion: null, from: 20, to: 36 },
    });
    expect(operation).not.toHaveProperty('historyText');
    const relativeRange = operation?.type === 'create' && operation.anchor.relativeRange;
    expect(relativeRange && resolveChatAnchorRange(editor, relativeRange)).toEqual(range);
  });

  it('keeps a collaborative anchor on the original CRDT characters across edits and reload', () => {
    const room = openRoom();
    const writer = openEditor(undefined, room);
    writer.commands.insertContent('first publish the beta');
    const anchor = captureChatAnchorRange(writer, { from: 7, to: 23 });
    expect(anchor).not.toBeNull();
    if (!anchor) throw new Error('Missing collaborative anchor');

    const peerRoom = openRoom(Y.encodeStateAsUpdate(room));
    const peer = openEditor(undefined, peerRoom);
    const serializedAnchor = JSON.parse(JSON.stringify(anchor)) as typeof anchor;
    expect(resolveChatAnchorRange(peer, serializedAnchor)).toEqual({ from: 7, to: 23 });

    peer.commands.insertContentAt(7, 'new publish the beta / ');
    peer.commands.insertContentAt(46, ' tomorrow');
    Y.applyUpdate(room, Y.encodeStateAsUpdate(peerRoom));

    const reloaded = openEditor(undefined, openRoom(Y.encodeStateAsUpdate(room)));
    for (const editor of [peer, writer, reloaded]) {
      const range = resolveChatAnchorRange(editor, serializedAnchor);
      expect(range).toEqual({ from: 30, to: 46 });
      const projected = projectChatDocumentText(editor);
      expect(projected.text).toBe('first new publish the beta / publish the beta tomorrow');
      expect(range && projected.toTextRange(range)).toEqual({ from: 29, to: 45 });
    }

    peer.commands.deleteRange({ from: 30, to: 46 });
    Y.applyUpdate(room, Y.encodeStateAsUpdate(peerRoom));
    expect(resolveChatAnchorRange(writer, serializedAnchor)).toBeNull();
    expect(writer.getText()).toContain('publish the beta');
  });
});
