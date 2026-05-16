import { expect, test } from '@playwright/test';

test('blame-hover', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('Hover attribution');

  await expect(page.getByTestId('blame-line').first()).toHaveAttribute(
    'title',
    /Line 1: local-user/,
  );
});
