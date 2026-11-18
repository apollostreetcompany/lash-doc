import { expect, type Page } from '@playwright/test';

// A 12 × 8 PNG with valid checksums, generated from a solid RGBA pixel.
export const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAwAAAAICAYAAADN5B7xAAAAFElEQVR4nGMQyoj5TwpmGNVACw0ALdKv4VVTVV0AAAAASUVORK5CYII=';
export const PNG_SOURCE = `data:image/png;base64,${PNG_BASE64}`;

export const openImageDocument = async (page: Page, id: string) => {
  await page.goto(`/doc/${id}`);
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true');
};

export const sendImageFile = async (
  page: Page,
  action: 'paste' | 'drop' = 'paste',
  base64 = PNG_BASE64,
) => {
  await page.locator('.ProseMirror').evaluate(
    (editor, { action, base64 }) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'sample.png', { type: 'image/png' }));
      if (action === 'paste') {
        editor.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
        );
        return;
      }

      const { left, top, width, height } = editor.getBoundingClientRect();
      for (const type of ['dragenter', 'dragover', 'drop']) {
        editor.dispatchEvent(
          new DragEvent(type, {
            dataTransfer: transfer,
            clientX: left + width / 2,
            clientY: top + height / 2,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    },
    { action, base64 },
  );
};

export const expectDecodedPng = async (page: Page) => {
  const image = page.locator('.lash-image-media');
  await expect(image).toHaveAttribute('src', PNG_SOURCE);
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(12);
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalHeight)).toBe(8);
};

export const persistedBody = (page: Page, id: string) =>
  page.evaluate((key) => window.localStorage.getItem(`lash:body:${key}`) ?? '', id);
