import { expect, test, type Page } from '@playwright/test';

const ready = async (page: Page) =>
  page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

const selectRough = async (page: Page) =>
  page.evaluate(() => {
    const editor = (window as unknown as { __lashEditor: import('@tiptap/core').Editor })
      .__lashEditor;
    editor.chain().focus().setTextSelection({ from: 1, to: 6 }).run();
  });

test('ai-patch-apply', async ({ page }) => {
  await page.goto('/');
  await ready(page);

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('rough copy');
  await expect(page.getByTestId('history-version')).toHaveCount(1, { timeout: 5000 });

  await selectRough(page);
  await expect(page.getByTestId('ai-improve-button')).toBeEnabled();
  await page.getByTestId('ai-improve-button').click();

  await expect(page.getByTestId('ai-patch-json')).toContainText('"op": "replace_text"');
  await expect(page.getByTestId('lash-editor-content')).toContainText('rough copy');

  await page.getByTestId('ai-accept-button').click();
  await expect(page.getByTestId('ai-status')).toContainText('AI patch applied');
  await expect(page.getByTestId('lash-editor-content')).toContainText('Polished rough copy');
});
