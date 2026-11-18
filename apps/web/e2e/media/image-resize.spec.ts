import { expect, test } from '@playwright/test';

import { expectDecodedPng, openImageDocument, persistedBody, sendImageFile } from './image-file';

test('image-resize preserves keyboard-adjusted width and the original image', async ({ page }) => {
  const id = 'media-resize';
  await openImageDocument(page, id);
  await page.locator('.ProseMirror').click();
  await sendImageFile(page);
  await expectDecodedPng(page);

  const slider = page.getByRole('slider', { name: 'Image width' });
  await slider.press('ArrowRight');
  await expect(page.locator('.lash-image-media')).toHaveCSS('width', '130px');
  await expect.poll(() => persistedBody(page, id)).toContain('"width":130');

  await page.reload();
  await expect(page.locator('.lash-image-media')).toHaveCSS('width', '130px');
  await expectDecodedPng(page);
});
