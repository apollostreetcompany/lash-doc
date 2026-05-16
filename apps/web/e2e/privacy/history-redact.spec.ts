import { expect, test } from '@playwright/test';

test('history-redact', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('share-create-comment').click();

  await expect(page.getByTestId('history-redaction')).toContainText('history redacted 1 of 1');
});
