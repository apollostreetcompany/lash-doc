import { expect, test, type Page } from '@playwright/test';

const ready = async (page: Page) =>
  page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

test('ai-citation-jump', async ({ page }) => {
  await page.goto('/');
  await ready(page);

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('Anchor target remains');
  await expect(page.getByTestId('history-version')).toHaveCount(1, { timeout: 5000 });

  await page.evaluate(() => {
    const editor = (window as unknown as { __lashEditor: import('@tiptap/core').Editor })
      .__lashEditor;
    editor.chain().focus().setTextSelection({ from: 8, to: 14 }).run();
  });
  await page.getByTestId('ai-chat-ask').click();
  await page.getByTestId('ai-chat-citation').click();

  await expect(page.getByTestId('ai-citation-jump-target')).toContainText('target');
  const selected = await page.evaluate(() => {
    const editor = (window as unknown as { __lashEditor: import('@tiptap/core').Editor })
      .__lashEditor;
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to, '\n');
  });
  expect(selected).toBe('target');
});
