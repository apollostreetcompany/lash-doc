import type { Page } from '@playwright/test';

import { expect, test } from './development-loopback-mention-fixture';
const setEditorText = async (page: Page, text: string) =>
  page.evaluate((nextText) => {
    const editor = (window as unknown as { __lashEditor: import('@tiptap/core').Editor })
      .__lashEditor;
    editor.commands.setContent(`<p>${nextText}</p>`);
    editor.commands.focus('end');
  }, text);

test('mention-suggest', async ({ page, openSyntheticMentionFixture }) => {
  await openSyntheticMentionFixture(page);

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('@Ada');
  await expect(page.getByTestId('mention-suggestion')).toContainText('Ada Lovelace');
  await expect(page.getByTestId('mention-suggestion')).toHaveAttribute('data-kind', 'user');

  await setEditorText(page, '@Design');
  await expect(page.getByTestId('mention-suggestion')).toContainText('Design Team');
  await expect(page.getByTestId('mention-suggestion')).toHaveAttribute('data-kind', 'group');
});
