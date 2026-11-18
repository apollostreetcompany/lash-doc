import { expect, test } from '@playwright/test';

import { selectDiscussionTab } from '../discussion-tabs';

test('print stylesheet hides chrome and normalizes paper', async ({ page }, testInfo) => {
  await page.goto('/');

  const title = page.getByRole('textbox', { name: 'Document title' });
  const editor = page.getByRole('textbox', { name: 'Document editor' });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await title.fill('Launch memo');
  await title.press('Enter');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+Alt+2');
  await page.keyboard.insertText('Print schedule');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.insertText('Publish Friday.');
  await page.keyboard.press('ControlOrMeta+b');

  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(page.getByRole('navigation', { name: 'Outline' })).toBeVisible();
  await selectDiscussionTab(page, 'history');
  await expect(page.getByTestId('history-version')).toHaveCount(1);
  await editor.getByText('Publish Friday.', { exact: true }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await selectDiscussionTab(page, 'chat');
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await page.getByRole('textbox', { name: 'Comment' }).fill('Discussion stays off the page.');
  await page.getByRole('button', { name: 'Post comment' }).click();
  const comment = page.getByText('Discussion stays off the page.', { exact: true });
  await expect(comment).toBeVisible();

  const chrome = [
    '.lash-sidebar',
    '.lash-rail',
    '.lash-topbar',
    '.lash-toolbar-bar',
    '.lash-document-outline',
  ];
  for (const selector of chrome) await expect(page.locator(selector)).toBeVisible();

  await page.emulateMedia({ media: 'print' });
  // A wide sheet exposes desktop-only print rules that Letter would hide behind a breakpoint.
  await page.pdf({ path: testInfo.outputPath('document.pdf'), width: '15in', height: '11in' });

  for (const selector of chrome) await expect(page.locator(selector)).toHaveCSS('display', 'none');
  await expect(comment).toBeHidden();
  await expect(page.locator('.lash-doc-paper')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(title).toBeVisible();
  await expect(title).toHaveValue('Launch memo');
  await expect(editor.getByRole('heading', { name: 'Print schedule', level: 2 })).toBeVisible();
  await expect(editor.locator('strong')).toHaveText('Publish Friday.');
});
