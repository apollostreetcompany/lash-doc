/** @vitest-environment jsdom */

import { applyTextOperations } from '@lash/ai';
import { createLashEditorExtensions } from '@lash/editor-core';
import { createDocumentId, type EditPatch } from '@lash/types';
import { Editor, type JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AIPanel, type AIPanelProps } from '../../../../apps/web/components/editor/panels/AIPanel';
import { completeMobileRailDocumentNavigation } from '../../../../apps/web/components/shell/AppShell';
import { getAiSelection, prepareAiReplacement } from '../../../../apps/web/lib/aiSelection';
import { createMobileRailActionCoordinator } from '../../../../apps/web/lib/mobileRailActionCoordinator';
import * as React from '../../../../apps/web/node_modules/react';
import { createRoot, type Root } from '../../../../apps/web/node_modules/react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.assign(globalThis, { React });

const docId = createDocumentId('ai-selection-range');
const mountedRoots: Root[] = [];
const editors: Editor[] = [];

const createEditor = (content: string | JSONContent) => {
  const editor = new Editor({
    extensions: createLashEditorExtensions(),
    content,
  });
  editors.push(editor);
  return editor;
};

const findOccurrencePmRange = (editor: Editor, needle: string, occurrence: number) => {
  let seen = 0;
  let match: { from: number; to: number } | null = null;

  editor.state.doc.descendants((node, position) => {
    if (!node.isText || !node.text || match) return;

    let searchFrom = 0;
    while (searchFrom <= node.text.length - needle.length) {
      const index = node.text.indexOf(needle, searchFrom);
      if (index < 0) return;
      if (seen === occurrence) {
        match = { from: position + index, to: position + index + needle.length };
        return;
      }
      seen += 1;
      searchFrom = index + needle.length;
    }
  });

  if (!match) throw new Error(`Could not find occurrence ${occurrence} of "${needle}".`);
  return match;
};

const renderPanel = async (
  editor: Editor,
  currentText: string,
  showTestControls = true,
  overrides: Partial<AIPanelProps> = {},
) => {
  const onApplyPatch = vi.fn(async (_patch: EditPatch) => ({ ok: true as const }));
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push(root);

  const render = async (updates: Partial<AIPanelProps> = {}) => {
    await React.act(async () => {
      root.render(
        React.createElement(AIPanel, {
          editor,
          docId,
          baseVersion: 'base-version',
          currentText,
          schemaVersion: '1',
          showTestControls,
          onApplyPatch,
          ...overrides,
          ...updates,
        }),
      );
    });
  };
  await render();

  return { container, onApplyPatch, render };
};

const stageAndAccept = async (container: HTMLElement) => {
  const improve = container.querySelector<HTMLButtonElement>('[data-testid="ai-improve-button"]');
  expect(improve?.disabled).toBe(false);

  await React.act(async () => improve?.click());

  const accept = container.querySelector<HTMLButtonElement>('[data-testid="ai-accept-button"]');
  expect(accept).not.toBeNull();
  await React.act(async () => accept?.click());
};

const readStagedPatch = (container: HTMLElement) => {
  const serialized = container.querySelector('[data-testid="ai-patch-json"]')?.textContent;
  expect(serialized).toBeTruthy();
  return JSON.parse(serialized ?? 'null') as EditPatch;
};

const returnButton = (container: HTMLElement) =>
  [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Return to selected passage',
  );

const runNativeRevision = async (container: HTMLElement) => {
  const improve = container.querySelector<HTMLButtonElement>('[data-testid="ai-improve-button"]');
  expect(improve?.disabled).toBe(false);
  await React.act(async () => improve?.click());
};

const attachEditorForFocus = (editor: Editor) => {
  document.body.append(editor.view.dom.parentElement!);
  // jsdom does not report selection geometry for ProseMirror's scroll command.
  vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ top: 0, bottom: 0, left: 0, right: 0 });
};

afterEach(async () => {
  while (mountedRoots.length) {
    const root = mountedRoots.pop();
    await React.act(async () => root?.unmount());
  }
  while (editors.length) editors.pop()?.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('AIPanel exact selection scope', () => {
  it('reports unavailability when the browser has no model, even with text selected', async () => {
    const editor = createEditor('<p>A draft sentence.</p>');
    editor.commands.setTextSelection(findOccurrencePmRange(editor, 'A draft sentence.', 0));
    const { container, onApplyPatch } = await renderPanel(
      editor,
      editor.getText({ blockSeparator: '\n' }),
      false,
    );

    expect(container.querySelector('[data-testid="ai-status"]')?.textContent).toMatch(
      /On-device AI is unavailable/,
    );
    expect(container.querySelector('[data-testid="ai-review"]')).toBeNull();
    expect(container.querySelector('[data-testid="ai-improve-button"]')).toBeNull();
    expect(onApplyPatch).not.toHaveBeenCalled();
  });

  it('explains a malformed model reply and returns to the exact original passage without editing', async () => {
    vi.useFakeTimers();
    const selected = 'The exact phrase';
    const editor = createEditor(`<p>${selected}, then <strong>${selected}</strong>.</p>`);
    attachEditorForFocus(editor);
    const original = findOccurrencePmRange(editor, selected, 1);
    const draft = editor.state.doc;
    editor.commands.setTextSelection(original);
    const raw = 'This native echo must stay hidden.';
    const destroy = vi.fn();
    const prompt = vi.fn(async (_payload: string) => raw);
    vi.stubGlobal('LanguageModel', {
      availability: async () => 'available',
      create: async () => ({ prompt, destroy }),
    });
    const { container, onApplyPatch } = await renderPanel(editor, editor.getText(), false);
    await runNativeRevision(container);

    expect(JSON.parse(prompt.mock.calls[0][0]).selectedText).toBe(selected);
    expect(container.querySelector('[data-testid="ai-status"]')?.textContent).toBe(
      'The on-device model returned a reply Lash couldn’t use. Your draft is unchanged.',
    );
    expect(container.textContent).not.toContain(raw);
    expect(container.querySelector('[data-testid="ai-review"]')).toBeNull();
    expect(destroy).toHaveBeenCalledOnce();

    editor.commands.setTextSelection(findOccurrencePmRange(editor, selected, 0));
    const action = returnButton(container);
    expect(action).toBeDefined();
    action?.focus();
    await React.act(async () => action?.click());
    await React.act(async () => vi.advanceTimersByTimeAsync(32));
    expect(editor.state.selection).toMatchObject(original);
    expect(document.activeElement).toBe(editor.view.dom);
    expect(editor.state.doc).toBe(draft);
    expect(onApplyPatch).not.toHaveBeenCalled();
  });

  it('describes a native operation failure without blaming the excerpt', async () => {
    const editor = createEditor('<p>A draft sentence.</p>');
    editor.commands.setTextSelection(findOccurrencePmRange(editor, 'draft', 0));
    vi.stubGlobal('LanguageModel', {
      availability: async () => 'available',
      create: vi.fn().mockRejectedValue(new Error('Native session failed')),
    });
    const { container, onApplyPatch } = await renderPanel(editor, editor.getText(), false);
    await runNativeRevision(container);

    expect(container.querySelector('[data-testid="ai-status"]')?.textContent).toBe(
      'The on-device model couldn’t complete this request. Your draft is unchanged.',
    );
    expect(onApplyPatch).not.toHaveBeenCalled();
  });

  it.each([
    'unchanged',
    'edited before returning',
    'edited while closing',
    'locked while closing with no opener',
    'edited while another control takes focus',
    'unchanged while another control takes focus',
  ])('returns through the mobile drawer only for the original source (%s)', async (change) => {
    vi.useFakeTimers();
    const editor = createEditor('<p>A <strong>draft</strong> sentence.</p>');
    attachEditorForFocus(editor);
    const canvas = document.createElement('main');
    canvas.tabIndex = -1;
    canvas.setAttribute('inert', '');
    const opener = document.createElement('button');
    const otherControl = document.createElement('button');
    canvas.append(editor.view.dom.parentElement!, otherControl);
    document.body.append(opener, canvas);
    const original = findOccurrencePmRange(editor, 'draft', 0);
    editor.commands.setTextSelection(original);
    vi.stubGlobal('LanguageModel', {
      availability: async () => 'available',
      create: async () => ({
        prompt: async () => JSON.stringify({ revision: 'sample' }),
        destroy: vi.fn(),
      }),
    });
    const coordinator = createMobileRailActionCoordinator();
    const requestDocumentNavigation = vi.fn((navigateToTarget: () => boolean) => {
      coordinator.queue({
        documentId: docId,
        run: () =>
          completeMobileRailDocumentNavigation(navigateToTarget, {
            canvas,
            rail: container,
            opener,
          }),
        cancel: vi.fn(),
      });
    });
    const { container, onApplyPatch, render } = await renderPanel(editor, editor.getText(), false, {
      requestDocumentNavigation,
    });
    await runNativeRevision(container);

    const editDraft = () => {
      editor.commands.insertContentAt(1, 'New ');
      editor.commands.setTextSelection(1);
    };
    editor.commands.setTextSelection(1);
    if (change === 'edited before returning') editDraft();
    const action = returnButton(container);
    expect(action).toBeDefined();
    action?.focus();
    await React.act(async () => action?.click());

    if (change === 'edited before returning') {
      expect(requestDocumentNavigation).not.toHaveBeenCalled();
      expect(container.querySelector('[data-testid="ai-status"]')?.textContent).toContain(
        'The draft changed',
      );
      expect(editor.state.selection.empty).toBe(true);
      return;
    }

    expect(requestDocumentNavigation).toHaveBeenCalledOnce();
    expect(
      coordinator.notifyRelease({
        documentId: docId,
        canvasAvailable: false,
        bodyScrollLocked: true,
      }),
    ).toBe(false);
    expect(document.activeElement).toBe(action);
    expect(editor.state.selection.empty).toBe(true);
    await render({ open: false });
    canvas.removeAttribute('inert');
    if (change.startsWith('edited while')) editDraft();
    if (change === 'locked while closing with no opener') {
      editor.setEditable(false);
      opener.remove();
    }
    const newerFocus = change.endsWith('another control takes focus');
    if (newerFocus) otherControl.focus();
    const draft = editor.state.doc;
    expect(
      coordinator.notifyRelease({
        documentId: docId,
        canvasAvailable: true,
        bodyScrollLocked: false,
      }),
    ).toBe(true);
    await React.act(async () => vi.advanceTimersByTimeAsync(32));
    if (change === 'unchanged') {
      expect(editor.state.selection).toMatchObject(original);
      expect(document.activeElement).toBe(editor.view.dom);
    } else {
      expect(editor.state.selection.empty).toBe(true);
      const fallback = newerFocus
        ? otherControl
        : change === 'locked while closing with no opener'
          ? canvas
          : opener;
      expect(document.activeElement).toBe(fallback);
    }
    expect(editor.state.doc).toBe(draft);
    expect(onApplyPatch).not.toHaveBeenCalled();
  });

  it('previews the browser model response with context and uses only the captured range on apply', async () => {
    const editor = createEditor('<p>Before. The project is very nearly complete. After.</p>');
    const selected = 'The project is very nearly complete.';
    editor.commands.setTextSelection(findOccurrencePmRange(editor, selected, 0));
    const modelPrompt = vi.fn(async (_input: string) =>
      JSON.stringify({
        revision: 'The project is nearly complete.',
        rationale: 'Removes a redundant qualifier.',
      }),
    );
    const destroy = vi.fn();
    const create = vi.fn(async () => ({ prompt: modelPrompt, destroy }));
    vi.stubGlobal('LanguageModel', { availability: async () => 'available', create });
    const { container, onApplyPatch } = await renderPanel(editor, editor.getText(), false);

    expect(create).not.toHaveBeenCalled();
    await React.act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="ai-improve-button"]')?.click(),
    );

    expect(JSON.parse(modelPrompt.mock.calls[0][0])).toEqual({
      beforeContext: 'Before. ',
      afterContext: ' After.',
      selectedText: selected,
      instruction: 'Make this clearer and more concise.',
    });
    expect(destroy).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-testid="ai-original"]')?.textContent).toBe(selected);
    expect(container.querySelector('[data-testid="ai-revision"]')?.textContent).toBe(
      'The project is nearly complete.',
    );
    expect(container.querySelector('[data-testid="ai-patch-json"]')).toBeNull();
    expect(onApplyPatch).not.toHaveBeenCalled();

    await React.act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="ai-accept-button"]')?.click(),
    );
    expect(onApplyPatch.mock.calls[0][0].operations).toEqual([
      { op: 'replace_text', from: 8, to: 44, text: 'The project is nearly complete.' },
    ]);
    expect(container.querySelector('[data-testid="ai-status"]')?.textContent).toBe(
      'Revision applied.',
    );
  });

  it('discards a model response if the selection moves while waiting', async () => {
    const editor = createEditor('<p>hello world hello</p>');
    editor.commands.setTextSelection(findOccurrencePmRange(editor, 'hello', 0));
    let resolvePrompt: (response: string) => void = () => {
      throw new Error('Model was not invoked.');
    };
    const modelPrompt = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolvePrompt = resolve;
        }),
    );
    vi.stubGlobal('LanguageModel', {
      availability: async () => 'available',
      create: async () => ({ prompt: modelPrompt, destroy: vi.fn() }),
    });
    const { container, onApplyPatch } = await renderPanel(editor, editor.getText(), false);
    await React.act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="ai-improve-button"]')?.click(),
    );
    expect(modelPrompt).toHaveBeenCalledOnce();
    editor.commands.setTextSelection(findOccurrencePmRange(editor, 'hello', 1));
    await React.act(async () =>
      resolvePrompt(JSON.stringify({ revision: 'hi', rationale: 'Shorter.' })),
    );

    expect(container.querySelector('[data-testid="ai-review"]')).toBeNull();
    expect(container.querySelector('[data-testid="ai-status"]')?.textContent).toMatch(
      /selection changed/,
    );
    expect(onApplyPatch).not.toHaveBeenCalled();
  });

  it('does not show a finished apply from a previous panel visit', async () => {
    const editor = createEditor('<p>A draft sentence.</p>');
    editor.commands.setTextSelection(findOccurrencePmRange(editor, 'draft', 0));
    vi.stubGlobal('LanguageModel', {
      availability: async () => 'available',
      create: async () => ({
        prompt: async () => JSON.stringify({ revision: 'sample', rationale: 'More specific.' }),
        destroy: vi.fn(),
      }),
    });
    let completeApply!: (result: { ok: true }) => void;
    const onApplyPatch = vi.fn(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          completeApply = resolve;
        }),
    );
    const { container, render } = await renderPanel(editor, editor.getText(), false, {
      onApplyPatch,
    });
    await stageAndAccept(container);
    expect(onApplyPatch).toHaveBeenCalledOnce();

    await render({ open: false });
    await render({ open: true });
    const improve = container.querySelector<HTMLButtonElement>('[data-testid="ai-improve-button"]');
    expect(improve?.disabled).toBe(true);
    expect(container.querySelector('[data-testid="ai-review"]')).toBeNull();
    await React.act(async () => completeApply({ ok: true }));

    expect(improve?.disabled).toBe(false);
    expect(container.querySelector('[data-testid="ai-status"]')?.textContent).not.toContain(
      'Revision applied.',
    );
    expect(onApplyPatch).toHaveBeenCalledOnce();
  });

  it('keeps model access when an older capability check resolves after successful inference', async () => {
    const editor = createEditor('<p>A draft sentence.</p>');
    editor.commands.setTextSelection(findOccurrencePmRange(editor, 'draft', 0));
    let completeCheck!: (result: string) => void;
    const availability = vi
      .fn<[], Promise<string>>()
      .mockResolvedValueOnce('downloadable')
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            completeCheck = resolve;
          }),
      );
    vi.stubGlobal('LanguageModel', {
      availability,
      create: async () => ({
        prompt: async () => JSON.stringify({ revision: 'sample', rationale: 'More specific.' }),
        destroy: vi.fn(),
      }),
    });
    const { container, render } = await renderPanel(editor, editor.getText(), false);
    await render({ open: false });
    await render({ open: true });
    expect(availability).toHaveBeenCalledTimes(2);
    const improve = container.querySelector<HTMLButtonElement>('[data-testid="ai-improve-button"]');
    expect(improve?.disabled).toBe(false);
    await React.act(async () => improve?.click());
    expect(container.querySelector('[data-testid="ai-revision"]')?.textContent).toBe('sample');

    await React.act(async () => completeCheck('unavailable'));

    expect(container.querySelector('[data-testid="ai-improve-button"]')).toBe(improve);
    expect(container.querySelector('[data-testid="ai-revision"]')?.textContent).toBe('sample');
    expect(container.textContent).not.toContain('download its model');
  });

  it('lets the writer cancel in-flight inference even if capability changes', async () => {
    const editor = createEditor('<p>A draft sentence.</p>');
    editor.commands.setTextSelection(findOccurrencePmRange(editor, 'draft', 0));
    let completeCheck!: (result: string) => void;
    let completePrompt!: (result: string) => void;
    const create = vi.fn(async (_options: { signal: AbortSignal }) => ({
      prompt: () =>
        new Promise<string>((resolve) => {
          completePrompt = resolve;
        }),
      destroy: vi.fn(),
    }));
    vi.stubGlobal('LanguageModel', {
      availability: vi
        .fn<[], Promise<string>>()
        .mockResolvedValueOnce('available')
        .mockImplementationOnce(
          () =>
            new Promise<string>((resolve) => {
              completeCheck = resolve;
            }),
        ),
      create,
    });
    const { container, render } = await renderPanel(editor, editor.getText(), false);
    await render({ open: false });
    await render({ open: true });
    await React.act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="ai-improve-button"]')?.click(),
    );
    expect(create).toHaveBeenCalledOnce();
    await React.act(async () => completeCheck('unavailable'));

    const cancel = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Cancel',
    );
    if (!cancel) throw new Error('Expected the in-flight request to remain cancelable');
    await React.act(async () => cancel.click());
    expect(create.mock.calls[0][0].signal.aborted).toBe(true);

    await React.act(async () =>
      completePrompt(JSON.stringify({ revision: 'sample', rationale: 'Arrived after cancel.' })),
    );
    expect(container.querySelector('[data-testid="ai-review"]')).toBeNull();
    expect(container.querySelector('[data-testid="ai-status"]')?.textContent).toBe(
      'Request canceled.',
    );
    expect(container.querySelector('[data-testid="ai-improve-button"]')).toBeNull();
  });

  it('shows duplicate surrounding words in context and applies only the corrected selection', async () => {
    const text = 'We will publish the beta on Tuesday.';
    const editor = createEditor(`<p>${text}</p>`);
    editor.commands.setTextSelection(findOccurrencePmRange(editor, 'publish the beta', 0));
    vi.stubGlobal('LanguageModel', {
      availability: async () => 'available',
      create: async () => ({
        prompt: async () =>
          JSON.stringify({
            revision: 'share the beta on Tuesday',
            rationale: 'Uses a less formal verb.',
          }),
        destroy: vi.fn(),
      }),
    });
    const { container, onApplyPatch } = await renderPanel(editor, text, false);
    await React.act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="ai-improve-button"]')?.click(),
    );
    expect(container.querySelector('[data-testid="ai-revision-context"]')?.textContent).toBe(
      'We will share the beta on Tuesday on Tuesday.',
    );
    expect(onApplyPatch).not.toHaveBeenCalled();

    await React.act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="ai-edit-revision"]')?.click(),
    );
    const input = container.querySelector<HTMLInputElement>('[data-testid="ai-revision-input"]');
    if (!input) throw new Error('Expected an editable proposal');
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        input,
        'share the beta',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="ai-revision-context"]')?.textContent).toBe(
      'We will share the beta on Tuesday.',
    );
    await React.act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="ai-accept-button"]')?.click(),
    );
    expect(onApplyPatch.mock.calls[0][0].operations).toEqual([
      { op: 'replace_text', from: 8, to: 24, text: 'share the beta' },
    ]);
  });

  it('preserves the untouched rich document through an exact replacement and rejects a stale source', async () => {
    const editor = createEditor(
      '<h2 data-heading-id="original-heading">Heading</h2><p><strong>same</strong> then same.</p><ul><li><p><em>List item</em></p></li></ul>',
    );
    editor.commands.setTextSelection(findOccurrencePmRange(editor, 'same', 1));
    const before = editor.getText({ blockSeparator: '\n' });
    const { container, onApplyPatch } = await renderPanel(editor, before);
    await stageAndAccept(container);
    const patch = onApplyPatch.mock.calls[0][0];
    const selection = getAiSelection(editor, before);
    expect(selection).not.toBeNull();
    if (!selection) throw new Error('Missing selection');

    const prepared = prepareAiReplacement(editor, patch, selection);
    expect(prepared).not.toBeNull();
    if (!prepared) throw new Error('Missing replacement');
    const initial = editor.getJSON();
    editor.view.dispatch(prepared.transaction);
    const actual = editor.getJSON();
    expect(actual.content?.[0]).toEqual(initial.content?.[0]);
    expect(actual.content?.[1]?.content?.[0]).toEqual(initial.content?.[1]?.content?.[0]);
    expect(actual.content?.[2]).toEqual(initial.content?.[2]);
    expect(editor.getText({ blockSeparator: '\n' })).toBe(
      before.replace('then same', 'then Polished same'),
    );
    expect(prepareAiReplacement(editor, patch, selection)).toBeNull();
  });

  it.each([
    { action: 'Improve', testId: 'ai-improve-button' },
    { action: 'Ask', testId: 'ai-chat-ask' },
  ] as const)(
    'recomputes the later repeated occurrence when $action runs after a post-mount selection change',
    async ({ action, testId }) => {
      const editor = createEditor('<p>hello world hello</p>');
      const currentText = editor.getText({ blockSeparator: '\n' });
      const firstPmRange = findOccurrencePmRange(editor, 'hello', 0);
      const secondPmRange = findOccurrencePmRange(editor, 'hello', 1);
      editor.commands.setTextSelection(firstPmRange);

      const { container } = await renderPanel(editor, currentText);
      editor.commands.setTextSelection(secondPmRange);

      await React.act(async () => {
        container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)?.click();
      });

      if (action === 'Improve') {
        const patch = readStagedPatch(container);
        expect(patch.operations).toEqual([
          { op: 'replace_text', from: 12, to: 17, text: 'Polished hello' },
        ]);
        expect(patch.citations).toEqual([
          { type: 'doc', baseVersion: 'base-version', rangeFrom: 12, rangeTo: 17 },
        ]);
        expect(container.querySelector('[data-testid="ai-chat-answer"]')).toBeNull();
      } else {
        expect(container.querySelector('[data-testid="ai-review"]')).toBeNull();
        expect(container.querySelector('[data-testid="ai-chat-answer"]')?.textContent).toContain(
          'AI answer grounded in "hello".',
        );
        const citation = container.querySelector<HTMLElement>('[data-testid="ai-chat-citation"]');
        expect(citation?.dataset.rangeFrom).toBe('12');
        expect(citation?.dataset.rangeTo).toBe('17');
        expect(citation?.textContent).toContain('Citation: hello');
      }
    },
  );

  it('binds a repeated inline selection to the later selected occurrence', async () => {
    const editor = createEditor('<p>hello world hello</p>');
    const currentText = editor.getText({ blockSeparator: '\n' });
    const selectedPmRange = findOccurrencePmRange(editor, 'hello', 1);
    editor.commands.setTextSelection(selectedPmRange);

    expect(editor.state.doc.textBetween(selectedPmRange.from, selectedPmRange.to, '\n')).toBe(
      'hello',
    );

    const { container, onApplyPatch } = await renderPanel(editor, currentText);
    await stageAndAccept(container);

    const patch = onApplyPatch.mock.calls[0]?.[0];
    expect(patch?.operations).toEqual([
      { op: 'replace_text', from: 12, to: 17, text: 'Polished hello' },
    ]);
    expect(patch?.citations).toEqual([
      { type: 'doc', baseVersion: 'base-version', rangeFrom: 12, rangeTo: 17 },
    ]);
    expect(patch && applyTextOperations(currentText, patch.operations)).toBe(
      'hello world Polished hello',
    );
    expect(currentText.slice(0, 5)).toBe('hello');

    editor.commands.setTextSelection({ from: 1, to: 1 });
    await React.act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="ai-citation"]')?.click();
    });
    expect({
      from: editor.state.selection.from,
      to: editor.state.selection.to,
    }).toEqual(selectedPmRange);
  });

  it('maps a duplicate in a later block through the editor plaintext serializer', async () => {
    const editor = createEditor('<p>hello</p><p>hello</p>');
    const currentText = editor.getText({ blockSeparator: '\n' });
    const selectedPmRange = findOccurrencePmRange(editor, 'hello', 1);
    editor.commands.setTextSelection(selectedPmRange);

    expect(currentText).toBe('hello\nhello');
    expect(editor.state.doc.textBetween(selectedPmRange.from, selectedPmRange.to, '\n')).toBe(
      'hello',
    );

    const { container, onApplyPatch } = await renderPanel(editor, currentText);
    await stageAndAccept(container);

    const patch = onApplyPatch.mock.calls[0]?.[0];
    expect(patch?.operations).toEqual([
      { op: 'replace_text', from: 6, to: 11, text: 'Polished hello' },
    ]);
    expect(patch?.citations).toEqual([
      { type: 'doc', baseVersion: 'base-version', rangeFrom: 6, rangeTo: 11 },
    ]);
    expect(patch && applyTextOperations(currentText, patch.operations)).toBe(
      'hello\nPolished hello',
    );
    expect(currentText.slice(0, 5)).toBe('hello');
  });

  it('uses the Lash mention renderText prefix when deriving plaintext offsets', async () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'mention',
              attrs: { kind: 'user', refId: 'ada', display: 'Ada', iso: null },
            },
            { type: 'text', text: ' hello' },
          ],
        },
      ],
    });
    const currentText = editor.getText({ blockSeparator: '\n' });
    const selectedPmRange = findOccurrencePmRange(editor, 'hello', 0);
    editor.commands.setTextSelection(selectedPmRange);

    expect(currentText).toBe('@Ada hello');
    expect(selectedPmRange.from).not.toBe(5);

    const { container, onApplyPatch } = await renderPanel(editor, currentText);
    await stageAndAccept(container);

    const patch = onApplyPatch.mock.calls[0]?.[0];
    expect(patch?.operations).toEqual([
      { op: 'replace_text', from: 5, to: 10, text: 'Polished hello' },
    ]);
    expect(patch?.citations).toEqual([
      { type: 'doc', baseVersion: 'base-version', rangeFrom: 5, rangeTo: 10 },
    ]);
    expect(patch && applyTextOperations(currentText, patch.operations)).toBe('@Ada Polished hello');
  });

  it.each([
    {
      action: 'Improve',
      testId: 'ai-improve-button',
      status: 'Select text before requesting an AI edit.',
    },
    {
      action: 'Ask',
      testId: 'ai-chat-ask',
      status: 'Select text before asking AI.',
    },
  ] as const)(
    'fails $action closed when currentText is stale at action time',
    async ({ testId, status }) => {
      const editor = createEditor('<p>hello world</p>');
      const currentText = editor.getText({ blockSeparator: '\n' });
      editor.commands.setTextSelection(findOccurrencePmRange(editor, 'hello', 0));

      const { container, onApplyPatch } = await renderPanel(editor, currentText);
      editor.commands.setContent('<p>stale world</p>');
      editor.commands.setTextSelection(findOccurrencePmRange(editor, 'stale', 0));

      await React.act(async () => {
        container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)?.click();
      });

      expect(container.querySelector('[data-testid="ai-review"]')).toBeNull();
      expect(container.querySelector('[data-testid="ai-accept-button"]')).toBeNull();
      expect(container.querySelector('[data-testid="ai-chat-answer"]')).toBeNull();
      expect(container.querySelector('[data-testid="ai-chat-citation"]')).toBeNull();
      expect(onApplyPatch).not.toHaveBeenCalled();
      expect(container.querySelector('[data-testid="ai-status"]')?.textContent).toBe(status);
    },
  );
});
