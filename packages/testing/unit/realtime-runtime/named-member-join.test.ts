/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NamedMemberJoinClient,
  type NamedMemberJoinDependencies,
} from '../../../../apps/web/app/join/[roomId]/NamedMemberJoinClient';
import * as React from '../../../../apps/web/node_modules/react';
import { createRoot, type Root } from '../../../../apps/web/node_modules/react-dom/client';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const roomId = `doc-v1-${'a'.repeat(64)}`;
const token = 'b'.repeat(43);
const joinPath = `/join/${roomId}`;
const inviteLink = `${joinPath}#invite=${token}`;

const roots: Root[] = [];
const render = async (dependencies?: NamedMemberJoinDependencies, id: string | null = roomId) => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await React.act(async () =>
    root.render(
      React.createElement(
        React.StrictMode,
        null,
        React.createElement(NamedMemberJoinClient, { roomId: id, dependencies }),
      ),
    ),
  );
  return host;
};

afterEach(async () => {
  while (roots.length) {
    const root = roots.pop();
    await React.act(async () => root?.unmount());
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/');
});

describe('named edit invitation join UI', () => {
  it('scrubs the fragment before posting and offers a bearer-free account sign-in', async () => {
    window.history.replaceState(null, '', inviteLink);
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const accept = vi.fn<
      Parameters<NamedMemberJoinDependencies['accept']>,
      ReturnType<NamedMemberJoinDependencies['accept']>
    >(async () => {
      expect(window.location.hash).toBe('');
      expect(window.location.pathname).toBe(joinPath);
      return 'sign-in-required';
    });
    const openDocument = vi.fn();
    const host = await render({ accept, openDocument });

    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept).toHaveBeenCalledWith(roomId, token, expect.any(AbortSignal));
    expect(host.textContent).toContain('Sign in to accept');
    expect(host.querySelector('a')?.getAttribute('href')).toBe(
      `/auth/sign-in?next=${encodeURIComponent(joinPath)}`,
    );
    expect(host.innerHTML).not.toContain(token);
    expect(storage).not.toHaveBeenCalled();
    expect(openDocument).not.toHaveBeenCalled();
  });

  it('resumes through the server after sign-in and opens the canonical document on acceptance', async () => {
    window.history.replaceState(null, '', joinPath);
    const accept = vi.fn().mockResolvedValue('accepted');
    const openDocument = vi.fn();
    await render({ accept, openDocument });

    expect(accept).toHaveBeenCalledWith(roomId, null, expect.any(AbortSignal));
    expect(openDocument).toHaveBeenCalledTimes(1);
    expect(openDocument).toHaveBeenCalledWith(`/doc/${roomId}`);
  });

  it('does not post until browser readback confirms the credential has been scrubbed', async () => {
    window.history.replaceState(null, '', inviteLink);
    const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
    const accept = vi.fn().mockResolvedValue('sign-in-required');
    const host = await render({ accept, openDocument: vi.fn() });

    expect(accept).not.toHaveBeenCalled();
    expect(window.location.hash).toBe(`#invite=${token}`);
    expect(host.textContent).toContain('Try again');

    replaceState.mockRestore();
    await React.act(async () => host.querySelector('button')?.click());

    expect(window.location.hash).toBe('');
    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept).toHaveBeenCalledWith(roomId, token, expect.any(AbortSignal));
  });

  it('scrubs a malformed invite without trying to redeem a pending cookie', async () => {
    window.history.replaceState(null, '', `${inviteLink}&invite=${token}`);
    const accept = vi.fn();
    const openDocument = vi.fn();
    const host = await render({ accept, openDocument });

    expect(window.location.hash).toBe('');
    expect(accept).not.toHaveBeenCalled();
    expect(openDocument).not.toHaveBeenCalled();
    expect(host.textContent).toContain('This invitation isn’t available.');
  });

  it('removes a fragment on an invalid path without an access request', async () => {
    window.history.replaceState(null, '', `/join/wrong#invite=${token}`);
    const accept = vi.fn();
    const host = await render({ accept, openDocument: vi.fn() }, null);

    expect(window.location.hash).toBe('');
    expect(accept).not.toHaveBeenCalled();
    expect(host.textContent).toContain('This invitation isn’t available.');
  });

  it('uses the scrubbed same-origin POST contract with browser fetch unbound', async () => {
    window.history.replaceState(null, '', inviteLink);
    const request = vi.fn(function (this: unknown) {
      expect(this).toBeUndefined();
      expect(window.location.hash).toBe('');
      return Promise.resolve(
        Response.json({ version: 1, ok: false, error: 'sign-in-required' }, { status: 401 }),
      );
    });
    vi.stubGlobal('fetch', request);

    const host = await render();

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      `/api/documents/${roomId}/named-edit/session`,
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'error',
        referrerPolicy: 'origin',
        body: JSON.stringify({ version: 1, token, accept: true }),
      }),
    );
    expect(host.textContent).toContain('Sign in to accept');
  });

  it('retries a transient failure with the scrubbed credential and shows generic remote denial', async () => {
    window.history.replaceState(null, '', inviteLink);
    const accept = vi.fn().mockResolvedValueOnce('retry').mockResolvedValueOnce('unavailable');
    const openDocument = vi.fn();
    const host = await render({ accept, openDocument });

    expect(host.textContent).toContain('Try again');
    await React.act(async () => host.querySelector('button')?.click());

    expect(accept).toHaveBeenCalledTimes(2);
    for (const call of accept.mock.calls) {
      expect(call).toEqual([roomId, token, expect.any(AbortSignal)]);
    }
    expect(host.textContent).toContain('This invitation isn’t available.');
    expect(host.innerHTML).not.toContain(token);
    expect(openDocument).not.toHaveBeenCalled();
  });
});
