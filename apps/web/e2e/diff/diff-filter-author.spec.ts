import { expect, test } from '@playwright/test';

test('diff-filter-author', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('Author-filtered diff');

  await expect(page.getByTestId('history-version')).toHaveCount(1);
  await page.getByTestId('history-author-filter').first().click();

  await expect(page.getByTestId('history-filter-author')).toContainText('local-user');
  await expect(page.getByTestId('history-filtered-counts')).toContainText(/matching versions?/);
  await expect(page.getByTestId('history-diff-insert')).toHaveAttribute(
    'data-author-id',
    'local-user',
  );
});
