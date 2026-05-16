import { expect, test } from '@playwright/test';

test('suggest-accept', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

  await page.getByTestId('suggest-mode-toggle').click();
  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('Accepted suggestion');

  await expect(page.getByTestId('history-suggestion-status')).toContainText('Pending suggestion');
  await page.getByTestId('suggest-accept-button').click();

  await expect(page.getByTestId('history-suggestion-status')).toContainText('Accepted suggestion');
  await expect(page.getByTestId('history-version')).toHaveCount(2);
});
