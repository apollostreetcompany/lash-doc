import { expect, test } from '@playwright/test';

test('share-suggest-scope', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('share-create-suggest').click();

  await expect(page.getByTestId('share-validation')).toContainText('Access granted: suggest');
  await expect(page.getByTestId('share-can-comment')).toContainText('yes');
  await expect(page.getByTestId('share-can-suggest')).toContainText('yes');
  await expect(page.getByTestId('share-can-edit')).toContainText('no');
});
