import { expect, test, type Page } from '@playwright/test';

import { latestSignInLink } from './mailpit';

interface RedactedCallbackResult {
  destination: string | null;
  status: number;
}

const exchangeCallbackWithoutNavigation = async (
  page: Page,
  callbackUrl: string,
): Promise<RedactedCallbackResult> =>
  page.evaluate(async (rawCallbackUrl) => {
    try {
      const callback = new URL(rawCallbackUrl);
      if (callback.origin !== window.location.origin) {
        return { destination: null, status: 0 };
      }
      const response = await fetch(callback, {
        credentials: 'include',
        redirect: 'follow',
      });
      const destination = new URL(response.url);
      if (destination.origin !== window.location.origin) {
        return { destination: null, status: 0 };
      }
      return {
        destination: `${destination.pathname}${destination.search}`,
        status: response.status,
      };
    } catch {
      return { destination: null, status: 0 };
    }
  }, callbackUrl);

test.describe('real local Supabase account callback', () => {
  test('email link is browser-bound and returns a server-derived account session', async ({
    browser,
    page,
  }) => {
    const documentId = `auth-callback-${crypto.randomUUID()}`;
    const email = `lash-${crypto.randomUUID()}@example.test`;
    const documentPath = `/doc/${documentId}`;

    await page.goto(`/auth/sign-in?next=${encodeURIComponent(documentPath)}`);
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(
      page.getByRole('heading', { name: 'Your sign-in link is on its way' }),
    ).toBeVisible();

    let signInLink: string | null = null;
    await expect
      .poll(async () => {
        signInLink = await latestSignInLink(email);
        return signInLink;
      })
      .not.toBeNull();

    if (!signInLink) {
      throw new Error('Mailpit did not return the expected sign-in link.');
    }

    const cleanContext = await browser.newContext();
    const cleanPage = await cleanContext.newPage();
    await cleanPage.goto(`/auth/check-email?next=${encodeURIComponent(documentPath)}`);
    const cleanCallback = await exchangeCallbackWithoutNavigation(cleanPage, signInLink);
    expect(cleanCallback.status).toBe(200);
    expect(cleanCallback.destination).toMatch(/^\/auth\/sign-in\?/u);
    await cleanPage.goto(cleanCallback.destination ?? '/auth/sign-in');
    await expect(cleanPage).toHaveURL(/\/auth\/sign-in/u);
    await expect(
      cleanPage.getByRole('alert').filter({ hasText: 'The sign-in link could not be verified' }),
    ).toBeVisible();
    const cleanSession = await cleanContext.request.get('/api/account/session');
    expect(cleanSession.status()).toBe(401);
    expect(await cleanSession.json()).toMatchObject({
      authenticated: false,
    });
    await cleanContext.close();

    const initiatingCallback = await exchangeCallbackWithoutNavigation(page, signInLink);
    expect(initiatingCallback).toEqual({ destination: documentPath, status: 200 });
    await page.goto(initiatingCallback.destination ?? documentPath);

    await expect(page).toHaveURL(new RegExp(`${documentPath}$`, 'u'));
    await expect(page.getByLabel('Document title')).toBeVisible();
    await expect(page.getByTestId('lash-editor-content')).toBeVisible();
    const accountSession = await page.context().request.get('/api/account/session');
    expect(accountSession.status()).toBe(204);
    expect(accountSession.headers()['x-lash-account-status']).toBe('authenticated');
    expect(accountSession.headers()['x-lash-principal-id']).toMatch(/^account:v1:[A-Za-z0-9_-]+$/u);
  });
});
