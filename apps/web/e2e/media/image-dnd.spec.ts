import { expect, test } from '@playwright/test';

const BASE64_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAI0lEQVR42mNk+M+ADzCBEjAwMPyfgQYGBoYkRUDMMA0w0AAAU0QBb7x83GgAAAABJRU5ErkJggg==';

const dropImage = async (page: import('@playwright/test').Page) => {
  await page.evaluate(([base64]) => {
    const target = document.querySelector('[data-testid="lash-editor-content"]');
    if (!target) {
      return;
    }
    const bytes = atob(base64);
    const buffer = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i += 1) {
      buffer[i] = bytes.charCodeAt(i);
    }
    const file = new File([buffer], 'dragged.png', { type: 'image/png' });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    const dropEvent = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
    });
    target.dispatchEvent(dropEvent);
  }, [BASE64_PNG]);
};

test.describe('image-dnd', () => {
  test('drops image onto editor and renders node', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      (window as unknown as { __lashImageUploadMock?: Record<string, unknown> }).__lashImageUploadMock = {
        mode: 'alwaysSucceed',
        nextUrl: 'https://assets.lash.dev/test/drop.png',
        nextWidth: 512,
        delayMs: 120,
      };
    });

    await dropImage(page);

    const imageNode = page.getByTestId('lash-image-node');
    await expect(imageNode).toBeVisible();
    await expect(imageNode).toHaveAttribute('data-status', 'idle');
    await expect(page.locator('.lash-image-media')).toHaveAttribute(
      'src',
      'https://assets.lash.dev/test/drop.png',
    );
  });
});
