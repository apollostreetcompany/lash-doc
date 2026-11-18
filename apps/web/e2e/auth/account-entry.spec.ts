import { expect, test } from '@playwright/test';

test.describe('account entry keeps local writing available', () => {
  test('a signed-out writer can still open and write a local document', async ({ page }) => {
    await page.goto('/doc/auth-signed-out-writing');

    await expect(page.getByLabel('Document title')).toBeVisible();
    const editor = page.getByTestId('lash-editor-content').locator('.tiptap');
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.type('Signed-out local writing stays available.');
    await expect(editor).toContainText('Signed-out local writing stays available.');
    await expect(page).toHaveURL(/\/doc\/auth-signed-out-writing$/u);
  });

  test('an unsafe account return target never becomes a browser destination', async ({ page }) => {
    await page.goto('/auth/sign-in?next=https%3A%2F%2Fattacker.example%2Fdoc%2Fstolen');

    await expect(
      page.getByRole('alert').filter({ hasText: 'does not point to a valid' }),
    ).toBeVisible();
    await expect(page.locator('form')).toHaveCount(0);
    await expect(page.locator('a[href*="attacker.example"]')).toHaveCount(0);
    await expect(page).toHaveURL(/\/auth\/sign-in/u);
  });
});
