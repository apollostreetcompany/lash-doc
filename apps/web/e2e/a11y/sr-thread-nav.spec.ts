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
  const body = `${prefix}${target} remains`;
  await page.keyboard.insertText(body);
  await expect(editor).toHaveText(body);
  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');
  await selectDiscussionTab(page, 'history');
  await expect(page.getByTestId('history-version').first()).toBeVisible();

  const nativeSelection = () =>
    editor.evaluate((element) => {
      const selection = window.getSelection();
      if (!selection?.rangeCount) return null;
      const range = selection.getRangeAt(0);
      if (!element.contains(range.commonAncestorContainer)) return null;
      const preceding = document.createRange();
      preceding.selectNodeContents(element);
      preceding.setEnd(range.startContainer, range.startOffset);
      return { prefix: preceding.toString(), text: selection.toString() };
    });

  const wordModifier = process.platform === 'darwin' ? 'Alt' : 'Control';
  await editor.scrollIntoViewIfNeeded();
  const caret = await editor.evaluate((element, offset) => {
    const text = element.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('Expected a plain-text paragraph.');
    const range = document.createRange();
    range.setStart(text, offset);
    range.collapse(true);
    const { x, y, height } = range.getBoundingClientRect();
    return { x, y: y + height / 2 };
  }, prefix.length + target.length);
  await page.mouse.click(caret.x, caret.y);
  await expect.poll(nativeSelection).toEqual({ prefix: `${prefix}${target}`, text: '' });
  // Select the whole word in one native keyboard action.
  await editor.press(`${wordModifier}+Shift+ArrowLeft`);
  await expect.poll(nativeSelection).toEqual({ prefix, text: target });

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
  await expect.poll(nativeSelection).toEqual({ prefix, text: target });
  await expect(
    page.getByRole('button', { name: 'Add AI reply to thread on target' }),
  ).toBeEnabled();
});
