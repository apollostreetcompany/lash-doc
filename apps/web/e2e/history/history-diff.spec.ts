import { expect, test } from '@playwright/test';

const editorContent = (page: import('@playwright/test').Page) =>
  page.getByTestId('lash-editor-content');

test('history-diff', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

  await editorContent(page).click();
  await page.keyboard.type('Alpha');
  await expect(page.getByTestId('history-version')).toHaveCount(1);

  await page.keyboard.type(' beta');

  await expect(page.getByTestId('history-diff')).toBeVisible();
  await expect(page.getByTestId('history-diff-insert')).toContainText(' beta');
});
