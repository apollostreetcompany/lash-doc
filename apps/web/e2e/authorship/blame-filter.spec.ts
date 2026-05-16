import { expect, test } from '@playwright/test';

test('blame-filter', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('Filter attribution');

  await expect(page.getByTestId('history-version').first()).toBeVisible();
  await page.getByTestId('blame-line').first().click();
  await expect(page.getByTestId('history-filter-author')).toContainText('local-user');
  await expect(page.getByTestId('history-filtered-counts')).toContainText(/matching versions?/);
  await expect(page.getByTestId('history-version').first()).toBeVisible();
});
