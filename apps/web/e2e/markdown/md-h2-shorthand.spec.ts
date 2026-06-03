import { expect, test } from '@playwright/test';

const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('md-h2-shorthand', () => {
  test('converts markdown heading and applies bold/italic hotkeys', async ({ page }) => {
    await page.goto('/');

    const editor = page.getByTestId('lash-editor-content');
    await editor.click();

    await page.keyboard.type('## ');
    await page.keyboard.type('Outline Title');
    await page.keyboard.press('Enter');

    await expect(editor.locator('h2')).toHaveText('Outline Title');

    await page.keyboard.press(`${modKey}+B`);
    await page.keyboard.insertText('Bold');
    await page.keyboard.press(`${modKey}+B`);
    await page.keyboard.insertText(' ');
    await page.keyboard.press(`${modKey}+I`);
    await page.keyboard.insertText('Italic');
    await page.keyboard.press(`${modKey}+I`);

    const finalDoc = await page.evaluate(() => {
      const editor = (
        window as unknown as {
          __lashEditor?: { state: { doc: { toJSON: () => unknown } } };
        }
      ).__lashEditor;
      return editor?.state.doc.toJSON();
    });

    const paragraphContent =
      (
        finalDoc as {
          content: Array<{ content?: Array<{ text?: string; marks?: Array<{ type: string }> }> }>;
        }
      )?.content?.[1]?.content ?? [];

    const boldMarkExists = paragraphContent.some(
      (node) => node.text?.includes('Bold') && node.marks?.some((mark) => mark.type === 'bold'),
    );
    const italicMarkExists = paragraphContent.some(
      (node) => node.text === 'Italic' && node.marks?.some((mark) => mark.type === 'italic'),
    );

    expect(boldMarkExists).toBe(true);
    expect(italicMarkExists).toBe(true);
  });
});
