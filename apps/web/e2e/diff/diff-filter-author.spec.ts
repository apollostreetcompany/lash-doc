import { expect, test } from '@playwright/test';

import { selectDiscussionTab } from '../discussion-tabs';

test('diff-filter-author and diff-filter-time narrow History independently', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'Document editor' });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.click();
  await page.keyboard.insertText('Author-filtered diff');

  await selectDiscussionTab(page, 'history');
  await expect(page.getByTestId('history-version')).toHaveCount(1);
  await page.getByTestId('history-author-filter').first().click();

  const authorFilter = page.getByTestId('history-filter-author');
  await expect(authorFilter).toContainText('local-user');
  await expect(page.getByTestId('history-filtered-counts')).toContainText(/matching versions?/);
  await expect(page.getByTestId('history-diff-insert')).toHaveAttribute(
    'data-author-id',
    'local-user',
  );

  await authorFilter.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(authorFilter).toBeHidden();
  await page.getByTestId('history-time-filter-last-7-days').click();
  await expect(page.getByTestId('history-filter-time')).toContainText('last 7 days');
  await expect(page.getByTestId('history-filtered-counts')).toContainText('1 matching version');
});
