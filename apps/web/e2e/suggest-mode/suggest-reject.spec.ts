import { expect, test } from '@playwright/test';

test('suggest-reject', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

  const editor = page.getByTestId('lash-editor-content');
  await editor.click();
  await page.keyboard.type('Keep');
  await expect(page.getByTestId('history-version')).toHaveCount(1);

  await page.getByTestId('suggest-mode-toggle').click();
  await editor.click();
  await page.keyboard.type(' remove');
  await expect(page.getByTestId('history-version')).toHaveCount(2);
  await expect(page.getByTestId('history-suggestion-status')).toContainText('Pending suggestion');

  await page.getByTestId('suggest-reject-button').click();

  await expect(editor).toContainText('Keep');
  await expect(editor).not.toContainText('remove');
  await expect(page.getByTestId('history-version')).toHaveCount(3);
});
