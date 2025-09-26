import { expect, test } from '@playwright/test';

const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('md-bold-italic-hotkeys', () => {
  test('toggles bold and italic via keyboard shortcuts while typing', async ({ page }) => {
    await page.goto('/');

    const editor = page.getByTestId('lash-editor-content');
    await editor.click();

    await page.keyboard.type('Normal ');

    await page.keyboard.press(`${modKey}+B`);
    await page.keyboard.type('Bold');
    await page.keyboard.press(`${modKey}+B`);

    await page.keyboard.type(' ');

    await page.keyboard.press(`${modKey}+I`);
    await page.keyboard.type('Italic');
    await page.keyboard.press(`${modKey}+I`);

    const docJson = await page.evaluate(() => {
      const editorInstance = (window as unknown as {
        __lashEditor?: { state: { doc: { toJSON: () => unknown } } };
      }).__lashEditor;
      return editorInstance?.state.doc.toJSON();
    });

    const paragraphContent = (docJson as {
      content?: Array<{ content?: Array<{ text?: string; marks?: Array<{ type: string }> }> }>;
    })?.content?.[0]?.content ?? [];

    const boldNode = paragraphContent.find((node) => node.text === 'Bold');
    const italicNode = paragraphContent.find((node) => node.text === 'Italic');
    const normalNode = paragraphContent.find((node) => node.text?.startsWith('Normal'));

    expect(boldNode).toBeTruthy();
    expect(italicNode).toBeTruthy();
    expect(normalNode).toBeTruthy();

    expect(boldNode?.marks?.some((mark) => mark.type === 'bold')).toBe(true);
    expect(italicNode?.marks?.some((mark) => mark.type === 'italic')).toBe(true);
    expect(boldNode?.marks?.some((mark) => mark.type === 'italic')).not.toBe(true);
    expect(italicNode?.marks?.some((mark) => mark.type === 'bold')).not.toBe(true);
    expect(normalNode?.marks ?? []).toHaveLength(0);
  });
});
