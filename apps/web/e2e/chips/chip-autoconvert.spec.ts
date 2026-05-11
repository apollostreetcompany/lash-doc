import { expect, test } from '@playwright/test';

// agents.md C.1 (Test ID: chip-autoconvert):
// Given a pasted URL that points to an internal document
// When paste completes
// Then it becomes a chip with title (resolved via resolveDocChip mock).
test.describe('chip-autoconvert', () => {
  test('pasted internal-doc URL auto-converts to a chip with resolved title', async ({ page }) => {
    await page.goto('/');

    const editor = page.getByTestId('lash-editor-content');
    await editor.click();

    await page.waitForFunction(() => {
      return Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor);
    });

    // Dispatch a paste event carrying the internal-doc URL as text/plain.
    await page.evaluate((url) => {
      const proseMirror = document.querySelector('.ProseMirror');
      const data: Record<string, string> = { 'text/plain': url };
      const dataTransfer = { getData: (format: string) => data[format] || '' };
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: dataTransfer, writable: false });
      proseMirror?.dispatchEvent(event);
    }, 'https://lash.local/doc/test-doc-1');

    // The chip node should appear in the DOM.
    const chip = page.getByTestId('lash-chip').first();
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('data-ref-id', 'test-doc-1');
    await expect(chip).toHaveAttribute('data-chip-kind', 'doc');

    // Mock resolver populates the display label asynchronously.
    await expect(chip).toContainText('Internal Doc test-doc-1');

    // Verify it's a `chip` node in the doc (not a plain text/link).
    const docInfo = await page.evaluate(() => {
      const editorInstance = (window as unknown as {
        __lashEditor?: { state: { doc: { toJSON: () => unknown } } };
      }).__lashEditor;
      const json = editorInstance?.state.doc.toJSON();
      const findChip = (node: unknown): unknown => {
        if (!node || typeof node !== 'object') return null;
        const n = node as { type?: string; content?: unknown[] };
        if (n.type === 'chip') return n;
        if (Array.isArray(n.content)) {
          for (const child of n.content) {
            const hit = findChip(child);
            if (hit) return hit;
          }
        }
        return null;
      };
      return findChip(json);
    });

    expect(docInfo).toBeTruthy();
    expect((docInfo as { attrs: { refId: string; kind: string } }).attrs.refId).toBe(
      'test-doc-1',
    );
    expect((docInfo as { attrs: { kind: string } }).attrs.kind).toBe('doc');
  });
});
