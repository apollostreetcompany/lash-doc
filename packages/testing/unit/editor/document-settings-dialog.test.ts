/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentSettingsDialog } from '../../../../apps/web/components/editor/panels/DocumentSettingsDialog';
import { ownerShareAccessSummary } from '../../../../apps/web/components/editor/panels/OwnerShareDialog';
import * as React from '../../../../apps/web/node_modules/react';
import { createRoot, type Root } from '../../../../apps/web/node_modules/react-dom/client';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const roots: Root[] = [];
const ROOM_ID = `doc-v1-${'c'.repeat(64)}`;

const render = async (node: React.ReactNode) => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await React.act(async () => root.render(node));
  return host;
};

beforeEach(() => {
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value() {
      this.removeAttribute('open');
    },
  });
  Object.defineProperty(window, 'crypto', {
    configurable: true,
    value: { randomUUID: () => '123e4567-e89b-42d3-a456-426614174000' },
  });
});

afterEach(async () => {
  while (roots.length) {
    const root = roots.pop();
    await React.act(async () => root?.unmount());
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Document settings', () => {
  it('keeps the Share status truthful for each authoritative public mode', () => {
    const state = {
      policyVersion: 3,
      cutoffGeneration: 2,
      publicUrl: `http://localhost:3000/public/${ROOM_ID}`,
    };
    expect(ownerShareAccessSummary({ ...state, mode: 'restricted', publicUrl: null })).toBe(
      'Only people you invite have access.',
    );
    expect(ownerShareAccessSummary({ ...state, mode: 'read' })).toBe(
      'Anyone with the link can read this document.',
    );
    expect(ownerShareAccessSummary({ ...state, mode: 'comment' })).toBe(
      'Anyone with the link can read. Sign-in is required to comment.',
    );
  });

  it('shows exactly Restricted, public Read, and public Comment with no public Edit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ok: true,
          version: 1,
          state: {
            mode: 'comment',
            policyVersion: 3,
            cutoffGeneration: 2,
            publicUrl: `http://localhost:3000/public/${ROOM_ID}`,
          },
        }),
      ),
    );
    const host = await render(
      React.createElement(DocumentSettingsDialog, {
        localDocumentId: 'fresh-account-handoff',
        onClose: vi.fn(),
        onUpdated: vi.fn(),
        open: true,
        ownerBacked: true,
        returnFocusTo: null,
        signInHref: '/auth/sign-in?next=%2Fdoc%2Ffresh-account-handoff',
      }),
    );
    await React.act(async () => undefined);

    expect(host.textContent).toContain('Document settings');
    expect(host.textContent).toContain('Restricted');
    expect(host.textContent).toContain('Anyone with the link · Can read');
    expect(host.textContent).toContain('Anyone with the link · Can comment');
    expect(host.textContent).toContain('Sign-in is required to post');
    expect(host.querySelectorAll('input[type="radio"]')).toHaveLength(3);
    expect(host.querySelector('input[value="edit"]')).toBeNull();
    expect(host.textContent).not.toContain('Can edit');
    const selected = host.querySelector<HTMLInputElement>('input[value="comment"]');
    expect(selected?.checked).toBe(true);
    expect(document.activeElement).toBe(selected);
  });

  it('blocks public-link modes and still lets the owner switch to Restricted', async () => {
    const state = {
      mode: 'read' as const,
      policyVersion: 3,
      cutoffGeneration: 2,
      publicUrl: null,
      publicProjectionBlocked: true as const,
    };
    const restricted = { ...state, mode: 'restricted', policyVersion: 4 };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ok: true, version: 1, state }))
      .mockResolvedValueOnce(
        Response.json({ ok: true, version: 1, state: restricted, changed: true }),
      );
    vi.stubGlobal('fetch', fetcher);
    const onUpdated = vi.fn();
    const host = await render(
      React.createElement(DocumentSettingsDialog, {
        localDocumentId: 'fresh-account-handoff',
        onClose: vi.fn(),
        onUpdated,
        open: true,
        ownerBacked: true,
        returnFocusTo: null,
        signInHref: '/auth/sign-in',
      }),
    );
    expect(ownerShareAccessSummary(state)).toMatch(/private references or metadata/iu);
    expect(host.textContent).toMatch(/People you['’]ve invited still have access/u);
    for (const mode of ['read', 'comment']) {
      expect(host.querySelector<HTMLInputElement>(`input[value="${mode}"]`)?.disabled).toBe(true);
    }
    const restrictedInput = host.querySelector<HTMLInputElement>('input[value="restricted"]');
    expect(restrictedInput?.disabled).toBe(false);
    expect(restrictedInput?.checked).toBe(true);
    const save = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save settings',
    );
    expect(save?.disabled).toBe(false);
    await React.act(async () => save?.click());
    expect(onUpdated).toHaveBeenCalledWith(restricted);
    expect(JSON.parse(fetcher.mock.calls[1]?.[1].body)).toMatchObject({ mode: 'restricted' });
  });

  it('publishes success only after PATCH returns the authoritative readback', async () => {
    let resolvePatch!: (response: Response) => void;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          version: 1,
          state: {
            mode: 'restricted',
            policyVersion: 1,
            cutoffGeneration: 0,
            publicUrl: null,
          },
        }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolvePatch = resolve;
          }),
      );
    vi.stubGlobal('fetch', fetcher);
    const onClose = vi.fn();
    const onUpdated = vi.fn();
    const host = await render(
      React.createElement(DocumentSettingsDialog, {
        localDocumentId: 'fresh-account-handoff',
        onClose,
        onUpdated,
        open: true,
        ownerBacked: true,
        returnFocusTo: null,
        signInHref: '/auth/sign-in',
      }),
    );
    await React.act(async () => undefined);
    const comment = host.querySelector<HTMLInputElement>('input[value="comment"]');
    await React.act(async () => comment?.click());
    const save = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Save settings',
    );
    await React.act(async () => save?.click());

    expect(host.textContent).toContain('Saving…');
    expect(onUpdated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    await React.act(async () =>
      resolvePatch(
        Response.json({
          ok: true,
          version: 1,
          changed: true,
          state: {
            mode: 'comment',
            policyVersion: 2,
            cutoffGeneration: 1,
            publicUrl: `http://localhost:3000/public/${ROOM_ID}`,
          },
        }),
      ),
    );
    expect(onUpdated).toHaveBeenCalledWith({
      mode: 'comment',
      policyVersion: 2,
      cutoffGeneration: 1,
      publicUrl: `http://localhost:3000/public/${ROOM_ID}`,
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('warns that retained public comments return before re-enabling Comment access', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ok: true,
          version: 1,
          state: {
            mode: 'read',
            policyVersion: 4,
            cutoffGeneration: 3,
            publicUrl: `http://localhost:3000/public/${ROOM_ID}`,
          },
        }),
      ),
    );
    const host = await render(
      React.createElement(DocumentSettingsDialog, {
        localDocumentId: 'fresh-account-handoff',
        onClose: vi.fn(),
        onUpdated: vi.fn(),
        open: true,
        ownerBacked: true,
        returnFocusTo: null,
        signInHref: '/auth/sign-in',
      }),
    );
    await React.act(async () => undefined);
    await React.act(async () =>
      host.querySelector<HTMLInputElement>('input[value="comment"]')?.click(),
    );
    expect(host.textContent).toContain(
      'Any previously posted public comments will be visible again.',
    );
  });

  it('lets the account owner remove a public comment from active Comment settings', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          version: 1,
          state: {
            mode: 'comment',
            policyVersion: 4,
            cutoffGeneration: 3,
            publicUrl: `http://localhost:3000/public/${ROOM_ID}`,
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          version: 1,
          authorization: {
            roomId: ROOM_ID,
            mode: 'comment',
            policyVersion: 4,
            cutoffGeneration: 3,
          },
          comments: [
            {
              id: 'pc-v1-12345678-1234-4123-8123-123456789abc',
              sequence: 1,
              anchor: { kind: 'document' },
              body: 'Could we add the launch date?',
              author: { label: 'Commenter Ab3_xQ' },
              createdAt: '2026-07-30T12:34:56.789Z',
            },
          ],
          nextBeforeSequence: null,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          version: 1,
          commentId: 'pc-v1-12345678-1234-4123-8123-123456789abc',
          state: 'hidden',
          changed: true,
          policyVersion: 4,
          cutoffGeneration: 3,
          moderatedAt: '2026-07-30T12:35:56.789Z',
        }),
      );
    vi.stubGlobal('fetch', fetcher);
    const host = await render(
      React.createElement(DocumentSettingsDialog, {
        localDocumentId: 'fresh-account-handoff',
        onClose: vi.fn(),
        onUpdated: vi.fn(),
        open: true,
        ownerBacked: true,
        returnFocusTo: null,
        signInHref: '/auth/sign-in',
      }),
    );
    await React.act(async () => undefined);
    expect(host.textContent).toContain('Manage public comments');
    expect(host.textContent).toContain('Could we add the launch date?');
    const remove = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Remove',
    );
    await React.act(async () => remove?.click());
    expect(fetcher).toHaveBeenLastCalledWith(
      '/api/documents/fresh-account-handoff/public-comments/pc-v1-12345678-1234-4123-8123-123456789abc/hide',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(host.textContent).not.toContain('Could we add the launch date?');
    expect(host.textContent).toContain('Comment removed.');
  });
});
