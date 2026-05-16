import { expect, test } from '@playwright/test';

test('share-audit', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('share-create-comment').click();

  await expect(page.getByTestId('share-audit-count')).toContainText('2 audit events');
  await expect(page.getByTestId('share-audit-event').first()).toContainText('share-link.created');
  await expect(page.getByTestId('share-audit-event').last()).toContainText('share-link.access');
});
