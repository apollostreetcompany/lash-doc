/** @vitest-environment jsdom */

import { createLashEditorExtensions } from '@lash/editor-core';
import { Editor } from '@tiptap/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { DocumentReferencePicker } from '../../../../apps/web/components/editor/DocumentReferencePicker';
import { MentionPanel } from '../../../../apps/web/components/editor/panels/MentionPanel';
import * as React from '../../../../apps/web/node_modules/react';
import { createRoot, type Root } from '../../../../apps/web/node_modules/react-dom/client';

let root: Root;
let editor: Editor;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('React', React);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  const editorHost = document.createElement('div');
  const pickerHost = document.createElement('div');
  host.append(editorHost, pickerHost);
  document.body.append(host);
  root = createRoot(pickerHost);
  editor = new Editor({
    element: editorHost,
    extensions: createLashEditorExtensions(),
    content: '<p>Keep this text</p><p>Draft @Report</p>',
  });
  vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({
    left: 80,
    right: 90,
    top: 100,
    bottom: 120,
  });
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  editor.destroy();
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const pressKey = (key: string) =>
  editor.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );

it('keeps the chosen document active when new results reorder the reference menu', async () => {
  const first = { id: 'report-one', title: 'Report one' };
  const selected = { id: 'report-two', title: 'Report two' };
  const render = (results: Array<typeof first>) =>
    React.act(async () =>
      root.render(
        React.createElement(DocumentReferencePicker, { editor, searchDocuments: () => results }),
      ),
    );

  await render([first, selected]);
  await React.act(async () => {
    editor.view.dom.focus();
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  });
  await React.act(async () => pressKey('ArrowDown'));
  const active = () =>
    document.querySelector('[data-testid="reference-picker"] [aria-selected="true"]')?.textContent;
  expect(active()).toContain(selected.title);

  await render([selected, first]);
  expect(active()).toContain(selected.title);
  await React.act(async () => pressKey('Enter'));
  expect(editor.getJSON().content?.[1].content).toContainEqual(
    expect.objectContaining({
      type: 'chip',
      attrs: expect.objectContaining({ refId: selected.id }),
    }),
  );
});

it('does not replace unrelated text with a fixture mention after the caret moves', async () => {
  editor.commands.setContent('<p>Keep this text</p><p>Draft @Ada</p>');
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  await React.act(async () =>
    root.render(
      React.createElement(MentionPanel, { editor, currentText: 'Keep this text\nDraft @Ada' }),
    ),
  );
  const suggestion = host.querySelector<HTMLButtonElement>('[data-testid="mention-suggestion"]')!;
  expect(suggestion.textContent).toBe('Ada Lovelace');

  const before = editor.getJSON();
  editor.commands.setTextSelection(8);
  await React.act(async () => suggestion.click());
  expect(editor.getJSON()).toEqual(before);
  expect(host.querySelector('[data-testid="mention-chip"]')).toBeNull();

  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  await React.act(async () => suggestion.click());
  expect(editor.getJSON().content?.[1].content).toContainEqual(
    expect.objectContaining({
      type: 'mention',
      attrs: expect.objectContaining({ refId: 'user:ada' }),
    }),
  );
  expect(host.querySelector('[data-testid="mention-chip"]')?.textContent).toBe('Ada Lovelace');
});
