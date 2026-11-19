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
  type AnchoredCommentRequest,
  type ChatPanelProps,
  type ChatRealtimeStore,
} from '../../../../apps/web/components/editor/panels/ChatPanel';
import { RealtimeChatStore } from '../../../../apps/web/lib/realtimeChatStore';
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
  overrides?: Partial<ChatPanelProps>,
) => {
  editor.commands.setTextSelection(range);

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const requestDocumentNavigation = vi.fn((navigate: () => void) => navigate());

  const props: ChatPanelProps = {
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
    ...overrides,
  };
  const render = (updates: Partial<ChatPanelProps> = {}) =>
    React.act(async () => root.render(React.createElement(ChatPanel, { ...props, ...updates })));
  await render();
  const button = (testId: string) => {
    const result = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
    if (!result) throw new Error(`Missing ${testId}`);
    return result;
  };
  return { editor, container, button, render, requestDocumentNavigation };
};

const fillComment = async (container: HTMLElement, value: string) => {
  const input = container.querySelector<HTMLTextAreaElement>(
    '[data-testid="chat-new-thread-textarea"]',
  );
  if (!input) throw new Error('Missing comment composer');
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
      input,
      value,
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
};

const postComment = async (container: HTMLElement, create: HTMLButtonElement) => {
  await React.act(async () => create.click());
  const input = await fillComment(container, 'Please review this wording.');
  await React.act(async () => input.form?.requestSubmit());
};

const captureRequest = (editor: Editor, from: number, to: number): AnchoredCommentRequest =>
  Object.freeze({ editor, docId, document: editor.state.doc, from, to });

const observeEmailDrafts = () => {
  const drafts: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    drafts.push(this.href);
  });
  return drafts;
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
  Reflect.deleteProperty(navigator, 'clipboard');
  vi.restoreAllMocks();
});

describe('ChatPanel exact selection anchors', () => {
  it('opens the contextual request after the panel mounts and posts the captured duplicate', async () => {
    const editor = openEditor('<p>publish the beta or publish the beta</p>');
    const request = captureRequest(editor, 21, 37);
    const onAnchoredCommentRequestHandled = vi.fn();
    const { container, render } = await mountChat(editor, { from: 1, to: 17 }, undefined, {
      open: false,
      anchoredCommentRequest: request,
      onAnchoredCommentRequestHandled,
    });
    expect(onAnchoredCommentRequestHandled).not.toHaveBeenCalled();
    await render({ open: true });
    const input = await fillComment(container, 'Please review the second phrase.');
    expect(document.activeElement).toBe(input);
    expect(onAnchoredCommentRequestHandled).toHaveBeenCalledOnce();
    expect(onAnchoredCommentRequestHandled).toHaveBeenCalledWith(request);
    expect(input.form?.querySelector('blockquote')?.textContent).toBe('publish the beta');
    await React.act(async () => input.form?.requestSubmit());
    const saved = JSON.parse(window.localStorage.getItem(`lash:chat-threads:${docId}`) ?? '[]');
    expect(saved[0]?.anchor).toMatchObject({ from: 20, to: 36 });
  });

  it('refuses a contextual request after the document changes even if the quote still exists', async () => {
    const editor = openEditor('<p>publish the beta or publish the beta</p>');
    const request = captureRequest(editor, 21, 37);
    editor.commands.insertContentAt(1, 'Draft: ');
    const { container } = await mountChat(editor, { from: 1, to: 3 }, undefined, {
      anchoredCommentRequest: request,
    });
    expect(container.querySelector('[data-testid="chat-new-thread-composer"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Select the text again',
    );
  });

  it.each([true, false])(
    'opens a recipient-free draft and offers the same copy when clipboard permission is %s',
    async (clipboardAllowed) => {
      const quote = 'beta &bcc=someone@example.test';
      const quoteTail = 'Second line.';
      const comment = 'Please review?\nRevised copy #2.';
      const editor = openEditor(`<p>${quote}</p><p>${quoteTail}</p><p>Private context</p>`);
      const { container, button } = await mountChat(editor, {
        from: 1,
        to: quote.length + quoteTail.length + 3,
      });
      const writeText = vi.fn(async (_text: string) => {
        if (!clipboardAllowed) throw new DOMException('Permission denied', 'NotAllowedError');
      });
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

      const emails = observeEmailDrafts();
      await React.act(async () => button('chat-create-thread').click());
      const email = button('chat-open-email-draft');
      expect(email.disabled).toBe(true);
      const input = await fillComment(container, comment);
      expect(emails).toEqual([]);
      expect(container.querySelector('[data-testid="chat-copy-email-draft"]')).toBeNull();
      await React.act(async () => email.click());
      const expectedBody = `> ${quote}\r\n> ${quoteTail}\r\n\r\nPlease review?\r\nRevised copy #2.`;
      expect(emails).toEqual([
        `mailto:?subject=Comment%20on%20a%20passage&body=${encodeURIComponent(expectedBody)}`,
      ]);
      expect(writeText).not.toHaveBeenCalled();

      await React.act(async () => button('chat-copy-email-draft').click());
      expect(writeText).toHaveBeenCalledOnce();
      expect(writeText).toHaveBeenCalledWith(expectedBody);
      const manualCopy = container.querySelector<HTMLTextAreaElement>(
        '[aria-label="Quote and comment to copy"]',
      );
      if (clipboardAllowed) {
        expect(manualCopy).toBeNull();
      } else {
        expect(manualCopy?.value).toBe(expectedBody.replace(/\r\n/gu, '\n'));
        expect(manualCopy?.readOnly).toBe(true);
        expect(manualCopy?.selectionEnd).toBe(manualCopy?.value.length);
        expect(document.activeElement).toBe(manualCopy);
      }
      expect(input.value).toBe(comment);
      expect(window.localStorage.getItem(`lash:chat-threads:${docId}`)).toBeNull();
    },
  );

  it('preserves an oversized shared draft and surfaces the existing client validation', async () => {
    const editor = openEditor(undefined, openRoom());
    editor.commands.insertContent('alpha');
    const send = vi.fn(() => true);
    const store = new RealtimeChatStore(send);
    store.receive({ type: 'review-snapshot', operations: [] });
    const { container, button } = await mountChat(editor, { from: 1, to: 6 }, store);
    await React.act(async () => button('chat-create-thread').click());
    const comment = 'a'.repeat(5_000);
    const input = await fillComment(container, comment);
    await React.act(async () => input.form?.requestSubmit());
    expect(send).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Shorten it');
    expect(input.value).toBe(comment);
  });

  it('preserves a reviewer draft through a new selection, lost authority and a disconnect race', async () => {
    const editor = openEditor(undefined, openRoom());
    editor.commands.insertContent('alpha or omega');
    editor.setEditable(false);
    const request = captureRequest(editor, 1, 6);
    let ready = true;
    const submit = vi.fn<ChatRealtimeStore['submit']>(async () => ({ ok: true }));
    const store: ChatRealtimeStore = {
      isReady: () => ready,
      readThreads: () => [],
      subscribe: () => () => undefined,
      submit,
    };
    const { container, button, render } = await mountChat(editor, { from: 10, to: 15 }, store, {
      anchoredCommentRequest: request,
    });
    const input = await fillComment(container, 'Please review this.');
    await render({
      anchoredCommentRequest: captureRequest(editor, 10, 15),
      mutationEnabled: false,
    });
    expect(input.value).toBe('Please review this.');
    expect(input.form?.querySelector('blockquote')?.textContent).toBe('alpha');
    expect(button('chat-open-email-draft').disabled).toBe(true);
    expect(button('chat-post-thread').disabled).toBe(true);
    await render({ anchoredCommentRequest: null });
    const emails = observeEmailDrafts();
    await React.act(async () => button('chat-open-email-draft').click());
    expect(emails).toHaveLength(1);
    ready = false;
    await React.act(async () => button('chat-open-email-draft').click());
    await React.act(async () => input.form?.requestSubmit());
    expect(emails).toHaveLength(1);
    expect(submit).not.toHaveBeenCalled();
    expect(input.value).toBe('Please review this.');
  });

  it('keeps the draft but does not post or email after the anchored shared text changes', async () => {
    const editor = openEditor(undefined, openRoom());
    editor.commands.insertContent('alpha');
    const request = captureRequest(editor, 1, 6);
    const submit = vi.fn<ChatRealtimeStore['submit']>(async () => ({ ok: true }));
    const { container, button } = await mountChat(
      editor,
      { from: 1, to: 6 },
      {
        isReady: () => true,
        readThreads: () => [],
        subscribe: () => () => undefined,
        submit,
      },
      { anchoredCommentRequest: request },
    );
    const input = await fillComment(container, 'Please review this.');
    const emails = observeEmailDrafts();
    editor.commands.deleteRange({ from: 1, to: 6 });
    await React.act(async () => button('chat-open-email-draft').click());
    await React.act(async () => input.form?.requestSubmit());
    expect(submit).not.toHaveBeenCalled();
    expect(emails).toEqual([]);
    expect(input.value).toBe('Please review this.');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Select the text again',
    );
  });

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
