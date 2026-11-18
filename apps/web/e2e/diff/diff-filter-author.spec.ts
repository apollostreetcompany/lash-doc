import { expect, test } from '@playwright/test';

import { selectDiscussionTab } from '../discussion-tabs';

test('diff-filter-author', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'Document editor' });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.click();
  await page.keyboard.insertText('Author-filtered diff');

  await selectDiscussionTab(page, 'history');
  await expect(page.getByTestId('history-version')).toHaveCount(1);
  await page.getByTestId('history-author-filter').first().click();

  await expect(page.getByTestId('history-filter-author')).toContainText('local-user');
  await expect(page.getByTestId('history-filtered-counts')).toContainText(/matching versions?/);
  await expect(page.getByTestId('history-diff-insert')).toHaveAttribute(
    'data-author-id',
    'local-user',
  );
});
