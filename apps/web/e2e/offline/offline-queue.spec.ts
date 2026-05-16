import { expect, test, type Page } from '@playwright/test';

const ready = async (page: Page) =>
  page.waitForFunction(() =>
    Boolean(
      (window as unknown as { __lashEditor?: unknown; __lashOffline?: unknown }).__lashEditor &&
        (window as unknown as { __lashEditor?: unknown; __lashOffline?: unknown }).__lashOffline,
    ),
  );

test('offline-queue', async ({ page }) => {
  await page.goto('/');
  await ready(page);

  await page.getByTestId('offline-disconnect').click();
  await expect(page.getByTestId('offline-status')).toHaveText('Offline');

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('Queued while offline');

  await expect(page.getByTestId('offline-queue-depth')).toContainText(/Queue: [1-9][0-9]*/);
  await expect(page.getByTestId('offline-merge-status')).toContainText('Merged: none');
});
