import { expect, test, type Page } from '@playwright/test';

const ready = async (page: Page) =>
  page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

const selectTarget = async (page: Page) =>
  page.evaluate(() => {
    const editor = (window as unknown as { __lashEditor: import('@tiptap/core').Editor })
      .__lashEditor;
    editor.chain().focus().setTextSelection({ from: 8, to: 14 }).run();
  });

test('ai-chat-citation', async ({ page }) => {
  await page.goto('/');
  await ready(page);

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('Anchor target remains');
  await expect(page.getByTestId('history-version')).toHaveCount(1, { timeout: 5000 });

  await selectTarget(page);
  await page.getByTestId('ai-chat-ask').click();

  await expect(page.getByTestId('ai-chat-answer')).toContainText('target');
  await expect(page.getByTestId('ai-chat-citation')).toContainText('target');
  await expect(page.getByTestId('ai-chat-citation')).toHaveAttribute('data-range-from', '7');
  await expect(page.getByTestId('ai-chat-citation')).toHaveAttribute('data-range-to', '13');
});
