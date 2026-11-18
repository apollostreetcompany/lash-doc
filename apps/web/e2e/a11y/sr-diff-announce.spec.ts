import { expect, test } from '@playwright/test';

import { selectDiscussionTab } from '../discussion-tabs';

test('sr-diff-announce', async ({ page }) => {
  await page.goto('/');

  const editor = page.getByRole('textbox', { name: 'Document editor' });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.click();
  await page.keyboard.insertText('Alpha');
  await selectDiscussionTab(page, 'history');
  await expect(page.getByTestId('history-version')).toHaveCount(1);

  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(' beta');
  await expect(page.getByTestId('history-version')).toHaveCount(2);

  const diff = page.getByTestId('history-diff');
  await expect(diff).toBeVisible();
  await expect(diff).toHaveAttribute('aria-label', 'Version diff');
  await expect(diff).toHaveAttribute('aria-live', 'polite');
  await expect(diff).toHaveAttribute('aria-describedby', /history-diff-announcement-/);

  await expect(page.getByTestId('history-diff-announcement')).toContainText('inserted "beta"');
  await expect(page.getByTestId('history-diff-insert')).toHaveAttribute(
    'aria-label',
    'Inserted text by local-user as edit: beta',
  );
});
