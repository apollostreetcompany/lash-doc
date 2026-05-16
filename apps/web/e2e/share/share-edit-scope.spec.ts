import { expect, test } from '@playwright/test';

test('share-edit-scope', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('share-create-edit').click();

  await expect(page.getByTestId('share-validation')).toContainText('Access granted: edit');
  await expect(page.getByTestId('share-can-edit')).toContainText('yes');
  await expect(page.getByTestId('share-can-accept')).toContainText('yes');
  await expect(page.getByTestId('history-redaction')).toContainText('0 of 1');
});
