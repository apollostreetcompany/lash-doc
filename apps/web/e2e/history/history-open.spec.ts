import { expect, test } from '@playwright/test';

const editorContent = (page: import('@playwright/test').Page) =>
  page.getByTestId('lash-editor-content');

test('history-open', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

  await editorContent(page).click();
  await page.keyboard.type('History starts here');

  await expect(page.getByTestId('history-panel')).toBeVisible();
  await expect(page.getByTestId('history-count')).toContainText(/1 version|[1-9][0-9]* versions/);
  await expect(page.getByTestId('history-version')).toHaveCount(1);
  await expect(page.getByTestId('history-selected-version')).toContainText('Version 1');
});
