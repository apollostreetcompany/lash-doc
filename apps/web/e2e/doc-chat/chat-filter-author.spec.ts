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

test('chat-filter-author', async ({ page }) => {
  await page.goto('/');
  await ready(page);

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('Anchor target remains');
  await expect(page.getByTestId('history-version').first()).toBeVisible();

  await selectTarget(page);
  await expect(page.getByTestId('chat-create-thread')).toBeEnabled();
  await page.getByTestId('chat-create-thread').click();
  await page.getByTestId('chat-filter-author').click();

  await expect(page.getByTestId('chat-count')).toContainText('1 thread');
  await expect(page.getByTestId('chat-message').first()).toHaveAttribute(
    'data-author-id',
    'local-user',
  );
});
