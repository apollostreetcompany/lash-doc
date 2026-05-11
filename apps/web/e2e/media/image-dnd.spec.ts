import { expect, test } from '@playwright/test';

// 1×1 transparent PNG — known-valid base64 (same fixture as image-clipboard).
const BASE64_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAE/wJ/lEpi/AAAAABJRU5ErkJggg==';

const dropImage = async (page: import('@playwright/test').Page) => {
  await page.evaluate(([base64]) => {
    // ProseMirror only listens for drag events on its own contenteditable
    // element. Construct a File-bearing DataTransfer and walk through the
    // real DnD sequence: dragenter → dragover → drop. ProseMirror gates drop
    // handling on having seen the prior events, so dispatching `drop`
    // standalone is silently dropped.
    const target = document.querySelector('.ProseMirror');
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
    const rect = target.getBoundingClientRect();
    const clientX = Math.floor(rect.left + rect.width / 2);
    const clientY = Math.floor(rect.top + rect.height / 2);
    // `DragEventInit.dataTransfer` is not in the spec; the constructor
    // silently ignores it. Use defineProperty to expose the DT on the event.
    const dispatch = (type: string) => {
      const evt = new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
      });
      Object.defineProperty(evt, 'dataTransfer', { value: dataTransfer });
      target.dispatchEvent(evt);
    };
    dispatch('dragenter');
    dispatch('dragover');
    dispatch('drop');
  }, [BASE64_PNG]);
};

test.describe('image-dnd', () => {
  test('drops image onto editor and renders node', async ({ page }) => {
    await page.goto('/');
    // Wait for both the editor mount AND the .ProseMirror contenteditable
    // before dropping. Without this, parallel test runs can race the editor
    // initialization and dispatch the drop sequence into an empty document.
    await page.waitForFunction(() =>
      Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
    );
    await page.locator('.ProseMirror').waitFor({ state: 'visible' });
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
