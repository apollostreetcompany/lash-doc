import { expect, test, type Page } from '@playwright/test';

const ready = async (page: Page) =>
  page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

const setEditorText = async (page: Page, text: string) =>
  page.evaluate((nextText) => {
    const editor = (window as unknown as { __lashEditor: import('@tiptap/core').Editor })
      .__lashEditor;
    editor.commands.setContent(`<p>${nextText}</p>`);
    editor.commands.focus('end');
  }, text);

test('mention-suggest', async ({ page }) => {
  await page.goto('/');
  await ready(page);

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('@Ada');
  await expect(page.getByTestId('mention-suggestion')).toContainText('Ada Lovelace');
  await expect(page.getByTestId('mention-suggestion')).toHaveAttribute('data-kind', 'user');

  await setEditorText(page, '@Design');
  await expect(page.getByTestId('mention-suggestion')).toContainText('Design Team');
  await expect(page.getByTestId('mention-suggestion')).toHaveAttribute('data-kind', 'group');
});
