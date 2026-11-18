import { expect, test } from '@playwright/test';

import { createDocument, openSource, pasteText } from './document-chip-journey';

test('shows the current accessible title in the document chip preview', async ({ page }) => {
  const target = await createDocument(page, 'Editing checklist');
  await openSource(page);
  await pasteText(page, new URL(target, page.url()).href);
  await expect(page.getByTestId('lash-chip')).toContainText('Editing checklist');
  await page.getByTestId('lash-chip-wrapper').hover();

  await expect(page.getByTestId('lash-chip-preview')).toBeVisible();
  await expect(page.getByTestId('lash-chip-preview-title')).toHaveText('Editing checklist');
});
