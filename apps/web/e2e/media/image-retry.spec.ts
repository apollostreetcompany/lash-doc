import { expect, test } from '@playwright/test';

import {
  expectDecodedPng,
  openImageDocument,
  persistedBody,
  PNG_BASE64,
  PNG_SOURCE,
  sendImageFile,
} from './image-file';

test('image-retry recovers a failed read of the same file', async ({ page }) => {
  const id = 'media-retry';
  await openImageDocument(page, id);
  await page.evaluate(() => {
    (window as Window & { __lashImageUploadMock?: { failNext: boolean } }).__lashImageUploadMock = {
      failNext: true,
    };
  });
  await page.locator('.ProseMirror').click();
  await sendImageFile(page);

  const imageNode = page.getByTestId('lash-image-node');
  await expect(imageNode).toHaveAttribute('data-status', 'error');
  await expect(imageNode).toContainText('Could not read this file.');
  await expect.poll(() => persistedBody(page, id)).toContain('"status":"error"');
  expect(await persistedBody(page, id)).not.toContain('blob:');

  await imageNode.getByRole('button', { name: 'Try again' }).click();
  await expect(imageNode).toHaveAttribute('data-status', 'idle');
  await expectDecodedPng(page);
  await expect.poll(() => persistedBody(page, id)).toContain(PNG_SOURCE);
});

const invalidImages = [
  {
    kind: 'wrong-format',
    base64: Buffer.from('plain text wearing a PNG name').toString('base64'),
    message: 'The file does not match its image format.',
  },
  {
    kind: 'missing-pixels',
    base64: Buffer.from(PNG_BASE64, 'base64').subarray(0, 33).toString('base64'),
    message: 'Could not open this image. Choose another file.',
  },
  {
    kind: 'oversized',
    base64: Buffer.alloc(256 * 1024 + 1).toString('base64'),
    message: 'Choose a nonempty image up to 256 KiB.',
  },
];

for (const { kind, base64, message } of invalidImages) {
  test(`a ${kind} image leaves selected writing intact and explains the failure`, async ({
    page,
  }) => {
    const id = `media-invalid-${kind}`;
    const text = 'The selection stays here';
    await openImageDocument(page, id);
    await page.locator('.ProseMirror').click();
    await page.keyboard.type(text);
    await expect.poll(() => persistedBody(page, id)).toContain(text);
    await page.keyboard.press('ControlOrMeta+A');
    await sendImageFile(page, 'paste', base64);

    const imageNode = page.getByTestId('lash-image-node');
    await expect(imageNode).toHaveAttribute('data-status', 'error');
    await expect(imageNode).toContainText(message);
    await expect(imageNode.getByRole('button', { name: 'Try again' })).toBeHidden();
    await expect(page.locator('.ProseMirror')).toContainText(text);
    await expect.poll(() => persistedBody(page, id)).toContain('"status":"error"');
    await page.reload();
    await expect(page.locator('.ProseMirror')).toContainText(text);
    await expect(page.locator('.lash-image-media')).not.toHaveAttribute('src', /.+/u);
  });
}
