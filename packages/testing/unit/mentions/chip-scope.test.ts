/** @vitest-environment jsdom */

import { createLashEditorExtensions, serializeDocToMarkdownFile } from '@lash/editor-core';
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';

import { createDocumentReferenceCatalog } from '../../../../apps/web/lib/documentReferenceCatalog';
import { saveDocumentTitle } from '../../../../apps/web/lib/documentRegistry';

const id = 'local-research';
const path = `/doc/${id}`;
const oldTitle = 'Legacy private research';
const editors: Editor[] = [];

const pasteText = (editor: Editor, text: string) => {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (format: string) => (format === 'text/plain' ? text : '') },
  });
  editor.view.dom.dispatchEvent(event);
};

const makeEditor = (scope: Parameters<typeof createDocumentReferenceCatalog>[0]) => {
  const catalog = createDocumentReferenceCatalog(scope);
  const editor = new Editor({
    extensions: createLashEditorExtensions({ chips: { resolveDocChip: catalog.resolve } }),
  });
  editors.push(editor);
  return { editor, catalog };
};

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  window.localStorage.clear();
});

describe('document reference access', () => {
  it('persists only the link and resolves the title for the current viewer', () => {
    saveDocumentTitle(window.localStorage, id, 'Private research');
    const { editor } = makeEditor({ kind: 'local', storage: () => window.localStorage });
    pasteText(editor, new URL(path, window.location.origin).href);
    const chip = editor.state.doc.firstChild?.firstChild;

    expect(chip?.type.name).toBe('chip');
    expect(chip?.attrs).toMatchObject({ refId: id, href: path, display: '', lastEditor: null });
    expect(editor.view.dom.querySelector('[data-testid="lash-chip"]')?.textContent).toContain(
      'Private research',
    );
    expect(editor.getHTML()).not.toContain('Private research');
    expect(editor.getText()).toBe(path);
  });

  it('shows a plain link for an old reference without exposing stored metadata', () => {
    const { editor, catalog } = makeEditor({ kind: 'shared', readCurrent: () => null });
    saveDocumentTitle(window.localStorage, id, 'Private research');
    editor.commands.insertContent({
      type: 'chip',
      attrs: {
        refId: 'legacy-private-ref',
        href: path,
        display: oldTitle,
        lastEditor: 'old metadata',
        iconUrl: 'https://example.test/private.png',
      },
    });

    expect(catalog.search('Private research')).toEqual([]);
    expect(editor.view.dom.querySelector('a')?.textContent).toBe(path);
    expect(editor.view.dom.querySelector('a')?.getAttribute('href')).toBe(path);
    expect(editor.view.dom.querySelector('[data-testid="lash-chip"]')).toBeNull();
    expect(editor.getHTML()).not.toContain(oldTitle);
    expect(editor.getHTML()).not.toContain('private.png');
    expect(editor.getHTML()).not.toContain('legacy-private-ref');
    const { markdown } = serializeDocToMarkdownFile(editor.getJSON(), { title: 'Copy' });
    expect(markdown).toContain(path);
    expect(markdown).not.toContain(oldTitle);
  });

  it('keeps foreign, unknown, and token-bearing paste as ordinary content', () => {
    saveDocumentTitle(window.localStorage, id, 'Private research');
    const { editor } = makeEditor({ kind: 'local', storage: () => window.localStorage });

    for (const url of [
      `https://lash.local.example.test${path}`,
      new URL('/doc/unknown-document', window.location.origin).href,
      new URL(`${path}?token=literal-test-token`, window.location.origin).href,
    ]) {
      pasteText(editor, url);
      expect(editor.getText()).toContain(url);
      expect(editor.view.dom.querySelector('[data-testid="lash-chip"]')).toBeNull();
    }
  });

  it('returns only current authorized room metadata for shared documents', () => {
    const room = { id: `doc-v1-${'f'.repeat(64)}`, title: 'Room ref' };
    const { catalog } = makeEditor({ kind: 'shared', readCurrent: () => room });
    saveDocumentTitle(window.localStorage, id, 'Room ref local');
    expect(catalog.search('room ref')).toEqual([room]);
    expect(catalog.resolve(id)).toBeNull();
    expect(catalog.resolve(room.id)).toEqual(room);
  });

  it('anonymizes stored group labels in HTML, text and Markdown', () => {
    const { editor } = makeEditor({ kind: 'shared', readCurrent: () => null });
    editor.commands.insertContent({
      type: 'mention',
      attrs: { kind: 'group', refId: 'secret-group-id', display: 'Secret Group' },
    });

    const node = editor.view.dom.querySelector('[data-testid="lash-inline-mention"]');
    expect(node?.textContent).toBe('@hidden-group');
    expect(node?.outerHTML).not.toMatch(/Secret Group|secret-group-id/);
    expect(editor.getText()).toBe('@hidden-group');
    const { markdown } = serializeDocToMarkdownFile(editor.getJSON(), { title: 'Copy' });
    expect(markdown).toContain('@hidden-group');
    expect(markdown).not.toContain('Secret Group');
  });
});
