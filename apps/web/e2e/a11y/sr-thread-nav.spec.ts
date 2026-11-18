import { expect, test } from '@playwright/test';

import { enableAiFixture } from '../ai/enable-ai-fixture';
import { selectDiscussionTab } from '../discussion-tabs';

test('sr-thread-nav', async ({ page }) => {
  await enableAiFixture(page);
  await page.goto('/');

  const editor = page.getByRole('textbox', { name: 'Document editor' });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.click();
  const prefix = 'Anchor ';
  const target = 'target';
  await page.keyboard.insertText(`${prefix}${target} remains`);
  await selectDiscussionTab(page, 'history');
  await expect(page.getByTestId('history-version').first()).toBeVisible();

  await editor.click();
  await page.keyboard.press('Home');
  for (let index = 0; index < prefix.length; index += 1) await page.keyboard.press('ArrowRight');
  for (let index = 0; index < target.length; index += 1)
    await page.keyboard.press('Shift+ArrowRight');
  await selectDiscussionTab(page, 'chat');
  await expect(page.getByTestId('chat-create-thread')).toBeEnabled();
  await page.getByTestId('chat-create-thread').click();
  await expect(page.getByTestId('chat-new-thread-quote')).toHaveText('target');
  await page.getByTestId('chat-new-thread-textarea').fill('Review this target.');
  await page.getByTestId('chat-post-thread').click();

  await expect(page.getByTestId('chat-thread-list')).toHaveAttribute(
    'aria-label',
    'Document chat threads',
  );

  const thread = page.getByRole('article', { name: 'Thread on target' });
  await expect(thread).toBeVisible();
  await thread.focus();
  await expect(thread).toBeFocused();

  await expect(page.getByRole('heading', { level: 3, name: 'Thread on target' })).toBeAttached();
  await expect(page.getByRole('list', { name: 'Messages for target' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Comment thread on target' })).toBeVisible();
  const showTarget = page.getByRole('button', {
    name: 'Show document target for thread on target',
  });
  await expect(showTarget).toBeEnabled();
  await showTarget.click();
  await expect(page.getByTestId('chat-anchor-jump-status')).toContainText(
    'Selected target in the document.',
  );
  await expect(
    page.getByRole('button', { name: 'Add AI reply to thread on target' }),
  ).toBeEnabled();
});
