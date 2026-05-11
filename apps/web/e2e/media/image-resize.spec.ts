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
    // Wait for editor mount before configuring the upload mock + pasting,
    // otherwise parallel-run flake: paste dispatches before the React
    // editor has bound __lashEditor and the upload manager is missing.
    await page.waitForFunction(() =>
      Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
    );
    await page.locator('.ProseMirror').waitFor({ state: 'visible' });
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
