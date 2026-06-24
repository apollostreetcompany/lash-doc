import { expect, test, type Page } from '@playwright/test';

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

test('sr-thread-nav', async ({ page }) => {
  await page.goto('/');
  await ready(page);

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('Anchor target remains');
  await expect(page.getByTestId('history-version').first()).toBeVisible();

  await selectTarget(page);
  await expect(page.getByTestId('chat-create-thread')).toBeEnabled();
  await page.getByTestId('chat-create-thread').click();

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
