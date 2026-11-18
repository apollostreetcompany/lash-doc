import { expect, type Page } from '@playwright/test';

import { selectDiscussionTab } from '../discussion-tabs';

export const runEditorCompatibilitySmoke = async (page: Page, label: string) => {
  await page.goto('/');

  const editor = page.getByRole('textbox', { name: 'Document editor' });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.click();
  await page.keyboard.type(`${label} compatibility`);
  await expect(editor).toHaveText(`${label} compatibility`);

  await selectDiscussionTab(page, 'history');
  await expect(page.getByRole('region', { name: 'History' })).toBeVisible();
  await expect(page.getByTestId('history-version')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.getByTestId('history-diff-insert')).toHaveText(`${label} compatibility`);

  await selectDiscussionTab(page, 'ai');
  await expect(page.getByRole('region', { name: 'AI editor' })).toBeVisible();
  await page.getByRole('button', { name: 'Close activity panel' }).click();
  await expect(page.getByRole('region', { name: 'AI editor' })).toBeHidden();
};

/**
 * Narrow viewports keep writing, Discussion, navigation, and Share reachable.
 *
 * Shared by `cb-mobile-safari` (WebKit / iPhone) and `cb-mobile-chrome`
 * (Chromium / Pixel) projects.
 */
export const runMobileShellSmoke = async (page: Page) => {
  await runEditorCompatibilitySmoke(page, 'Mobile');

  const app = page.locator('.lash-app');
  await expect(app).toBeVisible();

  const hamburger = page.getByTestId('topbar-mobile-menu');
  await expect(hamburger).toBeVisible();
  await hamburger.tap();
  await expect(app).toHaveAttribute('data-mobile-drawer', 'true');

  await page.keyboard.press('Escape');
  await expect(app).toHaveAttribute('data-mobile-drawer', 'false');

  const shareTrigger = page.getByRole('button', { name: 'Share document' });
  await shareTrigger.tap();
  const share = page.getByRole('dialog', { name: /^Share /u });
  await expect(share).toBeVisible();
  await share.getByRole('button', { name: 'Close sharing' }).tap();
  await expect(share).toBeHidden();
  await expect(shareTrigger).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Document editor' })).toHaveText(
    'Mobile compatibility',
  );
};
