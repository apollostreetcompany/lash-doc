// @vitest-environment jsdom

import { createAnchor, type StoredChatThread } from '@lash/doc-chat';
import { createLashEditorExtensions } from '@lash/editor-core';
import { createDocumentId } from '@lash/types';
import { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ChatPanel,
  type ChatRealtimeStore,
} from '../../../../apps/web/components/editor/panels/ChatPanel';
import { RealtimeChatStore } from '../../../../apps/web/lib/realtimeChatStore';
import * as React from '../../../../apps/web/node_modules/react';
import { createRoot } from '../../../../apps/web/node_modules/react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.assign(globalThis, { React });

const docId = createDocumentId('fixture-document');
const editors: Editor[] = [];

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');

const createMemoryStorage = (): Storage => {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
};

const storedThread: StoredChatThread = {
  id: 'thread-local',
  docId,
  anchor: createAnchor({
    baseVersion: 'base-version',
    docText: 'Readable body',
    from: 0,
    to: 8,
  }),
  messages: [],
  filters: {},
  historyText: 'Readable body',
  status: 'open',
  resolvedAt: null,
  updatedAt: '2026-07-18T05:00:00.000Z',
};

const createEditor = ({
  currentText = 'Readable body',
  from = 1,
  to = 1,
}: {
  currentText?: string;
  from?: number;
  to?: number;
} = {}) => {
  const editor = new Editor({
    extensions: createLashEditorExtensions(),
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: currentText }] }],
    },
  });
  editors.push(editor);
  editor.commands.setTextSelection({ from, to });
  const getCommands = Object.getOwnPropertyDescriptor(Editor.prototype, 'commands')?.get;
  if (!getCommands) throw new Error('Missing editor commands');
  const focus = vi.fn(() => true);
  vi.spyOn(editor, 'commands', 'get').mockImplementation(() => ({
    ...(getCommands.call(editor) as Editor['commands']),
    focus,
  }));

  return { editor, focus };
};

describe('chat mutation authority UI', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: createMemoryStorage(),
    });
  });

  it('shows the permitted discussion after the projected selection changes', async () => {
    const threadId = 'd71465e1-0536-4b82-b42b-39fe8d535e3e';
    const updatedAt = '2026-11-18T15:00:00.000Z';
    const store = new RealtimeChatStore(vi.fn(() => false));
    store.receive({
      type: 'review-snapshot',
      threads: [{
        id: threadId, anchor: null, updatedAt, status: 'open', resolvedAt: null,
        messages: [{ id: 'message-1', threadId, ts: updatedAt, author: { type: 'user', id: 'owner' }, body: 'This reply is still available.' }],
      }],
    }, true);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await React.act(async () => {
        root.render(React.createElement(ChatPanel, {
          baseVersion: null,
          currentText: 'Updated writing',
          docId,
          editor: null,
          mutationEnabled: true,
          statusChangesEnabled: false,
          realtimeStore: store,
          runDocumentMutation: vi.fn(() => false),
        }));
      });
      const thread = container.querySelector('article[data-testid="chat-thread"]');
      expect(thread?.textContent).toContain('Discussion thread');
      expect(thread?.textContent).toContain('Selected text changed');
      expect(thread?.textContent).toContain('This reply is still available.');
      expect(thread?.querySelector('button, input, [data-testid="chat-context-grid"]')).toBeNull();
    } finally {
      await React.act(async () => root.unmount());
      store.dispose();
    }
  });

  afterEach(() => {
    while (editors.length) editors.pop()?.destroy();
    window.localStorage.clear();
    window.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
    if (originalLocalStorageDescriptor) {
      Object.defineProperty(window, 'localStorage', originalLocalStorageDescriptor);
    } else {
      Reflect.deleteProperty(window, 'localStorage');
    }
  });

  it('keeps read navigation visible without migrating or enabling thread mutations', async () => {
    window.localStorage.setItem(
      `lash:chat-threads:${String(docId)}`,
      JSON.stringify([storedThread]),
    );
    const submit = vi.fn<ChatRealtimeStore['submit']>(async () => ({ ok: true }));
    const runDocumentMutation = vi.fn((mutate: () => void) => {
      mutate();
      return true;
    });
    const realtimeStore: ChatRealtimeStore = {
      isReady: () => true,
      readThreads: () => [],
      subscribe: () => () => undefined,
      submit,
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await React.act(async () => {
      root.render(
        React.createElement(ChatPanel, {
          baseVersion: 'base-version',
          currentText: 'Readable body',
          docId,
          editor: null,
          mutationEnabled: false,
          mutationUnavailableReason:
            'Comment access is read-only in this runtime. Existing threads remain available to read and navigate.',
          realtimeStore,
          runDocumentMutation,
        }),
      );
    });

    expect(
      container.querySelector('[data-testid="chat-mutation-unavailable"]')?.textContent,
    ).toMatch(/Comment access is read-only/u);
    expect(
      (container.querySelector('[data-testid="chat-create-thread"]') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(container.querySelector('[data-testid="chat-selection-guide"]')).toBeNull();
    expect(container.querySelector('[data-testid="chat-select-document-text"]')).toBeNull();
    expect(submit).not.toHaveBeenCalled();
    expect(runDocumentMutation).not.toHaveBeenCalled();

    await React.act(async () => root.unmount());
  });

  it('guides an editable empty chat to a real editor through the document navigation seam', async () => {
    const { editor, focus } = createEditor();
    const requestDocumentNavigation = vi.fn<(navigateToTarget: () => void) => void>();
    const runDocumentMutation = vi.fn(() => true);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await React.act(async () => {
      root.render(
        React.createElement(ChatPanel, {
          baseVersion: 'base-version',
          currentText: 'Readable body',
          docId,
          editor,
          mutationEnabled: true,
          requestDocumentNavigation,
          runDocumentMutation,
        }),
      );
    });

    expect(container.querySelector('[data-testid="chat-selection-guide"]')?.textContent).toContain(
      'Select text in the document to start a comment.',
    );
    const recovery = container.querySelector<HTMLButtonElement>(
      '[data-testid="chat-select-document-text"]',
    );
    expect(recovery?.textContent).toBe('Select text in document');
    expect(recovery?.disabled).toBe(false);
    expect(container.querySelector('[data-testid="chat-create-thread"]')).toBeNull();
    expect(container.querySelector('[data-testid="chat-filter-author"]')).toBeNull();
    expect(container.querySelector('[data-testid="chat-filter-ai"]')).toBeNull();
    expect(container.querySelector('[data-testid="chat-filter-clear"]')).toBeNull();
    expect(container.querySelector('[data-testid="chat-empty"]')).toBeNull();

    await React.act(async () => recovery?.click());

    expect(requestDocumentNavigation).toHaveBeenCalledOnce();
    expect(focus).not.toHaveBeenCalledWith();
    expect(runDocumentMutation).not.toHaveBeenCalled();

    const navigateToDocument = requestDocumentNavigation.mock.calls[0]?.[0];
    expect(navigateToDocument).toBeTypeOf('function');
    navigateToDocument?.();

    expect(focus).toHaveBeenCalledWith();
    expect(runDocumentMutation).not.toHaveBeenCalled();

    await React.act(async () => root.unmount());
  });

  it('does not offer selection recovery without a usable editor', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await React.act(async () => {
      root.render(
        React.createElement(ChatPanel, {
          baseVersion: 'base-version',
          currentText: 'Readable body',
          docId,
          editor: null,
          mutationEnabled: true,
          runDocumentMutation: vi.fn(() => true),
        }),
      );
    });

    expect(container.querySelector('[data-testid="chat-selection-guide"]')).toBeNull();
    expect(container.querySelector('[data-testid="chat-select-document-text"]')).toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="chat-create-thread"]')?.disabled,
    ).toBe(true);

    await React.act(async () => root.unmount());
  });

  it('focuses the usable editor directly when no document navigation seam is provided', async () => {
    const { editor, focus } = createEditor();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await React.act(async () => {
      root.render(
        React.createElement(ChatPanel, {
          baseVersion: 'base-version',
          currentText: 'Readable body',
          docId,
          editor,
          mutationEnabled: true,
          runDocumentMutation: vi.fn(() => true),
        }),
      );
    });

    await React.act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="chat-select-document-text"]')
        ?.click(),
    );

    expect(focus).toHaveBeenCalledWith();

    await React.act(async () => root.unmount());
  });

  it('preserves selected-text comment creation while an empty chat keeps filters hidden', async () => {
    const currentText = 'Readable body';
    const { editor } = createEditor({ currentText, from: 1, to: 9 });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await React.act(async () => {
      root.render(
        React.createElement(ChatPanel, {
          baseVersion: 'base-version',
          currentText,
          docId,
          editor,
          mutationEnabled: true,
          runDocumentMutation: vi.fn(() => true),
        }),
      );
    });

    expect(container.querySelector('[data-testid="chat-selection-guide"]')).toBeNull();
    const addComment = container.querySelector<HTMLButtonElement>(
      '[data-testid="chat-create-thread"]',
    );
    expect(addComment?.disabled).toBe(false);
    expect(container.querySelector('[data-testid="chat-filter-author"]')).toBeNull();
    expect(container.querySelector('[data-testid="chat-filter-ai"]')).toBeNull();
    expect(container.querySelector('[data-testid="chat-filter-clear"]')).toBeNull();

    await React.act(async () => addComment?.click());

    expect(container.querySelector('[data-testid="chat-new-thread-composer"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="chat-new-thread-quote"]')?.textContent).toBe(
      'Readable',
    );

    await React.act(async () => root.unmount());
  });

  it('preserves every existing filter when real threads are present', async () => {
    window.localStorage.setItem(
      `lash:chat-threads:${String(docId)}`,
      JSON.stringify([storedThread]),
    );
    const { editor } = createEditor();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await React.act(async () => {
      root.render(
        React.createElement(ChatPanel, {
          baseVersion: 'base-version',
          currentText: 'Readable body',
          docId,
          editor,
          mutationEnabled: true,
          runDocumentMutation: vi.fn(() => true),
        }),
      );
    });

    expect(container.querySelector('[data-testid="chat-filter-author"]')?.textContent).toBe(
      'local-user',
    );
    expect(container.querySelector('[data-testid="chat-filter-ai"]')?.textContent).toBe('AI');
    expect(container.querySelector('[data-testid="chat-filter-clear"]')?.textContent).toBe('All');

    await React.act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="chat-filter-ai"]')?.click(),
    );

    expect(container.querySelectorAll('[data-testid="chat-thread"]')).toHaveLength(0);
    expect(container.querySelector('[data-testid="chat-filter-author"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="chat-filter-ai"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="chat-filter-clear"]')).not.toBeNull();

    await React.act(async () => root.unmount());
  });

  it('keeps canonical realtime thread context and navigation usable while every mutation stays disabled', async () => {
    const currentText = 'Readable body';
    const canonicalThreads: StoredChatThread[] = [
      {
        ...storedThread,
        id: 'thread-realtime-open',
      },
      {
        ...storedThread,
        id: 'thread-realtime-resolved',
        anchor: createAnchor({
          baseVersion: 'base-version',
          docText: currentText,
          from: 9,
          to: 13,
        }),
        status: 'resolved',
        resolvedAt: '2026-07-18T05:01:00.000Z',
        updatedAt: '2026-07-18T05:01:00.000Z',
      },
    ];
    const readThreads = vi.fn(() => canonicalThreads);
    const submit = vi.fn<ChatRealtimeStore['submit']>(async () => ({ ok: true }));
    const runDocumentMutation = vi.fn((mutate: () => void) => {
      mutate();
      return true;
    });
    const realtimeStore: ChatRealtimeStore = {
      isReady: () => true,
      readThreads,
      subscribe: () => () => undefined,
      submit,
    };
    const { editor } = createEditor({ currentText });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await React.act(async () => {
      root.render(
        React.createElement(ChatPanel, {
          baseVersion: 'base-version',
          currentText,
          docId,
          editor,
          mutationEnabled: false,
          mutationUnavailableReason:
            'Comment access is read-only in this runtime. Existing threads remain available to read and navigate.',
          realtimeStore,
          runDocumentMutation,
        }),
      );
    });

    expect(readThreads).toHaveBeenCalledWith(docId);
    expect(container.querySelector('[data-testid="chat-count"]')?.textContent).toContain(
      '2 threads',
    );
    expect(
      [...container.querySelectorAll('[data-testid="chat-anchor-text"]')].map(
        (element) => element.textContent,
      ),
    ).toEqual(['Readable', 'body']);
    expect(
      [...container.querySelectorAll('[data-testid="chat-current-context"]')].map(
        (element) => element.textContent,
      ),
    ).toEqual(['Readable', 'body']);

    const showButtons = [
      ...container.querySelectorAll<HTMLButtonElement>('[data-testid="chat-jump-anchor"]'),
    ];
    expect(showButtons).toHaveLength(2);
    expect(showButtons.every((button) => !button.disabled)).toBe(true);
    expect(showButtons[0]?.getAttribute('aria-label')).toBe(
      'Show document target for thread on Readable',
    );

    await React.act(async () => showButtons[0]?.click());

    expect({ from: editor.state.selection.from, to: editor.state.selection.to }).toEqual({
      from: 1,
      to: 9,
    });
    expect(container.querySelector('[data-testid="chat-anchor-jump-status"]')?.textContent).toBe(
      'Selected Readable in the document.',
    );

    const createButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="chat-create-thread"]',
    );
    const replyInputs = [
      ...container.querySelectorAll<HTMLInputElement>('[data-testid="chat-reply-input"]'),
    ];
    const replyButtons = [
      ...container.querySelectorAll<HTMLButtonElement>('[data-testid="chat-add-reply"]'),
    ];
    const resolveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="chat-resolve-thread"]',
    );
    const reopenButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="chat-reopen-thread"]',
    );
    const aiButtons = [
      ...container.querySelectorAll<HTMLButtonElement>('[data-testid="chat-add-ai"]'),
    ];

    expect(createButton?.disabled).toBe(true);
    expect(replyInputs).toHaveLength(2);
    expect(replyInputs.every((input) => input.disabled)).toBe(true);
    expect(replyButtons).toHaveLength(2);
    expect(replyButtons.every((button) => button.disabled)).toBe(true);
    expect(resolveButton?.disabled).toBe(true);
    expect(reopenButton?.disabled).toBe(true);
    expect(aiButtons).toHaveLength(0);
    expect(submit).not.toHaveBeenCalled();
    expect(runDocumentMutation).not.toHaveBeenCalled();

    await React.act(async () => root.unmount());
  });
});
