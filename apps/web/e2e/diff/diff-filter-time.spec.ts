import { expect, test } from '@playwright/test';

import { selectDiscussionTab } from '../discussion-tabs';

test('diff-filter-time', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'Document editor' });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.click();
  await page.keyboard.insertText('Recent diff');

  await selectDiscussionTab(page, 'history');
  await expect(page.getByTestId('history-version')).toHaveCount(1);
  await page.getByTestId('history-time-filter-last-7-days').click();

  await expect(page.getByTestId('history-filter-time')).toContainText('last 7 days');
  await expect(page.getByTestId('history-filtered-counts')).toContainText('1 matching version');
});
