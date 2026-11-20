import { expect, test } from '@playwright/test';

test('closing desktop activity returns idle focus and preserves newer editor focus', async ({
  page,
}) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'Document editor' });
  const status = page.getByRole('group', { name: 'Document status' });
  const history = status.getByRole('button', { name: 'History', exact: true });
  const discussion = page.getByRole('button', { name: 'Discussion', exact: true });
  const close = page.getByRole('button', { name: 'Close activity panel' });
  const title = page.getByRole('textbox', { name: 'Document title' });
  await expect(editor).toBeEditable();
  await history.press('Enter');
  await expect(page.getByRole('tabpanel', { name: 'History', exact: true })).toBeVisible();
  await close.press('Enter');
  await expect(close).toBeHidden();
  await expect(history).toBeFocused();

  await discussion.press('Enter');
  await expect(close).toBeVisible();
  // Acquire focus after the actual close click, before a deferred return can run.
  await editor.evaluate((element) => {
    document.addEventListener('click', () => queueMicrotask(() => element.focus()), { once: true });
  });
  await close.press('Enter');
  await expect(close).toBeHidden();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(editor).toBeFocused();
  await page.keyboard.insertText('Continue the draft.');
  await expect(editor).toContainText('Continue the draft.');

  await discussion.press('Enter');
  await expect(close).toBeVisible();
  await title.press('Control+/');
  await expect(close).toBeHidden();
  await expect(title).toBeFocused();
});
