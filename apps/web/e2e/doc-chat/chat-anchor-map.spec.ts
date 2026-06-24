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

const selectedText = (page: Page) =>
  page.evaluate(() => {
    const editor = (window as unknown as { __lashEditor: import('@tiptap/core').Editor })
      .__lashEditor;
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to, '\n');
  });

test('chat-anchor-map', async ({ page }) => {
  await page.goto('/');
  await ready(page);

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('Anchor target remains');
  await expect(page.getByTestId('history-version').first()).toBeVisible();

  await selectTarget(page);
  await expect(page.getByTestId('chat-create-thread')).toBeEnabled();
  await page.getByTestId('chat-create-thread').click();
  await expect(page.getByTestId('chat-thread')).toHaveCount(1);
  await expect(page.getByTestId('chat-anchor-row')).toBeVisible();
  await expect(page.getByTestId('chat-current-target')).toContainText('target');
  await expect(page.getByTestId('chat-document-anchor-marker')).toBeVisible();

  await page.evaluate(() => {
    const editor = (window as unknown as { __lashEditor: import('@tiptap/core').Editor })
      .__lashEditor;
    editor.commands.focus('end');
  });
  await page.keyboard.type(' plus context');

  await expect(page.getByTestId('chat-anchor-status')).toContainText('Anchored');
  await expect(page.getByTestId('chat-current-target')).toContainText('target');
  await expect(page.getByTestId('chat-current-context')).toContainText('target');
  await expect(page.getByTestId('chat-document-anchor-marker')).toBeVisible();
  await page.getByTestId('chat-jump-anchor').click();
  await expect(page.getByTestId('chat-anchor-jump-status')).toContainText(
    'Selected target in the document.',
  );
  await expect.poll(() => selectedText(page)).toBe('target');
});
