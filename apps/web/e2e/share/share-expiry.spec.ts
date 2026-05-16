import { expect, test } from '@playwright/test';

test('share-expiry', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('share-create-expired').click();

  await expect(page.getByTestId('share-validation')).toContainText('Denied: expired');
  await expect(page.getByTestId('share-audit-event').last()).toContainText('share-link.expired');
});
