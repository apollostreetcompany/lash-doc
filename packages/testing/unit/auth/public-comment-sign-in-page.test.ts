/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';

const providerState = vi.hoisted(() => ({ configured: true }));

vi.mock('../../../../apps/web/lib/auth/config', () => ({
  loadSupabaseAuthConfig: () =>
    providerState.configured
      ? {
          status: 'configured',
          config: {
            issuer: 'https://project.supabase.co/auth/v1',
            publishableKey: 'publishable-key',
            siteOrigin: 'https://lash.example',
            url: 'https://project.supabase.co',
          },
        }
      : { status: 'unavailable' },
}));

import SignInPage from '../../../../apps/web/app/auth/sign-in/page';
import { renderToStaticMarkup } from '../../../../apps/web/node_modules/react-dom/server';

const ROOM_ID = `doc-v1-${'a'.repeat(64)}`;
const PUBLIC_PATH = `/public/${ROOM_ID}`;

const returnPath = (markup: string) =>
  new DOMParser()
    .parseFromString(markup, 'text/html')
    .querySelector('input[type="hidden"][name="next"]')
    ?.getAttribute('value');

afterEach(() => {
  providerState.configured = true;
});

describe('public comment sign-in page', () => {
  it('truthfully frames a public return as comment sign-in and preserves the exact next path', async () => {
    const markup = renderToStaticMarkup(
      await SignInPage({
        searchParams: Promise.resolve({ next: PUBLIC_PATH }),
      }),
    );

    expect(markup).toContain('Sign in to comment');
    expect(markup).toContain('return to this public document');
    expect(returnPath(markup)).toBe(PUBLIC_PATH);
    expect(markup).not.toContain('Your account owns shared documents');
  });

  it('keeps the existing owner/share document copy and query-bearing next path', async () => {
    const markup = renderToStaticMarkup(
      await SignInPage({
        searchParams: Promise.resolve({ next: '/doc/weekly-plan?realtime=on' }),
      }),
    );

    expect(markup).toContain('Sign in to share this document');
    expect(markup).toContain('Your account owns shared documents');
    expect(returnPath(markup)).toBe('/doc/weekly-plan?realtime=on');
  });

  it('keeps malformed public returns generic and does not render the email form', async () => {
    const markup = renderToStaticMarkup(
      await SignInPage({
        searchParams: Promise.resolve({ next: `${PUBLIC_PATH}?thread=forged` }),
      }),
    );

    expect(markup).toContain('This sign-in link does not point to a valid Lash document.');
    expect(markup).not.toContain('name="email"');
    expect(markup).not.toContain(ROOM_ID);
  });

  it('does not describe a public document as a local draft when sign-in is unavailable', async () => {
    providerState.configured = false;
    const markup = renderToStaticMarkup(
      await SignInPage({
        searchParams: Promise.resolve({ next: PUBLIC_PATH }),
      }),
    );

    expect(markup).toContain('You can still return to the public document.');
    expect(markup).not.toContain('Your local document is still available.');
  });
});
