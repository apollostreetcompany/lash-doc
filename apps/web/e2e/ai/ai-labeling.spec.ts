import { expect, test, type Page } from '@playwright/test';

const ready = async (page: Page) =>
  page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

const selectDraft = async (page: Page) =>
  page.evaluate(() => {
    const editor = (window as unknown as { __lashEditor: import('@tiptap/core').Editor })
      .__lashEditor;
    editor.chain().focus().setTextSelection({ from: 1, to: 6 }).run();
  });

test('ai-labeling', async ({ page }) => {
  await page.goto('/');
  await ready(page);

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('draft text');
  await expect(page.getByTestId('history-version')).toHaveCount(1, { timeout: 5000 });

  await selectDraft(page);
  await page.getByTestId('ai-improve-button').click();
  await page.getByTestId('ai-accept-button').click();

  await expect(page.getByTestId('ai-label')).toContainText('AI Editor');
  await expect(page.getByTestId('history-diff-insert')).toHaveAttribute(
    'data-author-id',
    'ai-editor',
  );
  await expect(page.getByTestId('history-diff-insert')).toHaveAttribute('data-intent', 'ai');
  await expect(page.getByTestId('history-diff-insert')).toContainText('Polished');
  await expect(page.getByTestId('lash-editor-content')).toContainText('Polished draft');
});
