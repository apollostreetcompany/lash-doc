import { expect, test, type Page } from '@playwright/test';

const runEditorCommand = async (page: Page, command: 'toggleBold' | 'toggleItalic') => {
  await page.evaluate((cmd) => {
    const editor = (window as unknown as { __lashEditor?: { chain: () => { focus: () => { [key: string]: () => { run: () => boolean } } } } }).__lashEditor;
    editor?.chain().focus()[cmd]().run();
  }, command);
};

test.describe('md-h2-shorthand', () => {
  test('converts markdown heading and applies bold/italic hotkeys', async ({ page }) => {
    await page.goto('/');

    const editor = page.getByTestId('lash-editor-content');
    await editor.click();

    await page.keyboard.type('## ');
    await page.keyboard.type('Outline Title');
    await page.keyboard.press('Enter');

    await expect(editor.locator('h2')).toHaveText('Outline Title');

    await runEditorCommand(page, 'toggleBold');
    await page.keyboard.type('Bold');
    await runEditorCommand(page, 'toggleBold');
    await page.keyboard.type(' ');
    await runEditorCommand(page, 'toggleItalic');
    await page.keyboard.type('Italic');
    await runEditorCommand(page, 'toggleItalic');

    const finalDoc = await page.evaluate(() => {
      const editor = (window as unknown as {
        __lashEditor?: { state: { doc: { toJSON: () => unknown } } };
      }).__lashEditor;
      return editor?.state.doc.toJSON();
    });

    const paragraphContent = (finalDoc as {
      content: Array<{ content?: Array<{ text?: string; marks?: Array<{ type: string }> }> }>;
    })?.content?.[1]?.content ?? [];

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
