/** @vitest-environment jsdom */

import { createLashEditorExtensions, selectTableCells } from '@lash/editor-core';
import { createDocumentId } from '@lash/types';
import { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AIPanel } from '../../../../apps/web/components/editor/panels/AIPanel';
import { SelectionActions } from '../../../../apps/web/components/editor/SelectionActions';
import * as React from '../../../../apps/web/node_modules/react';
import { createRoot, type Root } from '../../../../apps/web/node_modules/react-dom/client';

let editor: Editor;
let paper: HTMLElement;
let editorHost: HTMLDivElement;
let root: Root;
let title: HTMLInputElement;

beforeEach(() => {
  vi.stubGlobal('React', React);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(pointer: coarse)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(340, 160, 24, 24),
  });
  paper = document.createElement('article');
  paper.className = 'lash-doc-paper';
  vi.spyOn(paper, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, 600));
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(paper);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(46);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(110);
  title = document.createElement('input');
  editorHost = document.createElement('div');
  const actionsHost = document.createElement('div');
  paper.append(title, editorHost, actionsHost);
  document.body.append(paper);
  root = createRoot(actionsHost);
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  editor?.destroy();
  paper.remove();
  Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mountActions(
  editable = false,
  content = '<p>First line</p><p><strong>Second line</strong></p>',
  panelOpen?: boolean,
) {
  editor = new Editor({
    element: editorHost,
    extensions: createLashEditorExtensions(),
    content,
    editable,
  });
  const onComment = vi.fn();
  const onRevise = vi.fn();
  const renderPanel = async (open?: boolean) =>
    React.act(async () =>
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(SelectionActions, { editor, onComment, onRevise }),
          open !== undefined &&
            React.createElement(AIPanel, {
              editor,
              docId: createDocumentId('writing-model-readiness'),
              baseVersion: 'base-version',
              currentText: editor.getText(),
              schemaVersion: '1',
              open,
              onApplyPatch: async () => ({ ok: true as const }),
            }),
        ),
      ),
    );
  await renderPanel(panelOpen);
  return { onComment, onRevise, renderPanel };
}

async function select(start: Node, from: number, end: Node, to: number) {
  await React.act(async () => {
    const range = document.createRange();
    range.setStart(start, from);
    range.setEnd(end, to);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
}

function commentButton() {
  return [...paper.querySelectorAll('button')].find((button) => button.textContent === 'Comment');
}

describe('shared writing model readiness', () => {
  async function mountWithSelectedText(panelOpen = true) {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('pointer: fine'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const { renderPanel } = await mountActions(true, '<p>First line</p>', panelOpen);
    await React.act(async () => editor.commands.setTextSelection({ from: 1, to: 6 }));
    const text = editor.view.dom.querySelector('p')!.firstChild!;
    await select(text, 0, text, 5);
    return renderPanel;
  }

  function improveButton() {
    return paper.querySelector<HTMLButtonElement>('[data-testid="ai-improve-button"]');
  }

  it('recovers in the open panel and selection toolbar when the browser responds past the deadline', async () => {
    let finishProbe!: (result: string) => void;
    const pending = new Promise<string>((resolve) => {
      finishProbe = resolve;
    });
    const availability = vi.fn(() => pending);
    const create = vi.fn();
    vi.stubGlobal('LanguageModel', { availability, create });
    await mountWithSelectedText();

    await React.act(async () => vi.advanceTimersByTimeAsync(8000));
    expect(paper.textContent).toContain('on-device model didn’t respond');
    expect(paper.textContent).not.toContain('Revise selection');
    expect(improveButton()).toBeNull();

    await React.act(async () => finishProbe('available'));
    expect(paper.textContent).toContain('Revise selection');
    expect(paper.textContent).not.toContain('Check again');
    expect(improveButton()?.disabled).toBe(false);
    expect(availability).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });

  it('checks again for both surfaces and ignores results from the older check', async () => {
    let finishFirst!: (result: string) => void;
    let finishRetry!: (result: string) => void;
    const first = new Promise<string>((resolve) => {
      finishFirst = resolve;
    });
    const retry = new Promise<string>((resolve) => {
      finishRetry = resolve;
    });
    const availability = vi.fn(() => first);
    vi.stubGlobal('LanguageModel', { availability });
    await mountWithSelectedText();

    await React.act(async () => vi.advanceTimersByTimeAsync(8000));
    const checkAgain = [...paper.querySelectorAll('button')].find(
      (button) => button.textContent === 'Check again',
    );
    expect(checkAgain).toBeDefined();
    availability.mockImplementation(() => retry);
    await React.act(async () => checkAgain?.click());
    expect(paper.textContent).toContain('Checking for an on-device model');

    await React.act(async () => finishFirst('available'));
    expect(paper.textContent).toContain('Checking for an on-device model');
    expect(paper.textContent).not.toContain('Revise selection');
    expect(improveButton()).toBeNull();

    await React.act(async () => finishRetry('downloadable'));
    expect(paper.textContent).toContain('Revise selection');
    expect(improveButton()?.disabled).toBe(false);
    expect(availability).toHaveBeenCalledTimes(2);
  });

  it('rechecks a failed toolbar probe when the writer opens the panel', async () => {
    const availability = vi.fn<[], Promise<string>>();
    availability.mockRejectedValueOnce(new Error('Browser unavailable'));
    availability.mockResolvedValueOnce('available');
    vi.stubGlobal('LanguageModel', { availability });
    const renderPanel = await mountWithSelectedText(false);
    expect(paper.textContent).not.toContain('Revise selection');
    expect(availability).toHaveBeenCalledOnce();

    await renderPanel(true);

    expect(paper.textContent).toContain('Revise selection');
    expect(improveButton()?.disabled).toBe(false);
    expect(availability).toHaveBeenCalledTimes(2);
  });
});

it('requires fresh model availability when revision becomes eligible again', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('pointer: fine'),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  let finishProbe!: (result: string) => void;
  const availability = vi
    .fn()
    .mockResolvedValueOnce('available')
    .mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishProbe = resolve;
        }),
    );
  vi.stubGlobal('LanguageModel', { availability });
  const { onComment, onRevise } = await mountActions(true);
  await React.act(async () => {
    editor.commands.setTextSelection({ from: 1, to: 6 });
  });
  const text = editor.view.dom.querySelector('p')!.firstChild!;
  await select(text, 0, text, 5);
  expect(paper.textContent).toContain('Revise selection');
  await React.act(async () =>
    root.render(React.createElement(SelectionActions, { editor, onComment })),
  );
  await React.act(async () =>
    root.render(React.createElement(SelectionActions, { editor, onComment, onRevise })),
  );
  expect(availability).toHaveBeenCalledTimes(2);
  expect(commentButton()).toBeDefined();
  expect(paper.textContent).not.toContain('Revise selection');
  await React.act(async () => finishProbe('unavailable'));
  expect(paper.textContent).not.toContain('Revise selection');
});

describe('native selection actions', () => {
  it('does not read the browser selection while dispatching an editable cell selection', async () => {
    await mountActions(
      true,
      '<table><tbody><tr><td><p>Name</p></td><td><p>Status</p></td></tr></tbody></table>',
    );
    const readNativeCollapse = vi.spyOn(Selection.prototype, 'isCollapsed', 'get');

    await React.act(async () => {
      expect(selectTableCells(editor, 0, 1, 0, 1, { scrollIntoView: false })).toBe(true);
      expect(readNativeCollapse).not.toHaveBeenCalled();
    });
    expect(commentButton()).toBeUndefined();
  });

  it('avoids reading browser selection during plain typing and still offers native ranges ahead of the model', async () => {
    await mountActions(true);
    const readNativeCollapse = vi.spyOn(Selection.prototype, 'isCollapsed', 'get');

    await React.act(async () => {
      editor.view.dispatch(editor.state.tr.insertText('New '));
      expect(readNativeCollapse).not.toHaveBeenCalled();
    });
    expect(editor.state.selection.empty).toBe(true);
    expect(commentButton()).toBeUndefined();

    const text = editor.view.dom.querySelector('p')!.firstChild!;
    await select(text, 0, text, 3);
    expect(editor.state.selection.empty).toBe(true);
    expect(commentButton()).toBeDefined();
  });

  it('offers a bounded touch Comment action to a read-only reviewer across text blocks', async () => {
    const { onComment, onRevise } = await mountActions();
    const [first, second] = editor.view.dom.querySelectorAll('p');
    title.focus();
    expect(commentButton()).toBeUndefined();

    await select(first.firstChild!, 6, second.querySelector('strong')!.firstChild!, 6);

    const comment = commentButton();
    expect(comment).toBeDefined();
    expect(document.activeElement).toBe(title);
    expect(onComment).not.toHaveBeenCalled();
    expect(paper.textContent).not.toContain('Revise selection');
    expect(comment?.parentElement?.style.left).toBe('272px');
    expect(comment?.parentElement?.style.top).toBe('208px');
    expect(comment?.parentElement?.style.visibility).toBe('visible');
    expect(document.getSelection()?.toString()).toBe('lineSecond');

    await React.act(async () => comment?.click());

    const [range] = onComment.mock.calls.at(0) ?? [];
    expect(editor.state.doc.textBetween(range.from, range.to, '\n')).toBe('line\nSecond');
    expect(onRevise).not.toHaveBeenCalled();
  });

  it('keeps a selection for keyboard activation when moving focus clears the browser highlight', async () => {
    const { onComment } = await mountActions();
    const text = editor.view.dom.querySelector('p')!.firstChild!;
    await select(text, 0, text, 5);
    const comment = commentButton();
    expect(comment).toBeDefined();

    await React.act(async () => {
      comment?.focus();
      document.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));
    });

    expect(document.activeElement).toBe(comment);
    expect(commentButton()).toBe(comment);
    await React.act(async () => comment?.click());
    expect(onComment).toHaveBeenCalledWith({ from: 1, to: 6 });

    await React.act(async () => title.focus());
    expect(commentButton()).toBeUndefined();
  });

  it('keeps long selections reachable in a narrow viewport and hides offscreen selections', async () => {
    const bounds = vi
      .spyOn(Range.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(13, 20, 350, 550));
    await mountActions();
    const [first, second] = editor.view.dom.querySelectorAll('p');
    await select(first.firstChild!, 0, second.querySelector('strong')!.firstChild!, 11);

    const actions = commentButton()?.parentElement;
    expect(actions?.style.left).toBe('272px');
    expect(actions?.style.top).toBe('546px');
    expect(actions?.style.visibility).toBe('visible');

    bounds.mockReturnValue(new DOMRect(13, -300, 350, 150));
    window.dispatchEvent(new Event('scroll'));
    expect(actions?.style.visibility).toBe('hidden');
  });

  it('rejects a click when the document changed after the pointer press', async () => {
    const { onComment } = await mountActions(true);
    const text = editor.view.dom.querySelector('p')!.firstChild!;
    await select(text, 0, text, 5);
    const comment = commentButton();
    expect(comment).toBeDefined();
    const originalDocument = editor.state.doc;
    await React.act(async () => {
      comment?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      editor.view.dispatch(editor.state.tr.insertText(' revised', 20));
    });
    expect(editor.state.doc).not.toBe(originalDocument);

    await React.act(async () =>
      commentButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })),
    );
    expect(onComment).not.toHaveBeenCalled();
  });
});
