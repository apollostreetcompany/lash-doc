import { expect, test, type Page } from '@playwright/test';

const ready = async (page: Page) =>
  page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

test('ai-rationale', async ({ page }) => {
  await page.goto('/');
  await ready(page);

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('rough rationale');
  await expect(page.getByTestId('history-version')).toHaveCount(1, { timeout: 5000 });

  await page.evaluate(() => {
    const editor = (window as unknown as { __lashEditor: import('@tiptap/core').Editor })
      .__lashEditor;
    editor.chain().focus().setTextSelection({ from: 1, to: 6 }).run();
  });
  await page.getByTestId('ai-improve-button').click();

  await expect(page.getByTestId('ai-rationale')).toContainText('Tighten the selected wording');
  await expect(page.getByTestId('ai-patch-json')).toContainText('"rationale"');
});
