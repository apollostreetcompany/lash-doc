import { expect, test } from '@playwright/test';

import {
  expectDecodedPng,
  openImageDocument,
  persistedBody,
  PNG_SOURCE,
  sendImageFile,
} from './image-file';

test('image-dnd preserves the dropped image bytes', async ({ page }) => {
  const id = 'media-drop';
  await openImageDocument(page, id);
  await sendImageFile(page, 'drop');

  await expect(page.getByTestId('lash-image-node')).toHaveAttribute('data-status', 'idle');
  await expectDecodedPng(page);
  await expect.poll(() => persistedBody(page, id)).toContain(PNG_SOURCE);
  await page.reload();
  await expectDecodedPng(page);
});
