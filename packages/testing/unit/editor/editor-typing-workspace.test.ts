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
const documentId = 'typing-workspace';
const nativeShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const nativeCloseDialog = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
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
  for (const [method, descriptor] of [
    ['showModal', nativeShowModal],
    ['close', nativeCloseDialog],
  ] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, method, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, method);
  }
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
          { value: `/doc/${documentId}` },
          React.createElement(EditorWorkspace, { documentId }),
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

describe('editor workspace Share', () => {
  it('retries before dispatch and checks the original account route after a lost response', async () => {
    const dialogPrototype = HTMLDialogElement.prototype;
    dialogPrototype.showModal = function () {
      this.open = true;
    };
    dialogPrototype.close = function () {
      this.open = false;
    };

    const promotionPath = `/api/documents/${documentId}/promote`;
    const ownerSessionPath = `/api/documents/${documentId}/owner-session`;
    const markerKey = `lash:pending-promotion:v1:${documentId}`;
    const sourceBodyKey = `lash:body:${documentId}`;
    const submissions: Array<{ body: string; fail: (reason: Error) => void }> = [];
    let accountChecks = 0;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/account/session') {
        return new Response(null, {
          status: 204,
          headers: { 'x-lash-account-status': 'authenticated' },
        });
      }
      if (String(input) === promotionPath && init?.method === 'POST') {
        return new Promise<Response>((_resolve, fail) => {
          submissions.push({ body: String(init.body), fail });
        });
      }
      if (String(input) === ownerSessionPath && init?.method === 'POST') {
        accountChecks += 1;
        return Response.json(
          { version: 1, ok: false, error: 'document-unavailable', retryable: false },
          { status: 404 },
        );
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });

    const editor = await getReadyEditor();
    const setTitle = (value: string) => {
      const title = container.querySelector<HTMLInputElement>(
        '[data-testid="lash-doc-title-input"]',
      );
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(title, value);
      title?.dispatchEvent(new Event('input', { bubbles: true }));
    };
    await React.act(async () => {
      editor.commands.setContent('<p>Send the <strong>launch brief</strong>.</p>');
      setTitle('Launch brief');
    });

    const getDialog = () => container.querySelector<HTMLDialogElement>('dialog[open]');
    const action = (name: string) => {
      const button = Array.from(getDialog()?.querySelectorAll('button') ?? []).find(
        (candidate) =>
          candidate.textContent === name || candidate.getAttribute('aria-label') === name,
      );
      if (!button) throw new Error(`Expected a Share action labeled ${name}`);
      return button;
    };
    const waitForPhase = (phase: string) =>
      vi.waitFor(async () => {
        await React.act(async () => {});
        expect(getDialog()?.dataset.phase).toBe(phase);
      });
    const openShare = async (phase: string) => {
      await React.act(async () => findButton('topbar-share-button').click());
      await waitForPhase(phase);
    };
    const checkAccountCopy = async (expectedChecks: number) => {
      await React.act(async () => {
        action('Check account copy').click();
        await vi.waitFor(() => expect(accountChecks).toBe(expectedChecks));
      });
      await waitForPhase('device-draft');
      expect(getDialog()?.textContent).toContain('Lash couldn’t verify an account copy.');
      expect(submissions).toHaveLength(1);
    };

    const setItem = Storage.prototype.setItem;
    const failMarkerWrite = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key === markerKey) throw new DOMException('Marker unavailable', 'QuotaExceededError');
      setItem.call(this, key, value);
    });
    await openShare('ready');
    await React.act(async () => {
      action('Save to my account').click();
      await vi.waitFor(() =>
        expect(failMarkerWrite.mock.calls.some(([key]) => key === markerKey)).toBe(true),
      );
    });
    await waitForPhase('unavailable');
    expect(getDialog()?.textContent).toContain('Lash couldn’t verify the device draft.');
    expect(submissions).toHaveLength(0);
    expect(localStorage.getItem(markerKey)).toBeNull();

    failMarkerWrite.mockRestore();
    await React.act(async () => action('Close sharing').click());
    await openShare('ready');
    await React.act(async () => {
      action('Save to my account').click();
      await vi.waitFor(() => expect(submissions).toHaveLength(1));
    });
    expect(action('Saving to your account…').disabled).toBe(true);
    const submission = submissions[0]!;
    expect(JSON.parse(submission.body)).toMatchObject({
      idempotencyKey: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      snapshot: {
        title: 'Launch brief',
        body: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Send the ' },
                { type: 'text', marks: [{ type: 'bold' }], text: 'launch brief' },
                { type: 'text', text: '.' },
              ],
            },
          ],
        },
      },
    });
    const pendingMarker = localStorage.getItem(markerKey);
    expect(pendingMarker).toBeTruthy();
    await React.act(async () => submission.fail(new TypeError('Response unavailable')));
    await waitForPhase('device-draft');

    // An unchanged draft already has a potentially dispatched write.
    await checkAccountCopy(1);
    expect(editor.state.doc.textContent).toBe('Send the launch brief.');

    await React.act(async () => action('Close sharing').click());
    await React.act(async () => {
      editor.commands.setContent('<p>Keep this <strong>new local edit</strong>.</p>');
      setTitle('Later notes');
    });
    await openShare('device-draft');
    await checkAccountCopy(2);
    expect(editor.state.doc.textContent).toBe('Keep this new local edit.');
    const exactDeviceBody = editor.getJSON();
    await React.act(async () => {
      await vi.waitFor(() => {
        const raw = localStorage.getItem(sourceBodyKey);
        expect(raw && JSON.parse(raw).doc).toEqual(exactDeviceBody);
      });
    });
    const sourceBody = localStorage.getItem(sourceBodyKey);

    router.push.mockClear();
    await React.act(async () => action('Create separate device draft').click());
    await waitForPhase('device-copy-ready');
    expect(action('Open separate draft').disabled).toBe(false);
    const newPath = await vi.waitFor(() => {
      expect(router.push).toHaveBeenCalledTimes(1);
      return router.push.mock.lastCall?.[0] as string;
    });
    expect(newPath).toMatch(/^\/doc\/doc-/u);
    const copyId = newPath.split('/').at(-1);
    const copyBody = localStorage.getItem(`lash:body:${copyId}`);
    expect(copyBody && JSON.parse(copyBody).doc).toEqual(exactDeviceBody);
    expect(localStorage.getItem(`lash:title:${copyId}`)).toBe('Later notes');
    expect(localStorage.getItem(sourceBodyKey)).toBe(sourceBody);
    expect(localStorage.getItem(markerKey)).toBe(pendingMarker);
    expect(submissions).toHaveLength(1);
  });
});
