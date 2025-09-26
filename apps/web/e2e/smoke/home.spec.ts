import { expect, test } from '@playwright/test';

test.describe('Lash home smoke test', () => {
  test('renders editor shell with toolbar and content area', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('lash-home')).toBeVisible();
    await expect(page.getByTestId('lash-toolbar')).toBeVisible();
    await expect(page.getByTestId('lash-editor-content')).toBeVisible();
  });
});
