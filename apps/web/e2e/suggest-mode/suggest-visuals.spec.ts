import { expect, test } from '@playwright/test';

import { proposal, proposeWording, wording } from './suggestion-flow';

test('suggest-visuals shows both versions and leaves body intact', async ({ page }) => {
  await page.goto('/doc/suggestion-preview');
  await proposeWording(page);
  const card = page.getByTestId('suggestion-card');
  await expect(card.locator('del')).toHaveText(wording);
  await expect(card.locator('del')).toHaveAttribute('title', /Removed text by You/u);
  await expect(card.locator('ins')).toHaveText(proposal);
  await expect(card.locator('ins')).toHaveAttribute('title', /Inserted text by You/u);
});
