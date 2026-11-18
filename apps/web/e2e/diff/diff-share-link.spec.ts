import { expect, test } from '@playwright/test';

import { selectDiscussionTab } from '../discussion-tabs';

test('diff-share-link', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'Document editor' });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.click();
  await page.keyboard.insertText('Share filtered diff');

  await selectDiscussionTab(page, 'history');
  await expect(page.getByTestId('history-version')).toHaveCount(1);
  await page.getByTestId('history-author-filter').first().click();
  await page.getByTestId('history-time-filter-last-7-days').click();
  await page.getByTestId('history-filter-copy-link').click();

  const readClipboard = () => page.evaluate(() => navigator.clipboard.readText());
  await expect.poll(readClipboard).toContain('historyAuthor=local-user');
  const link = new URL(await readClipboard());
  const currentDocument = new URL(page.url());
  expect(link.origin).toBe(currentDocument.origin);
  expect(link.pathname).toBe(currentDocument.pathname);
  expect(link.searchParams.get('historyAuthor')).toBe('local-user');
  expect(link.searchParams.get('historyTime')).toBe('last-7-days');

  await page.goto(link.href);
  await expect(page.getByTestId('history-filter-author')).toContainText('local-user');
  await expect(page.getByTestId('history-filter-time')).toContainText('last 7 days');
  await expect(page.getByTestId('history-diff-insert')).toContainText('Share filtered diff');

  await page.getByRole('button', { name: 'New document' }).click();
  await expect(page).toHaveURL(/\/doc\/doc-[a-z0-9-]+$/);
  await selectDiscussionTab(page, 'history');
  await expect(page.getByTestId('history-count')).toHaveText('0 versions');
  await expect(page.getByTestId('history-filter-author')).toHaveCount(0);
  await expect(page.getByTestId('history-filter-time')).toHaveCount(0);
});
