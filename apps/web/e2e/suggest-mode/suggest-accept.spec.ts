import { expect, test } from '@playwright/test';

import { proposal, proposeWording, wording } from './suggestion-flow';

test('suggest-accept changes only the selected repeated wording', async ({ page }) => {
  await page.goto('/doc/suggestion-accept');
  const editor = await proposeWording(page);

  await page.getByRole('button', { name: 'Accept suggestion' }).click();
  await expect(page.getByTestId('suggestion-status')).toHaveText('Suggestion accepted');
  await expect(editor).toHaveText(`${wording} once, then ${proposal}`);
  await expect(page.getByRole('button', { name: 'Accept suggestion' })).toHaveCount(0);
});
