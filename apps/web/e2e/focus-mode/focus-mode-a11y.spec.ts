import { expect, test } from '@playwright/test';

test.describe('focus-mode-a11y', () => {
  test('hides chrome while keeping landmarks available', async ({ page }) => {
    await page.goto('/');

    const heading = page.getByRole('heading', { level: 1, name: 'Lash Collaborative Editor' });
    await expect(heading).toBeVisible();
    await expect(page.getByTestId('lash-toolbar')).toBeVisible();
    await expect(page.locator('[data-testid="lash-outline-panel"]')).toHaveCount(1);

    const toggle = page.getByTestId('focus-mode-toggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await expect(page.getByTestId('lash-toolbar')).toBeHidden();
    await expect(page.locator('[data-testid="lash-outline-panel"]')).toHaveCount(0);
    await expect(heading).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
  });
});
