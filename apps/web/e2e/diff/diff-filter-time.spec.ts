import { expect, test } from '@playwright/test';

test('diff-filter-time', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('Recent diff');

  await expect(page.getByTestId('history-version')).toHaveCount(1);
  await page.getByTestId('history-time-filter-last-7-days').click();

  await expect(page.getByTestId('history-filter-time')).toContainText('last 7 days');
  await expect(page.getByTestId('history-filtered-counts')).toContainText('1 matching version');
});
