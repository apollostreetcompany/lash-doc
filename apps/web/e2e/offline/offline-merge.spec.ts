import { expect, test, type Page } from '@playwright/test';

const ready = async (page: Page) =>
  page.waitForFunction(() =>
    Boolean(
      (window as unknown as { __lashEditor?: unknown; __lashOffline?: unknown }).__lashEditor &&
        (window as unknown as { __lashEditor?: unknown; __lashOffline?: unknown }).__lashOffline,
    ),
  );

test('offline-merge', async ({ page }) => {
  await page.goto('/');
  await ready(page);

  await page.getByTestId('offline-disconnect').click();
  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('Offline draft');
  await expect(page.getByTestId('offline-queue-depth')).toContainText(/Queue: [1-9][0-9]*/);

  await page.getByTestId('offline-reconnect').click();

  await expect(page.getByTestId('offline-status')).toHaveText('Online');
  await expect(page.getByTestId('offline-queue-depth')).toHaveText('Queue: 0');
  await expect(page.getByTestId('offline-merge-status')).toContainText('Offline draft');
  await expect(page.getByTestId('lash-editor-content')).toContainText('Offline draft');
});
