import { expect, test } from '@playwright/test';

// agents.md C.1 (Test ID: chip-hover):
// Hovering an internal-doc chip shows a preview popover with title + last editor.
test.describe('chip-hover', () => {
  test('hovering a chip reveals a preview popover with title and last editor', async ({
    page,
  }) => {
    await page.goto('/');

    const editor = page.getByTestId('lash-editor-content');
    await editor.click();

    await page.waitForFunction(() => {
      return Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor);
    });

    // Seed a chip by pasting an internal-doc URL.
    await page.evaluate((url) => {
      const proseMirror = document.querySelector('.ProseMirror');
      const data: Record<string, string> = { 'text/plain': url };
      const dataTransfer = { getData: (format: string) => data[format] || '' };
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: dataTransfer, writable: false });
      proseMirror?.dispatchEvent(event);
    }, 'https://lash.local/doc/test-doc-1');

    const chip = page.getByTestId('lash-chip').first();
    await expect(chip).toBeVisible();
    // Wait for async resolver to populate title before hovering, so the
    // preview shows the resolved label, not the raw URL.
    await expect(chip).toContainText('Internal Doc test-doc-1');

    const wrapper = page.getByTestId('lash-chip-wrapper').first();
    await wrapper.hover();

    const preview = page.getByTestId('lash-chip-preview').first();
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute('data-visible', 'true');

    await expect(page.getByTestId('lash-chip-preview-title').first()).toHaveText(
      'Internal Doc test-doc-1',
    );
    await expect(page.getByTestId('lash-chip-preview-editor').first()).toHaveText(
      /Last edited by Test User/,
    );
  });
});
