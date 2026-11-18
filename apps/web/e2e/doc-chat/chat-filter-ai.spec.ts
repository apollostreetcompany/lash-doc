import { expect, test, type Page } from '@playwright/test';

import { enableAiFixture } from '../ai/enable-ai-fixture';
import { selectDiscussionTab } from '../discussion-tabs';

const ready = async (page: Page) =>
  page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

const selectTarget = async (page: Page) =>
  page.evaluate(() => {
    const editor = (window as unknown as { __lashEditor: import('@tiptap/core').Editor })
      .__lashEditor;
    editor.chain().focus().setTextSelection({ from: 8, to: 14 }).run();
  });

test('chat-filter-ai', async ({ page }) => {
  await page.goto('/');
  await ready(page);

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('Anchor target remains');
  await selectDiscussionTab(page, 'history');
  await expect(page.getByTestId('history-version').first()).toBeVisible();

  await selectDiscussionTab(page, 'chat');
  await selectTarget(page);
  await expect(page.getByTestId('chat-create-thread')).toBeEnabled();
  await page.getByTestId('chat-create-thread').click();
  await page.getByTestId('chat-new-thread-textarea').fill('Ask AI about this target.');
  await page.getByTestId('chat-post-thread').click();
  await expect(page.getByTestId('chat-thread')).toHaveCount(1);
  await expect(page.getByTestId('chat-add-ai')).toHaveCount(0);

  await enableAiFixture(page);
  await page.reload();
  await selectDiscussionTab(page, 'chat');
  await page.getByTestId('chat-add-ai').click();
  await page.getByTestId('chat-filter-ai').click();

  await expect(page.getByTestId('chat-count')).toContainText('1 thread');
  await expect(page.locator('[data-testid="chat-message"][data-author-type="ai"]')).toContainText(
    'AI reply',
  );
});
