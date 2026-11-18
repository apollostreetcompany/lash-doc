import { expect, test } from '@playwright/test';

import { selectDiscussionTab } from '../discussion-tabs';

const editorContent = (page: import('@playwright/test').Page) =>
  page.getByTestId('lash-editor-content');

test('history-restore', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

  const editor = editorContent(page);
  await editor.click();
  await page.keyboard.type('Alpha');
  await selectDiscussionTab(page, 'history');
  await expect(page.getByTestId('history-version')).toHaveCount(1);

  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' beta');
  await expect(page.getByTestId('history-diff-insert')).toContainText(' beta');

  await page.getByTestId('history-version').first().click();
  await page.getByTestId('history-restore-button').click();

  await expect(editor).toContainText('Alpha');
  await expect(editor).not.toContainText('beta');
  await expect(page.getByTestId('history-version')).toHaveCount(3);
});
