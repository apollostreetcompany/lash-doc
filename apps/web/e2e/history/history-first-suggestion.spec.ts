import { expect, test } from '@playwright/test';

test('History recovers the first draft when a suggestion saved it before autosave', async ({
  page,
}) => {
  const documentId = 'first-suggestion-draft';
  const draft = 'Open the workshop next week.';
  await page.goto(`/doc/${documentId}`);
  const editor = page.getByRole('textbox', { name: 'Document editor' });
  await expect(editor).toBeEditable();

  // Stretch the two debounce windows so the normal suggestion action saves
  // the first body before autosave, and the writer leaves before History writes.
  await page.evaluate(() => {
    const schedule: Window['setTimeout'] = window.setTimeout.bind(window);
    Reflect.set(
      window,
      'setTimeout',
      (callback: TimerHandler, delay?: number, ...args: unknown[]) =>
        schedule(callback, delay === 350 || delay === 1_800 ? 60_000 : delay, ...args),
    );
  });
  const savedBody = () =>
    page.evaluate((id) => localStorage.getItem(`lash:body:${id}`), documentId);
  await editor.click();
  await page.keyboard.insertText(draft);
  await page.keyboard.press('Shift+Home');
  await page.getByRole('button', { name: 'Suggest wording' }).click();
  const replacement = page.getByRole('textbox', { name: 'Proposed wording' });
  await expect(replacement).toHaveValue(draft);
  await replacement.fill('Open the workshop on Tuesday.');
  expect(await savedBody()).toBeNull();
  await page.getByRole('button', { name: 'Post suggestion' }).click();
  await expect(page.getByTestId('suggestion-status')).toHaveText('Suggestion pending');
  expect(await savedBody()).toContain(draft);

  await page.reload();
  await expect(editor).toHaveText(draft);
  await page.getByTestId('document-history-button').click();
  await expect(page.getByTestId('history-version')).toHaveCount(1);
  await expect(page.getByTestId('history-diff-insert')).toHaveText(draft);
});
