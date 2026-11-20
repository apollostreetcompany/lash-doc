/** @vitest-environment jsdom */

import { createLashEditorExtensions } from '@lash/editor-core';
import { createDocumentId, type HistoryEntry } from '@lash/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HistoryPanel,
  type HistoryPanelProps,
} from '../../../../apps/web/components/editor/panels/HistoryPanel';
import { getSchema } from '../../../../apps/web/node_modules/@tiptap/core';
import * as React from '../../../../apps/web/node_modules/react';
import { createRoot, type Root } from '../../../../apps/web/node_modules/react-dom/client';

const entry = (seq: number): HistoryEntry => ({
  id: `entry-${seq}`,
  docId: createDocumentId('history-test'),
  actor: { type: 'user', id: 'writer' },
  ts: '2026-11-21T00:00:00.000Z',
  parentSha: `version-${seq - 1}`,
  resultSha: `version-${seq}`,
  seq,
  lamport: seq,
  schemaVersion: 'lash-schema-v1',
  ops: [],
  intent: 'edit',
  audit: { ua: 'history-version-reader-test' },
});

describe('reading a local History version', () => {
  let host: HTMLDivElement;
  let root: Root;

  const render = (overrides: Partial<HistoryPanelProps> = {}) =>
    React.act(async () => {
      root.render(
        React.createElement(HistoryPanel, {
          editor: null,
          entries: [entry(1), entry(2)],
          selectedEntryId: 'entry-1',
          authorFilter: null,
          timeFilter: null,
          acceptedSuggestionIds: [],
          suggestionResolutions: [],
          availability: 'ready',
          canRestore: false,
          authorshipVisible: false,
          loadDiff: async (from, to) => ({ from, to, spans: [] }),
          onSelect: vi.fn(),
          onRestore: vi.fn(),
          onToggleAuthorship: vi.fn(),
          onSetAuthorFilter: vi.fn(),
          onClearAuthorFilter: vi.fn(),
          onSetTimeFilter: vi.fn(),
          onCopyFilterLink: vi.fn(),
          onAcceptSuggestion: vi.fn(),
          onRejectSuggestion: vi.fn(),
          ...overrides,
        }),
      );
    });

  const button = (name: string) => {
    const element = [...host.querySelectorAll('button')].find((item) => item.textContent === name);
    if (!element) throw new Error(`Missing ${name} button`);
    return element;
  };

  beforeEach(() => {
    vi.stubGlobal('React', React);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await React.act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it('reads the previous distinct saved draft without selecting or restoring a row', async () => {
    const loadVersion = vi.fn(async () => ({ text: 'Earlier saved draft' }));
    const onSelect = vi.fn();
    const onRestore = vi.fn();
    await render({
      entries: [
        entry(1),
        entry(2),
        { ...entry(3), resultSha: 'version-5' },
        { ...entry(4), intent: 'suggest' },
        entry(5),
      ],
      selectedEntryId: null,
      verifiedHeadSha: 'version-5',
      loadVersion,
      onSelect,
      onRestore,
    });
    const trigger = button('Read previous draft · Version 2');
    expect(trigger.getAttribute('aria-label')).toBe('Read previous draft, Version 2');
    expect(host.querySelector('[data-testid="history-selected-version"]')?.textContent).toBe(
      'Version 5',
    );
    expect(loadVersion).not.toHaveBeenCalled();

    await React.act(async () => trigger.click());
    expect(loadVersion.mock.calls).toEqual([['version-2']]);
    expect(host.querySelector('dialog h2')?.textContent).toBe('Version 2');
    expect(host.querySelector('article')?.textContent).toBe('Earlier saved draft');
    expect(host.querySelector('dialog p')?.textContent).toContain('Formatting is unavailable');
    await React.act(async () => button('Back to latest').click());
    expect(document.activeElement).toBe(trigger);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('offers the shortcut only when following a verified unfiltered saved head with a distinct predecessor', async () => {
    const loadVersion = vi.fn(async () => ({ text: 'Saved prose' }));
    const options = { selectedEntryId: null, verifiedHeadSha: 'version-2', loadVersion };
    const shortcut = () => host.querySelector('button[aria-label^="Read previous draft,"]');
    await render(options);
    expect(shortcut()).not.toBeNull();

    for (const override of [
      { selectedEntryId: 'entry-2' },
      { authorFilter: 'writer' },
      { timeFilter: 'last-7-days' as const },
      { verifiedHeadSha: null },
      { verifiedHeadSha: 'version-1' },
      { availability: 'capacity-reached' as const },
      { availability: 'body-history-diverged' as const },
      { entries: [{ ...entry(1), resultSha: 'version-2' }, entry(2)] },
      { entries: [{ ...entry(1), intent: 'suggest' as const }, entry(2)] },
      { entries: [entry(1), { ...entry(2), intent: 'suggest' as const }] },
      { loadVersion: undefined },
    ] satisfies Array<Partial<HistoryPanelProps>>) {
      await render({ ...options, ...override });
      expect(shortcut()).toBeNull();
    }
    await render({ ...options, selectedEntryId: 'entry-2' });
    expect(button('Read version')).toBeDefined();
    expect(loadVersion).not.toHaveBeenCalled();
  });

  it('keeps the explicitly opened shortcut target on new saves and reports unavailable content', async () => {
    let finish!: (result: null) => void;
    const pending = new Promise<null>((resolve) => {
      finish = resolve;
    });
    const loadVersion = vi.fn((_sha: string) => pending);
    const options = { selectedEntryId: null, loadVersion };
    await render({ ...options, verifiedHeadSha: 'version-2' });
    await React.act(async () => button('Read previous draft · Version 1').click());
    expect(host.querySelector('dialog h2')?.textContent).toBe('Version 1');
    expect(host.querySelector('dialog')?.textContent).toContain('Loading version');

    await render({
      ...options,
      entries: [entry(1), entry(2), entry(3)],
      verifiedHeadSha: 'version-3',
    });
    expect(host.querySelector('dialog h2')?.textContent).toBe('Version 1');
    expect(loadVersion.mock.calls).toEqual([['version-1']]);
    await React.act(async () => finish(null));
    const dialog = host.querySelector('dialog');
    expect(dialog?.textContent).toContain('This version is unavailable to read.');
    expect(dialog?.querySelector('article')).toBeNull();
    await React.act(async () => dialog?.dispatchEvent(new Event('cancel', { cancelable: true })));
    expect(host.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(button('Read previous draft · Version 2'));
  });

  it('returns focus to History on dismissal and lets the drawer own explicit return', async () => {
    const documentOpener = document.createElement('button');
    host.before(documentOpener);
    const onReturnToDocument = vi.fn(() => documentOpener.focus());
    try {
      await render({ loadVersion: async () => ({ text: 'Saved prose' }), onReturnToDocument });
      const trigger = button('Read version');
      await React.act(async () => trigger.click());
      const dialog = host.querySelector('dialog');
      expect(dialog?.open).toBe(true);
      await React.act(async () => dialog?.dispatchEvent(new Event('cancel', { cancelable: true })));
      expect(host.querySelector('dialog')).toBeNull();
      expect(onReturnToDocument).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(trigger);

      await React.act(async () => trigger.click());
      await React.act(async () => button('Back to latest').click());
      expect(host.querySelector('dialog')).toBeNull();
      expect(onReturnToDocument).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(documentOpener);
    } finally {
      documentOpener.remove();
    }
  });

  it('reads the full formatted body without fetching or exposing stored reference attributes', async () => {
    const schema = getSchema(createLashEditorExtensions());
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Original title' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Unchanged prose', marks: [{ type: 'bold' }] },
            { type: 'hardBreak' },
            {
              type: 'text',
              text: 'Original link text',
              marks: [{ type: 'link', attrs: { href: 'https://example.invalid/tracker' } }],
            },
            {
              type: 'mention',
              attrs: { kind: 'group', refId: 'private-group-id', display: 'Private group name' },
            },
            {
              type: 'chip',
              attrs: { href: '/doc/private-doc', display: 'Private document title' },
            },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'First list item' }] },
                {
                  type: 'bulletList',
                  content: [
                    {
                      type: 'listItem',
                      content: [
                        {
                          type: 'paragraph',
                          content: [{ type: 'text', text: 'Nested list item' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        { type: 'image', attrs: { src: 'https://example.invalid/pixel', alt: 'Original diagram' } },
      ],
    });
    const loadVersion = vi.fn(async () => ({ text: 'Plain fallback', document: doc }));
    const onRestore = vi.fn();
    await render({ loadVersion, onRestore });
    const trigger = button('Read version');
    trigger.focus();
    await React.act(async () => trigger.click());
    expect(loadVersion).toHaveBeenCalledWith('version-1');

    const dialog = host.querySelector('dialog');
    const article = dialog?.querySelector('article');
    expect(dialog?.open).toBe(true);
    expect(article?.querySelector('h1')?.textContent).toBe('Original title');
    expect(article?.querySelector('strong')?.textContent).toBe('Unchanged prose');
    expect(article?.querySelector('ul ul li')?.textContent).toBe('Nested list item');
    expect(article?.querySelector('br')).not.toBeNull();
    expect(article?.querySelector('a, img')).toBeNull();
    expect(article?.textContent).toContain('Original link text');
    expect(article?.textContent).toContain('Original diagram');
    expect(article?.textContent).toContain('@hidden-group');
    expect(article?.outerHTML).not.toMatch(
      /private-group-id|private-doc|Private group name|Private document title|example\.invalid/,
    );
    await React.act(async () => button('Back to latest').click());
    expect(host.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('discards a late version after selection changes and preserves legacy text line breaks', async () => {
    let complete!: (version: { text: string }) => void;
    const pending = new Promise<{ text: string }>((resolve) => {
      complete = resolve;
    });
    const text = 'Legacy first line\n\nLegacy final line';
    const loadVersion = vi.fn((sha: string) =>
      sha === 'version-1' ? pending : Promise.resolve({ text }),
    );
    await render({ loadVersion });
    await React.act(async () => button('Read version').click());
    expect(host.querySelector('dialog')?.textContent).toContain('Loading version…');
    await render({ loadVersion, selectedEntryId: 'entry-2' });
    await React.act(async () => complete({ text: 'Stale content from the first version' }));
    expect(host.querySelector('dialog')).toBeNull();

    await React.act(async () => button('Read version').click());
    expect(host.querySelector('dialog')?.textContent).toContain('Formatting is unavailable');
    expect(host.querySelector('article')?.textContent).toBe(text);
    expect(host.textContent).not.toContain('Stale content');

    await render({
      loadVersion,
      availability: 'body-history-diverged',
      selectedEntryId: 'entry-2',
    });
    expect(host.querySelector('dialog')).toBeNull();
    expect(host.textContent).not.toContain('Read version');
  });

  it('shows only the visible choices in saved status and select cells', async () => {
    const schema = getSchema(createLashEditorExtensions());
    const { nodes } = schema;
    const hidden = nodes.paragraph.create(null, schema.text('Hidden cell prose'));
    const row = nodes.tableRow.create(null, [
      nodes.tableCell.create({ cellType: 'status', options: ['', 'Ready'], value: '' }, hidden),
      nodes.tableCell.create(
        { cellType: 'select', options: ['First'], value: 'Old choice' },
        hidden,
      ),
    ]);
    const doc = nodes.doc.create(null, nodes.table.create(null, row));
    await render({ loadVersion: async () => ({ text: 'Plain fallback', document: doc }) });
    await React.act(async () => button('Read version').click());
    const article = host.querySelector('article');
    expect(Array.from(host.querySelectorAll('article td'), (cell) => cell.textContent)).toEqual([
      '',
      'First',
    ]);
    expect(article?.textContent).not.toMatch(/Hidden cell prose|Old choice/);
  });

  it('keeps legacy suggestions in comparison without labeling them as saved document reads', async () => {
    const loadVersion = vi.fn(async () => ({ text: 'Proposal' }));
    await render({ entries: [{ ...entry(1), intent: 'suggest' }], loadVersion });
    expect(host.querySelector('[data-testid="history-suggestion-status"]')?.textContent).toBe(
      'Pending suggestion',
    );
    expect(host.querySelector('[data-testid="history-diff"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Read version');
    expect(loadVersion).not.toHaveBeenCalled();
  });
});
