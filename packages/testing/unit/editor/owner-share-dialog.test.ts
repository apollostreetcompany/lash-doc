/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OwnerShareDialog,
  type OwnerShareDialogProps,
} from '../../../../apps/web/components/editor/panels/OwnerShareDialog';
import { TopBar } from '../../../../apps/web/components/shell/TopBar';
import * as React from '../../../../apps/web/node_modules/react';
import { createRoot, type Root } from '../../../../apps/web/node_modules/react-dom/client';

const roots: Root[] = [];

const props = (overrides: Partial<OwnerShareDialogProps> = {}): OwnerShareDialogProps => ({
  adjuncts: { comments: 0, suggestions: 0 },
  documentTitle: 'Launch notes',
  onClose: vi.fn(),
  onPrimary: vi.fn(),
  open: true,
  phase: 'checking-account',
  signInHref: '/auth/sign-in?next=%2Fdoc%2Flaunch-notes',
  ...overrides,
});

const render = async (node: React.ReactNode) => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const rerender = (next: React.ReactNode) => React.act(async () => root.render(next));
  await rerender(node);
  return { host, rerender };
};

const button = (host: HTMLElement, text: string) =>
  Array.from(host.querySelectorAll('button')).find((element) => element.textContent === text);

beforeEach(() => {
  vi.stubGlobal('React', React);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(Date.now()), 0),
  );
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});

afterEach(async () => {
  while (roots.length) {
    const root = roots.pop();
    await React.act(async () => root?.unmount());
  }
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('owner Share dialog', () => {
  it('keeps account saves disabled pending the verified account state', async () => {
    const input = props();
    const { host, rerender } = await render(React.createElement(OwnerShareDialog, input));
    const dialog = host.querySelector('dialog');
    expect(dialog?.open).toBe(true);
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(host.textContent).toContain('Share “Launch notes”');
    expect(host.textContent).toContain('Checking account…');
    expect(button(host, 'Save to my account')?.disabled).toBe(true);
    expect(input.onPrimary).not.toHaveBeenCalled();

    await rerender(React.createElement(OwnerShareDialog, { ...input, phase: 'ready' }));
    expect(host.textContent).toContain('This document is only on this device.');
    expect(button(host, 'Save to my account')?.disabled).toBe(false);
    await React.act(async () => button(host, 'Save to my account')?.click());
    expect(input.onPrimary).toHaveBeenCalledTimes(1);
  });

  it('links an encoded local continuation before enabling account saving', async () => {
    const { host } = await render(
      React.createElement(OwnerShareDialog, props({ phase: 'signed-out' })),
    );
    const signIn = host.querySelector('a');
    expect(signIn?.textContent).toBe('Sign in to continue');
    expect(signIn?.getAttribute('href')).toBe('/auth/sign-in?next=%2Fdoc%2Flaunch-notes');
    expect(button(host, 'Save to my account')).toBeUndefined();
  });

  it('discloses the adjunct inventory and renders no save action when promotion is blocked', async () => {
    const input = props({ phase: 'blocked', adjuncts: { comments: 2, suggestions: 1 } });
    const { host } = await render(React.createElement(OwnerShareDialog, input));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      '2 comments and 1 suggestion',
    );
    expect(host.textContent).toContain('nothing was moved.');
    expect(button(host, 'Save to my account')).toBeUndefined();
    expect(input.onPrimary).not.toHaveBeenCalled();
  });

  it('handles pending, retry and confirmed owner state without implying a public grant', async () => {
    const input = props({ phase: 'saving' });
    const { host, rerender } = await render(React.createElement(OwnerShareDialog, input));
    expect(button(host, 'Saving to your account…')?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Close sharing"]')?.disabled).toBe(
      true,
    );
    await rerender(React.createElement(OwnerShareDialog, { ...input, phase: 'retryable' }));
    expect(host.textContent).toContain('Your document is still on this device.');
    await React.act(async () => button(host, 'Try again')?.click());
    expect(input.onPrimary).toHaveBeenCalledTimes(1);
    await rerender(React.createElement(OwnerShareDialog, { ...input, phase: 'saved' }));
    expect(host.textContent).toContain('Saved to your account');
    expect(button(host, 'Done')).toBeDefined();
    expect(button(host, 'Copy link')).toBeUndefined();
    expect(button(host, 'Create invite link')).toBeUndefined();
  });

  it('keeps named invites available while hiding a blocked public copy action', async () => {
    const roomId = `doc-v1-${'a'.repeat(64)}`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ok: true, version: 1, invites: [] })),
    );
    const { host } = await render(
      React.createElement(
        OwnerShareDialog,
        props({
          phase: 'saved',
          namedEditRoomId: roomId,
          onManagePublicAccess: vi.fn(),
          publicAccess: {
            mode: 'read',
            publicUrl: null,
            publicProjectionBlocked: true,
            policyVersion: 2,
            cutoffGeneration: 1,
          },
        }),
      ),
    );
    expect(host.textContent).toContain('Public links unavailable');
    expect(host.textContent).toContain('People with access');
    expect(button(host, 'Create invite link')).toBeDefined();
    expect(button(host, 'Copy link')).toBeUndefined();
  });

  it('handles native dialog cancellation and prevents dismissal during a save', async () => {
    const input = props({ phase: 'saving' });
    const { host, rerender } = await render(React.createElement(OwnerShareDialog, input));
    const dialog = host.querySelector('dialog');
    const cancel = () =>
      dialog?.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true }));
    await React.act(async () => {
      expect(cancel()).toBe(false);
    });
    expect(input.onClose).not.toHaveBeenCalled();
    await rerender(React.createElement(OwnerShareDialog, { ...input, phase: 'ready' }));
    await React.act(async () => {
      expect(cancel()).toBe(false);
    });
    expect(input.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('top-bar Share disclosure', () => {
  it('advertises the dialog only when relevant and omits owner controls for named members', async () => {
    const props = {
      focusMode: false,
      mobileSidebarExpanded: false,
      shareExpanded: true,
      shareControlsPresent: true,
      shareControlsId: 'lash-owner-share-dialog' as const,
      shareHasPopup: 'dialog' as const,
      onToggleFocusMode: vi.fn(),
    };
    const { host, rerender } = await render(
      React.createElement(TopBar, { ...props, onShareClick: vi.fn() }),
    );
    const share = () =>
      host.querySelector<HTMLButtonElement>('button[aria-label="Share document"]');
    expect(share()?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(share()?.getAttribute('aria-expanded')).toBe('true');
    expect(share()?.getAttribute('aria-controls')).toBe('lash-owner-share-dialog');

    await rerender(
      React.createElement(TopBar, { ...props, shareExpanded: false, onShareClick: vi.fn() }),
    );
    expect(share()?.getAttribute('aria-expanded')).toBe('false');
    expect(share()?.getAttribute('aria-controls')).toBeNull();
    await rerender(React.createElement(TopBar, props));
    expect(share()).toBeNull();
  });
});
