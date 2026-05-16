import { expect, test } from '@playwright/test';

test('blame-gutter', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('Blame starts here');

  await expect(page.getByTestId('blame-gutter')).toBeVisible();
  await expect(page.getByTestId('blame-line')).toHaveCount(1);
  await expect(page.getByTestId('blame-line').first()).toContainText('local-user');
});
