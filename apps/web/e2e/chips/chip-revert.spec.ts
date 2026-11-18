import { expect, test } from '@playwright/test';

import { createDocument, documentEditor, openSource, pasteText } from './document-chip-journey';

test('Cmd/Ctrl+K reverts an adjacent document chip to its original link', async ({ page }) => {
  const target = await createDocument(page, 'Research sources');
  await openSource(page);
  await pasteText(page, new URL(target, page.url()).href);
  await expect(page.getByTestId('lash-chip')).toContainText('Research sources');

  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByTestId('lash-chip')).toHaveCount(0);
  await expect(documentEditor(page).getByRole('link')).toHaveText(target);
  await expect(documentEditor(page).getByRole('link')).toHaveAttribute('href', target);
});
