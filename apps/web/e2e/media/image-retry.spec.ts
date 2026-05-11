import { expect, test } from '@playwright/test';

// 1×1 transparent PNG — known-valid base64 (same fixture as image-clipboard).
const BASE64_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAE/wJ/lEpi/AAAAABJRU5ErkJggg==';

const pasteImage = async (page: import('@playwright/test').Page) => {
  await page.evaluate(([base64]) => {
    // ProseMirror only listens for paste on its own contenteditable element.
    const host = document.querySelector('.ProseMirror');
    if (!host) {
      return;
    }
    const bytes = atob(base64);
    const buffer = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i += 1) {
      buffer[i] = bytes.charCodeAt(i);
    }
    const file = new File([buffer], 'retry.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(evt, 'clipboardData', { value: dt });
    host.dispatchEvent(evt);
  }, [BASE64_PNG]);
};

test.describe('image-retry', () => {
  test('surfaces retry button and succeeds on retry', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      (window as unknown as { __lashImageUploadMock?: Record<string, unknown> }).__lashImageUploadMock = {
        failNext: true,
        nextUrl: 'https://assets.lash.dev/test/retry.png',
        nextWidth: 480,
        delayMs: 80,
      };
    });

    await page.getByTestId('lash-editor-content').click();
    await pasteImage(page);

    const imageNode = page.getByTestId('lash-image-node');
    await expect(imageNode).toHaveAttribute('data-status', 'error');

    await page.evaluate(() => {
      (window as unknown as { __lashImageUploadMock?: Record<string, unknown> }).__lashImageUploadMock = {
        mode: 'alwaysSucceed',
        nextUrl: 'https://assets.lash.dev/test/retry.png',
        nextWidth: 540,
        delayMs: 80,
      };
    });

    await page.getByTestId('image-retry-button').click();
    await expect(imageNode).toHaveAttribute('data-status', 'idle');
    await expect(page.locator('.lash-image-media')).toHaveAttribute(
      'src',
      'https://assets.lash.dev/test/retry.png',
    );
  });
});
