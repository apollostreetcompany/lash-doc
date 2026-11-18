/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from '../../../../apps/web/components/shell/AppShell';
import { TopBar } from '../../../../apps/web/components/shell/TopBar';
import * as React from '../../../../apps/web/node_modules/react';
import { createRoot, type Root } from '../../../../apps/web/node_modules/react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.assign(globalThis, { React });

const roots: Root[] = [];
const homePageSource = readFileSync(resolve(process.cwd(), 'apps/web/app/page.tsx'), 'utf8');
const documentPageSource = readFileSync(
  resolve(process.cwd(), 'apps/web/app/doc/[id]/page.tsx'),
  'utf8',
);
const editorWorkspaceSource = readFileSync(
  resolve(process.cwd(), 'apps/web/components/editor/EditorWorkspace.tsx'),
  'utf8',
);
const globalStylesSource = readFileSync(resolve(process.cwd(), 'apps/web/app/globals.css'), 'utf8');
const emptyDocumentInvitationSource = readFileSync(
  resolve(process.cwd(), 'packages/editor-core/src/extensions/empty-document-invitation.ts'),
  'utf8',
);

const installMobileViewport = () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === '(max-width: 767px)' || query === '(max-width: 431px)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    })),
  });
};

const installDesktopViewport = () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    })),
  });
};

const ShellHarness = () => {
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [railOpen, setRailOpen] = React.useState(false);
  const [railSection, setRailSection] = React.useState<'share' | 'discussion'>('share');
  const [mobileRailFocusOrigin, setMobileRailFocusOrigin] =
    React.useState<HTMLButtonElement | null>(null);
  const [restoreMobileRailFocus, setRestoreMobileRailFocus] = React.useState(true);
  const [showPending, setShowPending] = React.useState(false);

  React.useEffect(() => {
    if (railOpen || !showPending) return;
    const canvas = document.querySelector<HTMLElement>('.lash-canvas');
    if (canvas?.hasAttribute('inert')) return;
    setShowPending(false);
    canvas?.querySelector<HTMLElement>('[data-testid="editor-action"]')?.focus();
  }, [railOpen, showPending]);

  const closeSidebar = React.useCallback(() => {
    setSidebarOpen(false);
  }, []);
  const closeRail = React.useCallback(() => {
    setRestoreMobileRailFocus(true);
    setRailOpen(false);
  }, []);

  const openRail = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, section: 'share' | 'discussion') => {
      setMobileRailFocusOrigin(event.currentTarget);
      setRestoreMobileRailFocus(true);
      setRailSection(section);
      setRailOpen(true);
    },
    [],
  );

  const topBar = React.createElement(
    'header',
    { className: 'lash-topbar' },
    React.createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'topbar-mobile-menu',
        'aria-label': 'Open navigation menu',
        'aria-controls': 'lash-sidebar',
        'aria-expanded': sidebarOpen ? 'true' : 'false',
        onClick: () => setSidebarOpen(true),
      },
      'Menu',
    ),
    React.createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'topbar-share-button',
        'aria-label': 'Share document',
        'aria-controls': 'lash-rail',
        'aria-expanded': railOpen ? 'true' : 'false',
        onClick: (event: React.MouseEvent<HTMLButtonElement>) => openRail(event, 'share'),
      },
      'Share',
    ),
    React.createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'topbar-discussion-button',
        'aria-label': 'Discussion',
        'aria-controls': 'lash-rail',
        'aria-expanded': railOpen && railSection === 'discussion' ? 'true' : 'false',
        onClick: (event: React.MouseEvent<HTMLButtonElement>) => openRail(event, 'discussion'),
      },
      'Discussion',
    ),
    React.createElement(
      'button',
      { type: 'button', 'data-testid': 'background-action' },
      'Background',
    ),
  );

  const sidebar = React.createElement(
    'aside',
    { className: 'lash-sidebar', id: 'lash-sidebar' },
    React.createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'sidebar-mobile-close',
        'data-mobile-initial-focus': 'true',
        onClick: closeSidebar,
      },
      'Close navigation',
    ),
    React.createElement(
      'button',
      { type: 'button', 'data-testid': 'sidebar-last-action' },
      'Last navigation action',
    ),
  );

  const rail = React.createElement(
    'aside',
    { className: 'lash-rail', id: 'lash-rail' },
    React.createElement(
      'button',
      {
        type: 'button',
        'aria-current': 'true',
        'data-mobile-initial-focus': 'true',
      },
      railSection === 'share' ? 'Share' : 'Chat',
    ),
    React.createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'chat-jump-anchor',
        onClick: () => {
          setRestoreMobileRailFocus(false);
          setShowPending(true);
          setRailOpen(false);
        },
      },
      'Show in document',
    ),
    React.createElement(
      'button',
      { type: 'button', 'aria-label': 'Close activity panel', onClick: closeRail },
      'Close',
    ),
  );

  return React.createElement(
    AppShell,
    {
      topBar,
      sidebar,
      rail,
      focusMode: false,
      railOpen: true,
      sidebarCollapsed: false,
      mobileSidebarOpen: sidebarOpen,
      mobileRailOpen: railOpen,
      mobileRailFocusRequest: {
        trigger: mobileRailFocusOrigin,
        restoreFocus: restoreMobileRailFocus,
      },
      onMobileSidebarClose: closeSidebar,
      onMobileRailClose: closeRail,
    },
    React.createElement('button', { type: 'button', 'data-testid': 'editor-action' }, 'Edit'),
  );
};

const renderHarness = async () => {
  installMobileViewport();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await React.act(async () => {
    root.render(React.createElement(ShellHarness));
  });
  return host;
};

const TopBarHarness = () => {
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [discussionOpen, setDiscussionOpen] = React.useState(false);
  const [shareControlsPresent, setShareControlsPresent] = React.useState(true);
  const [focusMode, setFocusMode] = React.useState(false);
  const [suggestionAvailable, setSuggestionAvailable] = React.useState(true);
  const [, forceUnrelatedRender] = React.useReducer((value: number) => value + 1, 0);

  const topBar = React.createElement(TopBar, {
    editor: null,
    peers: [],
    docTitle: 'Untitled',
    focusMode,
    suggestionAvailable,
    shareExpanded: false,
    shareControlsPresent,
    mobileSidebarExpanded: sidebarOpen,
    mobileDiscussionVisible: true,
    discussionExpanded: discussionOpen,
    onToggleFocusMode: () => setFocusMode((value) => !value),
    onStartSuggestion: () => setDiscussionOpen(true),
    onShareClick: vi.fn(),
    onDiscussionClick: () => setDiscussionOpen(true),
    onOpenMobileSidebar: () => setSidebarOpen(true),
    extras: React.createElement(
      React.Fragment,
      null,
      React.createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'force-unrelated-render',
          onClick: forceUnrelatedRender,
        },
        'Refresh',
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'toggle-share-control-presence',
          onClick: () => setShareControlsPresent((present) => !present),
        },
        'Toggle Share control presence',
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'toggle-suggest-disabled',
          onClick: () => setSuggestionAvailable((value) => !value),
        },
        'Toggle Suggest disabled',
      ),
    ),
  });

  return React.createElement(
    React.Fragment,
    null,
    topBar,
    shareControlsPresent
      ? React.createElement('aside', { id: 'lash-rail', 'aria-label': 'Document activity' })
      : null,
  );
};

const renderTopBarHarness = async (viewport: 'mobile' | 'desktop' = 'mobile') => {
  if (viewport === 'mobile') installMobileViewport();
  else installDesktopViewport();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await React.act(async () => {
    root.render(React.createElement(TopBarHarness));
  });
  return host;
};

afterEach(async () => {
  while (roots.length) {
    const root = roots.pop();
    await React.act(async () => root?.unmount());
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('mobile shell accessibility state machine', () => {
  it('gives the route, writing region, and editor textbox distinct truthful names', () => {
    for (const routeSource of [homePageSource, documentPageSource]) {
      expect(routeSource).toContain('<section aria-label="Document workspace">');
      expect(routeSource).not.toContain('<section aria-label="Document editor">');
    }
    expect(editorWorkspaceSource).toContain('aria-label="Writing canvas"');
    expect(editorWorkspaceSource).not.toContain('aria-label="Document editor"');
    expect(emptyDocumentInvitationSource).toContain("'aria-label': 'Document editor'");
  });

  it('derives Share control presence from the rendered rail', () => {
    expect(editorWorkspaceSource).toMatch(/shareControlsPresent={railOpen}/);
  });

  it('keeps the closed mobile Share relationship only while the controlled rail is present', async () => {
    const host = await renderTopBarHarness();
    const share = host.querySelector<HTMLButtonElement>('[data-testid="topbar-share-button"]');
    const togglePresence = host.querySelector<HTMLButtonElement>(
      '[data-testid="toggle-share-control-presence"]',
    );

    expect(share?.getAttribute('aria-expanded')).toBe('false');
    expect(share?.getAttribute('aria-controls')).toBe('lash-rail');
    expect(host.querySelector('#lash-rail')).not.toBeNull();

    await React.act(async () => togglePresence?.click());
    expect(share?.getAttribute('aria-expanded')).toBe('false');
    expect(share?.hasAttribute('aria-controls')).toBe(false);
    expect(host.querySelector('#lash-rail')).toBeNull();
  });

  it('exposes a visibly named mobile Discussion disclosure without claiming Share is open', async () => {
    const host = await renderTopBarHarness();
    const discussion = host.querySelector<HTMLButtonElement>(
      '[data-testid="topbar-discussion-button"]',
    );
    const share = host.querySelector<HTMLButtonElement>('[data-testid="topbar-share-button"]');

    expect(discussion?.textContent).toContain('Discussion');
    expect(discussion?.getAttribute('aria-label')).toBe('Discussion');
    expect(discussion?.getAttribute('aria-controls')).toBe('lash-rail');
    expect(discussion?.getAttribute('aria-expanded')).toBe('false');
    expect(share?.getAttribute('aria-expanded')).toBe('false');

    await React.act(async () => discussion?.click());

    expect(discussion?.getAttribute('aria-expanded')).toBe('true');
    expect(share?.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps mobile rail labels visible and gives Discussion a full touch target', () => {
    expect(globalStylesSource).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.lash-rail-tab-text\s*{\s*display: inline-block;/,
    );
    expect(globalStylesSource).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.lash-discussion-button[\s\S]*?min-height: 44px;/,
    );
  });

  it('offers Focus and Suggest through a keyboard-operable narrow Tools disclosure', async () => {
    const host = await renderTopBarHarness();
    const tools = host.querySelector<HTMLButtonElement>('[data-testid="topbar-mobile-tools"]');

    expect(tools?.getAttribute('aria-label')).toBe('More document tools');
    expect(tools?.getAttribute('aria-expanded')).toBe('false');
    await React.act(async () => tools?.click());

    const focus = host.querySelector<HTMLButtonElement>('[data-testid="mobile-focus-mode-toggle"]');
    const suggest = host.querySelector<HTMLButtonElement>(
      '[data-testid="mobile-suggest-mode-toggle"]',
    );
    expect(tools?.getAttribute('aria-expanded')).toBe('true');
    expect(focus?.textContent).toContain('Focus');
    expect(focus?.getAttribute('aria-pressed')).toBe('false');
    expect(suggest?.textContent).toContain('Suggest wording');
    expect(suggest?.hasAttribute('aria-pressed')).toBe(false);
    expect(focus).toBe(document.activeElement);

    await React.act(async () => suggest?.click());
    expect(host.querySelector('[data-testid="mobile-document-tools-panel"]')).toBeNull();
    expect(
      host.querySelector('[data-testid="topbar-discussion-button"]')?.getAttribute('aria-expanded'),
    ).toBe('true');

    await React.act(async () => tools?.click());
    expect(host.querySelector('[data-testid="mobile-suggest-mode-toggle"]')?.textContent).toContain(
      'Suggest wording',
    );

    await React.act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(host.querySelector('[data-testid="mobile-document-tools-panel"]')).toBeNull();
    expect(tools).toBe(document.activeElement);
  });

  it('closes narrow Tools on outside input and hides an unavailable suggestion action', async () => {
    const host = await renderTopBarHarness();
    const tools = host.querySelector<HTMLButtonElement>('[data-testid="topbar-mobile-tools"]');
    const disableSuggest = host.querySelector<HTMLButtonElement>(
      '[data-testid="toggle-suggest-disabled"]',
    );

    await React.act(async () => disableSuggest?.click());
    await React.act(async () => tools?.click());
    expect(
      host.querySelector<HTMLButtonElement>('[data-testid="mobile-suggest-mode-toggle"]'),
    ).toBeNull();

    await React.act(async () => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(host.querySelector('[data-testid="mobile-document-tools-panel"]')).toBeNull();
    expect(tools).toBe(document.activeElement);
  });

  it('keeps wider Focus and Suggest wording available as separate actions', async () => {
    const host = await renderTopBarHarness('desktop');
    const focus = host.querySelector<HTMLButtonElement>('[data-testid="focus-mode-toggle"]');
    const suggest = host.querySelector<HTMLButtonElement>('[data-testid="suggest-mode-toggle"]');

    expect(focus?.getAttribute('aria-pressed')).toBe('false');
    expect(suggest?.getAttribute('aria-label')).toBe('Suggest wording');
    await React.act(async () => focus?.click());
    await React.act(async () => suggest?.click());
    expect(focus?.getAttribute('aria-pressed')).toBe('true');
    expect(
      host.querySelector('[data-testid="topbar-discussion-button"]')?.getAttribute('aria-expanded'),
    ).toBe('true');
    expect(host.querySelector('[data-testid="mobile-document-tools-panel"]')).toBeNull();
  });

  it('keeps the navigation disclosure state declarative across unrelated rerenders', async () => {
    const host = await renderTopBarHarness();
    const menu = host.querySelector<HTMLButtonElement>('[data-testid="topbar-mobile-menu"]');
    const unrelated = host.querySelector<HTMLButtonElement>(
      '[data-testid="force-unrelated-render"]',
    );

    expect(menu?.getAttribute('aria-expanded')).toBe('false');
    await React.act(async () => menu?.click());
    expect(menu?.getAttribute('aria-expanded')).toBe('true');

    await React.act(async () => unrelated?.click());
    expect(menu?.getAttribute('aria-expanded')).toBe('true');
  });

  it('hides both closed drawers from assistive technology and exposes disclosure state', async () => {
    const host = await renderHarness();
    const sidebar = host.querySelector<HTMLElement>('#lash-sidebar');
    const rail = host.querySelector<HTMLElement>('#lash-rail');
    const menu = host.querySelector<HTMLButtonElement>('[data-testid="topbar-mobile-menu"]');
    const share = host.querySelector<HTMLButtonElement>('[data-testid="topbar-share-button"]');

    expect(sidebar?.hasAttribute('inert')).toBe(true);
    expect(sidebar?.getAttribute('aria-hidden')).toBe('true');
    expect(rail?.hasAttribute('inert')).toBe(true);
    expect(rail?.getAttribute('aria-hidden')).toBe('true');
    expect(menu?.getAttribute('aria-controls')).toBe('lash-sidebar');
    expect(menu?.getAttribute('aria-expanded')).toBe('false');
    expect(share?.getAttribute('aria-controls')).toBe('lash-rail');
    expect(share?.getAttribute('aria-expanded')).toBe('false');
  });

  it('moves and contains focus in navigation, then Escape restores its trigger', async () => {
    const host = await renderHarness();
    const menu = host.querySelector<HTMLButtonElement>('[data-testid="topbar-mobile-menu"]');
    const close = host.querySelector<HTMLButtonElement>('[data-testid="sidebar-mobile-close"]');
    const last = host.querySelector<HTMLButtonElement>('[data-testid="sidebar-last-action"]');
    const topBar = host.querySelector<HTMLElement>('.lash-topbar');
    const canvas = host.querySelector<HTMLElement>('.lash-canvas');

    await React.act(async () => menu?.click());

    expect(menu?.getAttribute('aria-expanded')).toBe('true');
    expect(close).toBe(document.activeElement);
    expect(topBar?.hasAttribute('inert')).toBe(true);
    expect(canvas?.hasAttribute('inert')).toBe(true);

    last?.focus();
    await React.act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    });
    expect(close).toBe(document.activeElement);

    await React.act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(menu?.getAttribute('aria-expanded')).toBe('false');
    expect(menu).toBe(document.activeElement);
  });

  it('opens the activity drawer on its active section and traps reverse Tab', async () => {
    const host = await renderHarness();
    const share = host.querySelector<HTMLButtonElement>('[data-testid="topbar-share-button"]');
    const active = host.querySelector<HTMLButtonElement>('#lash-rail [aria-current="true"]');
    const close = host.querySelector<HTMLButtonElement>(
      '#lash-rail [aria-label="Close activity panel"]',
    );
    const sidebar = host.querySelector<HTMLElement>('#lash-sidebar');

    await React.act(async () => share?.click());

    expect(share?.getAttribute('aria-expanded')).toBe('true');
    expect(active).toBe(document.activeElement);
    expect(sidebar?.hasAttribute('inert')).toBe(true);

    active?.focus();
    await React.act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }));
    });
    expect(close).toBe(document.activeElement);
  });

  it('restores the actual Discussion trigger after Escape', async () => {
    const host = await renderHarness();
    const discussion = host.querySelector<HTMLButtonElement>(
      '[data-testid="topbar-discussion-button"]',
    );
    const share = host.querySelector<HTMLButtonElement>('[data-testid="topbar-share-button"]');

    await React.act(async () => discussion?.click());
    expect(host.querySelector('#lash-rail [aria-current="true"]')?.textContent).toBe('Chat');

    await React.act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(discussion).toBe(document.activeElement);
    expect(share?.disabled).toBe(false);
  });

  it('restores the actual Share trigger after Escape without disabling it', async () => {
    const host = await renderHarness();
    const share = host.querySelector<HTMLButtonElement>('[data-testid="topbar-share-button"]');

    await React.act(async () => share?.click());
    await React.act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(share).toBe(document.activeElement);
    expect(share?.disabled).toBe(false);
  });

  it('restores the actual Discussion trigger after backdrop close', async () => {
    const host = await renderHarness();
    const discussion = host.querySelector<HTMLButtonElement>(
      '[data-testid="topbar-discussion-button"]',
    );
    const backdrop = host.querySelector<HTMLButtonElement>('.lash-app-backdrop');

    await React.act(async () => discussion?.click());
    await React.act(async () => backdrop?.click());
    expect(discussion).toBe(document.activeElement);
  });

  it('lets Show own editor focus without restoring either rail trigger first', async () => {
    const host = await renderHarness();
    const discussion = host.querySelector<HTMLButtonElement>(
      '[data-testid="topbar-discussion-button"]',
    );
    const share = host.querySelector<HTMLButtonElement>('[data-testid="topbar-share-button"]');
    const focusTrace: string[] = [];
    const recordFocus = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.dataset.testid) focusTrace.push(target.dataset.testid);
    };
    document.addEventListener('focusin', recordFocus);

    await React.act(async () => discussion?.click());
    focusTrace.length = 0;
    const show = host.querySelector<HTMLButtonElement>('[data-testid="chat-jump-anchor"]');
    await React.act(async () => show?.click());

    const editor = host.querySelector<HTMLButtonElement>('[data-testid="editor-action"]');
    expect(editor).toBe(document.activeElement);
    expect(focusTrace).not.toContain('topbar-discussion-button');
    expect(focusTrace).not.toContain('topbar-share-button');
    expect(share?.disabled).toBe(false);
    document.removeEventListener('focusin', recordFocus);
  });
});
