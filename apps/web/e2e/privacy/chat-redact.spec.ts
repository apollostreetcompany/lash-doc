import { expect, test } from '@playwright/test';

test('chat-redact', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('share-create-comment').click();

  await expect(page.getByTestId('chat-redaction')).toContainText('chat transcript redacted');
});
