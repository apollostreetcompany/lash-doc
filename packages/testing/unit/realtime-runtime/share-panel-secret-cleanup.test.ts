/** @vitest-environment jsdom */

import { createDocumentId } from '@lash/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as ReactRuntime from '../../../../apps/web/node_modules/react';
import { act, createElement } from '../../../../apps/web/node_modules/react';
import { createRoot } from '../../../../apps/web/node_modules/react-dom/client';

declare global {
  interface Window {
    __lashLastInviteLink?: string;
  }
}

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
(globalThis as typeof globalThis & { React: typeof ReactRuntime }).React = ReactRuntime;

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');

const createMemoryStorage = (): Storage => {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
};

describe('share-panel bearer cleanup', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: createMemoryStorage(),
    });
  });

  afterEach(() => {
    delete window.__lashLastInviteLink;
    window.localStorage.clear();
    document.body.replaceChildren();
    if (originalLocalStorageDescriptor) {
      Object.defineProperty(window, 'localStorage', originalLocalStorageDescriptor);
    } else {
      Reflect.deleteProperty(window, 'localStorage');
    }
  });

  it('removes the test-only invite bearer when an authorized panel unmounts', async () => {
    const { SharePanel } = await import('../../../../apps/web/components/editor/panels/SharePanel');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    window.__lashLastInviteLink = 'private-invite-link';

    await act(async () => {
      root.render(
        createElement(SharePanel, {
          authorized: true,
          allowsInviteIssuance: () => true,
          canIssueInvites: true,
          canMutateDocument: true,
          captureInviteIssuance: () => ({
            authoritativeOwner: true,
            controllerGeneration: 1,
            documentId: 'fixture-document',
            issuanceEpoch: 1,
            scope: 'edit',
          }),
          docId: createDocumentId('fixture-document'),
          editor: null,
          exposeInviteTestHook: true,
          hydrated: true,
          runtimeMode: 'development-loopback',
        }),
      );
    });
    expect(window.__lashLastInviteLink).toBe('private-invite-link');

    await act(async () => {
      root.unmount();
    });

    expect(window.__lashLastInviteLink).toBeUndefined();
  });

  it('publishes no legacy signer success or durable invite after its ticket is revoked', async () => {
    const { SharePanel } = await import('../../../../apps/web/components/editor/panels/SharePanel');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let allowed = true;
    const ticket = {
      authoritativeOwner: true as const,
      controllerGeneration: 1,
      documentId: 'fixture-document',
      issuanceEpoch: 1,
      scope: 'edit' as const,
    };
    const allowsInviteIssuance = vi.fn(() => allowed);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    await act(async () => {
      root.render(
        createElement(SharePanel, {
          authorized: true,
          allowsInviteIssuance,
          canIssueInvites: true,
          canMutateDocument: true,
          captureInviteIssuance: () => ticket,
          docId: createDocumentId('fixture-document'),
          editor: null,
          exposeInviteTestHook: true,
          hydrated: true,
          runtimeMode: 'development-loopback',
        }),
      );
    });

    const legacyLink = host.querySelector<HTMLButtonElement>('[data-testid="share-create-edit"]');
    expect(legacyLink).not.toBeNull();
    await act(async () => {
      legacyLink?.click();
      allowed = false;
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(host.querySelector('[data-testid="share-validation"]')?.textContent).toBe(
      'No link created',
    );
    expect(host.querySelector('[data-testid="share-audit-count"]')?.textContent).toBe(
      '0 audit events',
    );
    expect(window.__lashLastInviteLink).toBeUndefined();
    expect(window.localStorage.getItem('lash:invite-records:v1')).toBeNull();

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="invite-create"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(writeText).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="invite-copy-status"]')?.textContent).toBe(
      'No invite copied',
    );
    expect(window.__lashLastInviteLink).toBeUndefined();
    expect(window.localStorage.getItem('lash:invite-records:v1')).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
