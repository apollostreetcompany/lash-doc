import { expect, test } from '@playwright/test';

import { body, proposeWording } from './suggestion-flow';

test('suggest-reject keeps the original passage and later writing', async ({ page }) => {
  await page.goto('/doc/suggestion-reject');
  const editor = await proposeWording(page);
  await editor.press('End');
  await page.keyboard.insertText(' today.');

  await page.getByRole('button', { name: 'Reject suggestion' }).click();
  await expect(page.getByTestId('suggestion-status')).toHaveText('Suggestion rejected');
  await expect(editor).toHaveText(`${body} today.`);
});
