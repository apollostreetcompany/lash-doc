import { expect, test, type Page } from '@playwright/test';

const ready = async (page: Page) =>
  page.waitForFunction(() =>
    Boolean(
      (window as unknown as { __lashEditor?: unknown; __lashOffline?: unknown }).__lashEditor &&
        (window as unknown as { __lashEditor?: unknown; __lashOffline?: unknown }).__lashOffline,
    ),
  );

test('presence-resume', async ({ page }) => {
  await page.goto('/');
  await ready(page);

  await expect(page.getByTestId('presence-status')).toHaveText('Presence active');
  await page.getByTestId('offline-disconnect').click();
  await expect(page.getByTestId('presence-status')).toHaveText('Presence paused');

  await page.getByTestId('offline-reconnect').click();
  await expect(page.getByTestId('presence-status')).toHaveText('Presence active');
});
