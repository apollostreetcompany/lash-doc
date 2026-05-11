import { expect, test } from '@playwright/test';

// agents.md C.1 (Test ID: chip-revert):
// With caret inside a chip, Cmd/Ctrl+K reverts the chip to a plain link node.
const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('chip-revert', () => {
  test('Cmd/Ctrl+K inside a chip reverts it to a plain link', async ({ page }) => {
    await page.goto('/');

    const editor = page.getByTestId('lash-editor-content');
    await editor.click();

    await page.waitForFunction(() => {
      return Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor);
    });

    // Seed a chip via paste.
    await page.evaluate((url) => {
      const proseMirror = document.querySelector('.ProseMirror');
      const data: Record<string, string> = { 'text/plain': url };
      const dataTransfer = { getData: (format: string) => data[format] || '' };
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: dataTransfer, writable: false });
      proseMirror?.dispatchEvent(event);
    }, 'https://lash.local/doc/test-doc-1');

    const chipLocator = page.getByTestId('lash-chip').first();
    await expect(chipLocator).toBeVisible();
    // Wait for resolver to land so revert produces the resolved title (not the URL).
    await expect(chipLocator).toContainText('Internal Doc test-doc-1');

    // Position the caret adjacent to the chip — chips are atomic so the
    // caret lives directly before or after. After paste the selection is
    // after the chip; revert handles both nodeBefore and nodeAfter.
    await page.keyboard.press('ArrowLeft');

    // Trigger revert.
    await page.keyboard.press(`${modKey}+K`);

    // Chip should be gone from the DOM.
    await expect(page.getByTestId('lash-chip')).toHaveCount(0);

    // Document should now contain a plain link (text with `link` mark) where
    // the chip used to be.
    const linkInfo = await page.evaluate(() => {
      type DocNode = {
        type?: string;
        content?: DocNode[];
        text?: string;
        marks?: Array<{ type: string; attrs?: { href?: string } }>;
        attrs?: Record<string, unknown>;
      };
      const editorInstance = (window as unknown as {
        __lashEditor?: { state: { doc: { toJSON: () => DocNode } } };
      }).__lashEditor;
      const json = editorInstance?.state.doc.toJSON();
      const findChipNode = (node: DocNode | undefined): DocNode | null => {
        if (!node) return null;
        if (node.type === 'chip') return node;
        if (Array.isArray(node.content)) {
          for (const child of node.content) {
            const hit = findChipNode(child);
            if (hit) return hit;
          }
        }
        return null;
      };
      const findLinkText = (node: DocNode | undefined): { text: string; href: string } | null => {
        if (!node) return null;
        if (node.type === 'text' && Array.isArray(node.marks)) {
          const linkMark = node.marks.find((mark) => mark.type === 'link');
          if (linkMark && typeof node.text === 'string') {
            return { text: node.text, href: linkMark.attrs?.href ?? '' };
          }
        }
        if (Array.isArray(node.content)) {
          for (const child of node.content) {
            const hit = findLinkText(child);
            if (hit) return hit;
          }
        }
        return null;
      };
      return {
        chip: findChipNode(json),
        link: findLinkText(json),
      };
    });

    expect(linkInfo.chip).toBeNull();
    expect(linkInfo.link).not.toBeNull();
    expect(linkInfo.link?.href).toBe('https://lash.local/doc/test-doc-1');
    expect(linkInfo.link?.text).toContain('Internal Doc test-doc-1');
  });
});
