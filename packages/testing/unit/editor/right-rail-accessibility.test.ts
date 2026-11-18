/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RightRail,
  type RailTab,
  type RailTabConfig,
} from '../../../../apps/web/components/shell/RightRail';
import * as React from '../../../../apps/web/node_modules/react';
import { createRoot, type Root } from '../../../../apps/web/node_modules/react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.assign(globalThis, { React });

const roots: Root[] = [];

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function StatefulChatPanel() {
  const [draftCount, setDraftCount] = React.useState(0);
  return React.createElement(
    'button',
    { type: 'button', onClick: () => setDraftCount((count) => count + 1) },
    `Draft ${draftCount}`,
  );
}

const tabs: RailTabConfig[] = [
  {
    id: 'chat',
    label: 'Chat',
    icon: 'chat',
    content: React.createElement(StatefulChatPanel),
  },
  {
    id: 'history',
    label: 'History',
    icon: 'history',
    content: React.createElement('button', { type: 'button' }, 'History action'),
  },
  {
    id: 'ai',
    label: 'AI',
    icon: 'sparkles',
    content: React.createElement('button', { type: 'button' }, 'AI action'),
  },
  {
    id: 'share',
    label: 'Share',
    icon: 'share',
    content: React.createElement('button', { type: 'button' }, 'Share action'),
  },
];

const mountRail = async ({
  initialActive = 'chat',
  jumpRequest = null,
  onChange = vi.fn(),
}: {
  initialActive?: RailTab;
  jumpRequest?: { id: RailTab; requestId: number } | null;
  onChange?: ReturnType<typeof vi.fn>;
} = {}) => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);

  function Harness() {
    const [active, setActive] = React.useState<RailTab>(initialActive);
    return React.createElement(RightRail, {
      active,
      onChange: (next: RailTab) => {
        onChange(next);
        setActive(next);
      },
      tabs,
      jumpRequest,
    });
  }

  await React.act(async () => {
    root.render(React.createElement(Harness));
  });
  return { host, root };
};

beforeEach(() => {
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    value: IntersectionObserverStub,
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    })),
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(async () => {
  while (roots.length) {
    const root = roots.pop();
    await React.act(async () => root?.unmount());
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('right rail tab accessibility and state authority', () => {
  it('exposes one selected tab and one labelled visible panel', async () => {
    const { host } = await mountRail();
    const tablist = host.querySelector<HTMLElement>('[role="tablist"]');
    const chatTab = host.querySelector<HTMLButtonElement>('#rail-tab-chat');
    const chatPanel = host.querySelector<HTMLElement>('#rail-section-chat');
    const historyPanel = host.querySelector<HTMLElement>('#rail-section-history');
    const aiPanel = host.querySelector<HTMLElement>('#rail-section-ai');

    expect(tablist?.getAttribute('aria-label')).toBe('Discussion sections');
    expect(chatTab?.getAttribute('role')).toBe('tab');
    expect(chatTab?.getAttribute('aria-selected')).toBe('true');
    expect(chatTab?.tabIndex).toBe(0);
    expect(chatPanel?.getAttribute('role')).toBe('tabpanel');
    expect(chatPanel?.getAttribute('aria-labelledby')).toBe('rail-tab-chat');
    expect(chatPanel?.hidden).toBe(false);
    expect(historyPanel?.hidden).toBe(true);
    expect(aiPanel?.hidden).toBe(true);
    expect(host.querySelectorAll('[role="tab"][aria-selected="true"]')).toHaveLength(1);
    expect(host.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
  });

  it('uses explicit activation and preserves inactive panel state', async () => {
    const { host } = await mountRail();
    const draft = host.querySelector<HTMLButtonElement>('#rail-section-chat button');
    await React.act(async () => draft?.click());
    expect(draft?.textContent).toBe('Draft 1');

    const historyTab = host.querySelector<HTMLButtonElement>('#rail-tab-history');
    await React.act(async () => historyTab?.click());
    expect(historyTab?.getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector<HTMLElement>('#rail-section-chat')?.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>('#rail-section-history')?.hidden).toBe(false);

    const chatTab = host.querySelector<HTMLButtonElement>('#rail-tab-chat');
    await React.act(async () => chatTab?.click());
    expect(host.querySelector<HTMLButtonElement>('#rail-section-chat button')?.textContent).toBe(
      'Draft 1',
    );
    expect(HTMLElement.prototype.scrollTo).not.toHaveBeenCalled();
  });

  it('supports roving Arrow, Home, and End keyboard activation', async () => {
    const { host } = await mountRail();
    const chatTab = host.querySelector<HTMLButtonElement>('#rail-tab-chat');
    const historyTab = host.querySelector<HTMLButtonElement>('#rail-tab-history');
    const shareTab = host.querySelector<HTMLButtonElement>('#rail-tab-share');

    chatTab?.focus();
    await React.act(async () => {
      chatTab?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
    });
    expect(historyTab).toBe(document.activeElement);
    expect(historyTab?.getAttribute('aria-selected')).toBe('true');

    await React.act(async () => {
      historyTab?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' }));
    });
    expect(shareTab).toBe(document.activeElement);
    expect(shareTab?.getAttribute('aria-selected')).toBe('true');

    await React.act(async () => {
      shareTab?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Home' }));
    });
    expect(chatTab).toBe(document.activeElement);
    expect(chatTab?.getAttribute('aria-selected')).toBe('true');

    await React.act(async () => {
      chatTab?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' }));
    });
    expect(shareTab).toBe(document.activeElement);
    expect(shareTab?.getAttribute('aria-selected')).toBe('true');
  });

  it('keeps stable accessible names when visual labels are hidden responsively', async () => {
    const { host } = await mountRail();

    for (const label of ['Chat', 'History', 'AI', 'Share']) {
      expect(
        host.querySelector<HTMLButtonElement>(`[role="tab"][aria-label="${label}"]`),
      ).not.toBeNull();
    }
  });

  it('consumes one external activation request object only once across a rail remount', async () => {
    const onChange = vi.fn();
    const request = { id: 'share' as const, requestId: 7 };
    const first = await mountRail({ jumpRequest: request, onChange });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('share');

    await React.act(async () => first.root.unmount());
    roots.splice(roots.indexOf(first.root), 1);
    await mountRail({ jumpRequest: request, onChange });

    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
