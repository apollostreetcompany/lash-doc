import { expect, test } from '@playwright/test';

const BASE64_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAP0lEQVR42mNkYGD4z0AEwDiq4T8DA8P/TxgwGAqkBpwGIg2MhiGEmQBUCzEWwhhG0QwDIjAIg0jAEAI4oBuFdc61UAAAAASUVORK5CYII=';

const pasteImage = async (page: import('@playwright/test').Page) => {
  await page.evaluate(([base64]) => {
    const host = document.querySelector('[data-testid="lash-editor-content"]');
    if (!host) {
      return;
    }
    const bytes = atob(base64);
    const buffer = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i += 1) {
      buffer[i] = bytes.charCodeAt(i);
    }
    const file = new File([buffer], 'resize.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(evt, 'clipboardData', { value: dt });
    host.dispatchEvent(evt);
  }, [BASE64_PNG]);
};

test.describe('image-resize', () => {
  test('adjusts width via slider and reflects attribute', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      (window as unknown as { __lashImageUploadMock?: Record<string, unknown> }).__lashImageUploadMock = {
        mode: 'alwaysSucceed',
        nextUrl: 'https://assets.lash.dev/test/resize.png',
        nextWidth: 420,
        delayMs: 100,
      };
    });

    await page.getByTestId('lash-editor-content').click();
    await pasteImage(page);

    const slider = page.getByTestId('image-width-slider');
    await slider.evaluate((element) => {
      (element as HTMLInputElement).value = '560';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const width = await page.locator('.lash-image-media').evaluate((el) => el.style.width);
    expect(width).toBe('560px');

    await slider.evaluate((element) => {
      const input = element as HTMLInputElement;
      input.value = '320';
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });

    const updatedWidth = await page.locator('.lash-image-media').evaluate((el) => el.style.width);
    expect(updatedWidth).toBe('310px');
  });
});
