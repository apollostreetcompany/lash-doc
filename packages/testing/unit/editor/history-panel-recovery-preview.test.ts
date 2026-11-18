/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HistoryPanel,
  type HistoryPanelProps,
} from '../../../../apps/web/components/editor/panels/HistoryPanel';
import * as React from '../../../../apps/web/node_modules/react';
import { createRoot, type Root } from '../../../../apps/web/node_modules/react-dom/client';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('React', React);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(overrides: Partial<HistoryPanelProps> = {}) {
  const props: HistoryPanelProps = {
    editor: null,
    entries: [],
    selectedEntryId: null,
    authorFilter: null,
    timeFilter: null,
    acceptedSuggestionIds: [],
    suggestionResolutions: [],
    availability: 'body-history-diverged',
    canRestore: false,
    authorshipVisible: false,
    loadDiff: vi.fn(),
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
  };
  await React.act(async () => root.render(React.createElement(HistoryPanel, props)));
}

function findPreviewButton() {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === 'Preview saved version',
  );
  if (!button) throw new Error('Expected a Preview saved version button');
  return button;
}

describe('History panel saved version preview', () => {
  it('opens and closes an exact read-only text snapshot from a focusable disclosure', async () => {
    const text = 'Launch  notes\nTuesday <Thursday> & Friday';
    const loadSavedHistoryPreview = vi.fn(async () => ({ text }));
    await render({ loadSavedHistoryPreview });
    const trigger = findPreviewButton();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(loadSavedHistoryPreview).not.toHaveBeenCalled();
    expect(host.querySelector('textarea')).toBeNull();

    trigger.focus();
    await React.act(async () => trigger.click());

    const preview = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
    const field = preview?.querySelector('textarea');
    expect(loadSavedHistoryPreview).toHaveBeenCalledTimes(1);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(trigger);
    expect(field?.labels?.[0]?.textContent).toBe('Saved version text');
    const help = document.getElementById(field?.getAttribute('aria-describedby') ?? '');
    expect(help?.textContent).toContain('omits formatting and non-text content');
    expect(field?.readOnly).toBe(true);
    expect(field?.disabled).toBe(false);
    expect(field?.value).toBe(text);
    expect(field?.tabIndex).toBe(0);
    field?.focus();
    field?.select();
    expect(document.activeElement).toBe(field);
    expect(field?.selectionStart).toBe(0);
    expect(field?.selectionEnd).toBe(text.length);
    expect(host.querySelector('[data-testid="history-restore-button"]')).toBeNull();

    trigger.focus();
    await React.act(async () => trigger.click());
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('textarea')).toBeNull();
  });

  it('offers a preview only when eligible and never shows an unverified snapshot', async () => {
    const loadSavedHistoryPreview = vi.fn(async () => null);
    await render();
    expect(host.textContent).not.toContain('Preview saved version');
    await render({ availability: 'ready', loadSavedHistoryPreview });
    expect(host.textContent).not.toContain('Preview saved version');
    expect(loadSavedHistoryPreview).not.toHaveBeenCalled();

    await render({ loadSavedHistoryPreview });
    await React.act(async () => findPreviewButton().click());
    expect(host.textContent).toContain('This saved version is no longer available to preview.');
    expect(host.querySelector('textarea')).toBeNull();
  });

  it('withholds the prior snapshot during revalidation and ignores a late result after eligibility ends', async () => {
    const loadSnapshot = vi.fn(async () => ({ text: 'Previously verified snapshot' }));
    await render({ loadSavedHistoryPreview: loadSnapshot });
    await React.act(async () => findPreviewButton().click());
    expect(host.querySelector('textarea')?.value).toBe('Previously verified snapshot');

    let resolveSnapshot!: (snapshot: { text: string }) => void;
    const slow = new Promise<{ text: string }>((resolve) => {
      resolveSnapshot = resolve;
    });
    await render({ loadSavedHistoryPreview: () => slow });
    expect(host.textContent).toContain('Checking the saved version…');
    expect(host.querySelector('textarea')).toBeNull();

    await render({ availability: 'body-saving-unavailable' });
    await React.act(async () => resolveSnapshot({ text: 'Late result' }));
    expect(host.textContent).not.toContain('Late result');
    expect(host.querySelector('textarea')).toBeNull();
  });
});
