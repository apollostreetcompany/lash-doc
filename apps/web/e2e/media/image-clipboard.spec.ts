import { expect, test } from '@playwright/test';

const BASE64_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAE/wJ/lEpi/AAAAABJRU5ErkJggg==';

const pasteImage = async (page: import('@playwright/test').Page) => {
  await page.evaluate(([base64]) => {
    const editorHost = document.querySelector('[data-testid="lash-editor-content"]');
    if (!editorHost) {
      return;
    }
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i += 1) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const file = new File([byteArray], 'clipboard.png', { type: 'image/png' });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    const clipboardEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(clipboardEvent, 'clipboardData', {
      value: dataTransfer,
    });
    editorHost.dispatchEvent(clipboardEvent);
  }, [BASE64_PNG]);
};

test.describe('image-clipboard', () => {
  test('pastes image and completes upload', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      (window as unknown as { __lashImageUploadMock?: Record<string, unknown> }).__lashImageUploadMock = {
        mode: 'alwaysSucceed',
        nextUrl: 'https://assets.lash.dev/test/clipboard.png',
        nextWidth: 420,
        delayMs: 120,
      };
    });

    const editor = page.getByTestId('lash-editor-content');
    await editor.click();
    await pasteImage(page);

    const imageNode = page.getByTestId('lash-image-node');
    await expect(imageNode).toBeVisible();
    await expect(imageNode).toHaveAttribute('data-status', 'idle');
    await expect(page.locator('.lash-image-media')).toHaveAttribute(
      'src',
      'https://assets.lash.dev/test/clipboard.png',
    );
  });
});
