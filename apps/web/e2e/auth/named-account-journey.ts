import { expect, type Page } from '@playwright/test';

import { latestSignInLink } from './mailpit';

export function parseCredentialLink(raw: string, origin: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Expected a valid credential link.');
  }
  if (url.origin !== origin || url.username || url.password) {
    throw new Error('The credential link did not belong to the configured local Lash site.');
  }
  return url;
}

// Keep credential values out of Playwright navigation logs.
export async function openCredentialLink(page: Page, link: URL) {
  await page.evaluate((href) => window.location.replace(href), link.href);
}

export async function waitForPath(page: Page, path: string) {
  await expect
    .poll(
      () => {
        const url = new URL(page.url());
        return url.pathname === path && !url.search && !url.hash;
      },
      { timeout: 25_000 },
    )
    .toBe(true);
}

export async function signIn(page: Page, email: string, origin: string, callbackPage: Page = page) {
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your sign-in link is on its way' }),
  ).toBeVisible();
  let rawLink: string | null = null;
  await expect
    .poll(
      async () => {
        rawLink = await latestSignInLink(email);
        return rawLink !== null;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  if (rawLink === null) throw new Error('No sign-in link arrived in Mailpit.');
  const link = parseCredentialLink(rawLink, origin);
  expect(link.pathname).toBe('/auth/confirm');
  await openCredentialLink(callbackPage, link);
}
