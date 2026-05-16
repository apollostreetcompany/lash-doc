import { expect, test } from '@playwright/test';

test('diff-share-link', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('Share filtered diff');

  await expect(page.getByTestId('history-version')).toHaveCount(1);
  await page.getByTestId('history-author-filter').first().click();
  await page.getByTestId('history-time-filter-last-7-days').click();
  await page.getByTestId('history-filter-copy-link').click();

  await page.waitForFunction(
    () =>
      (window as unknown as { __lashLastHistoryFilterLink?: string }).__lashLastHistoryFilterLink,
  );
  const link = await page.evaluate(
    () =>
      (window as unknown as { __lashLastHistoryFilterLink?: string }).__lashLastHistoryFilterLink ??
      '',
  );
  expect(link).toContain('historyAuthor=local-user');
  expect(link).toContain('historyTime=last-7-days');
});
