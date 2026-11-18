import { expect, test, type Page } from '@playwright/test';

import { editorFor, proposal, proposeWording, wording } from './suggestion-flow';

async function openSuggestions(page: Page) {
  await page.getByRole('button', { name: 'Suggest wording' }).click();
}

test('remembers the moved selection and the accepted decision through reload', async ({ page }) => {
  await page.goto('/doc/suggestion-durable');
  const editor = await proposeWording(page);
  await editor.press('Home');
  await page.keyboard.insertText('Reminder: ');
  await expect(editor).toHaveText(`Reminder: ${wording} once, then ${wording}`);
  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');

  await page.reload();
  await expect(editorFor(page)).toHaveText(`Reminder: ${wording} once, then ${wording}`);
  await openSuggestions(page);
  await page.getByRole('button', { name: 'Accept suggestion' }).click();
  await expect(page.getByTestId('suggestion-status')).toHaveText('Suggestion accepted');

  await page.reload();
  await openSuggestions(page);
  await expect(editorFor(page)).toHaveText(`Reminder: ${wording} once, then ${proposal}`);
  await expect(page.getByTestId('suggestion-status')).toHaveText('Suggestion accepted');
});
