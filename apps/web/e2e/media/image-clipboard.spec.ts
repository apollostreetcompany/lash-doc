import { expect, test } from '@playwright/test';

import {
  expectDecodedPng,
  openImageDocument,
  persistedBody,
  PNG_SOURCE,
  sendImageFile,
} from './image-file';

test('image-clipboard saves the original image and surrounding text after reload', async ({
  page,
}) => {
  const id = 'media-clipboard';
  const text = 'Text that stays in the document';
  await openImageDocument(page, id);
  await page.locator('.ProseMirror').press('End');
  await page.keyboard.type(text);
  await expect.poll(() => persistedBody(page, id)).toContain(text);
  await page.keyboard.press('ControlOrMeta+A');

  await sendImageFile(page);
  await expect(page.getByTestId('lash-image-node')).toHaveAttribute('data-status', 'idle');
  await expectDecodedPng(page);
  await expect(page.locator('.ProseMirror')).toContainText(text);

  page.once('dialog', (dialog) => dialog.accept('Teal swatch'));
  await page.getByRole('button', { name: 'Alt text' }).click();
  await expect.poll(() => persistedBody(page, id)).toContain('Teal swatch');
  const saved = await persistedBody(page, id);
  expect(saved).toContain(PNG_SOURCE);
  expect(saved).toContain(text);
  expect(saved).not.toContain('blob:');

  await page.reload();
  await expectDecodedPng(page);
  await expect(page.locator('.lash-image-media')).toHaveAttribute('alt', 'Teal swatch');
  await expect(page.locator('.ProseMirror')).toContainText(text);
});
