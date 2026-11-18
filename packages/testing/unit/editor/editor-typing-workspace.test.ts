/** @vitest-environment jsdom */

import type { Editor } from '@tiptap/core';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EditorWorkspace } from '../../../../apps/web/components/editor/EditorWorkspace';
import { AppRouterContext } from '../../../../apps/web/node_modules/next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext } from '../../../../apps/web/node_modules/next/dist/shared/lib/hooks-client-context.shared-runtime';
import * as React from '../../../../apps/web/node_modules/react';
import { createRoot, type Root } from '../../../../apps/web/node_modules/react-dom/client';

vi.mock('../../../../apps/web/lib/localDocumentHistoryPersistence', () => ({
  createLocalDocumentHistoryPersistence: () => ({
    read: async () => ({ primaryRaw: null, backupRaw: null }),
  }),
}));

const router = {
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
};

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const testWindow = window as Window & { __lashEditor?: Editor };
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  Object.defineProperties(Range.prototype, {
    getClientRects: { value: () => [], configurable: true },
    getBoundingClientRect: { value: () => new DOMRect(), configurable: true },
  });
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  Reflect.deleteProperty(Range.prototype, 'getClientRects');
  Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  container.remove();
});

function findButton(testId: string) {
  const button = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (!button) throw new Error(`Expected the ${testId} button`);
  return button;
}

function holdAnimationFrames() {
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.delete(id);
  });
  return async () => {
    const callbacks = [...frames.values()];
    expect(callbacks.length).toBeGreaterThan(0);
    frames.clear();
    await React.act(async () => callbacks.forEach((callback) => callback(0)));
  };
}

async function getReadyEditor() {
  await React.act(async () => {
    root.render(
      React.createElement(
        AppRouterContext.Provider,
        { value: router },
        React.createElement(
          PathnameContext.Provider,
          { value: '/doc/typing-workspace' },
          React.createElement(EditorWorkspace, { documentId: 'typing-workspace' }),
        ),
      ),
    );
  });
  await vi.waitFor(async () => {
    await React.act(async () => {});
    expect(testWindow.__lashEditor?.isEditable, container.textContent ?? undefined).toBe(true);
  });
  expect(findButton('toolbar-btn-bold').disabled).toBe(false);
  return testWindow.__lashEditor!;
}

describe('editor workspace typing', () => {
  it('does not serialize the document on ordinary typing while Discussion is closed', async () => {
    const editor = await getReadyEditor();
    expect(container.querySelector('[data-testid="doc-chat-panel"]')).toBeNull();
    const serialize = vi.spyOn(editor, 'getText');

    for (const letter of 'draft') {
      await React.act(async () => {
        editor.commands.insertContent(letter);
      });
    }

    expect(editor.state.doc.textContent).toBe('draft');
    expect(serialize).not.toHaveBeenCalled();
  });

  it('focuses the untouched editor when its startup frame runs', async () => {
    const paint = holdAnimationFrames();
    const editor = await getReadyEditor();
    expect(document.activeElement).toBe(document.body);

    await paint();

    expect(document.activeElement).toBe(editor.view.dom);
  });

  it('updates active formatting and the open comment control on selection-only transactions', async () => {
    const paint = holdAnimationFrames();
    const editor = await getReadyEditor();
    await React.act(async () => {
      editor.commands.setContent('<p>Plain <strong>bold</strong></p>');
      editor.commands.setTextSelection(2);
      findButton('topbar-discussion-button').click();
    });
    expect(document.activeElement).toBe(document.body);
    await paint();

    expect(findButton('toolbar-btn-bold').getAttribute('aria-pressed')).toBe('false');
    expect(editor.state.selection.from).toBe(2);
    expect(document.activeElement).toBe(document.body);
    expect(findButton('chat-select-document-text')).toBeTruthy();

    await React.act(async () => {
      editor.commands.setTextSelection({ from: 7, to: 11 });
    });

    expect(findButton('toolbar-btn-bold').getAttribute('aria-pressed')).toBe('true');
    expect(findButton('chat-create-thread').disabled).toBe(false);

    await React.act(async () => {
      editor.commands.insertContentAt({ from: 7, to: 11 }, 'fresh');
      editor.commands.setTextSelection({ from: 7, to: 12 });
    });
    await React.act(async () => findButton('chat-create-thread').click());
    expect(container.querySelector('[data-testid="chat-new-thread-quote"]')?.textContent).toBe(
      'fresh',
    );
  });
});
