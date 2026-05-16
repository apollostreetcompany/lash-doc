import { expect, test } from '@playwright/test';

test('share-comment-scope', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('share-create-comment').click();

  await expect(page.getByTestId('share-validation')).toContainText('Access granted: comment');
  await expect(page.getByTestId('share-can-comment')).toContainText('yes');
  await expect(page.getByTestId('share-can-suggest')).toContainText('yes');
  await expect(page.getByTestId('share-can-edit')).toContainText('no');
  await expect(page.getByTestId('share-can-accept')).toContainText('no');
});
