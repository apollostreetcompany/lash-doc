import { expect, test } from '@playwright/test';

test.describe('table-enter-newline', () => {
  test('enter inserts a new paragraph inside a text cell', async ({ page }) => {
    await page.goto('/');
    const editor = page.getByTestId('lash-editor-content');
    await editor.click();

    await page.evaluate(() => {
      const win = window as unknown as { __lashInsertTable?: (rows?: number, cols?: number) => void };
      win.__lashInsertTable?.(1, 1);
    });

    await page.keyboard.type('Line one');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Line two');

    const paragraphs = await page.evaluate(() => {
      const editor = (window as unknown as { __lashEditor?: { state: { doc: { toJSON: () => any } } } }).__lashEditor;
      const doc = editor?.state.doc.toJSON();
      const table = doc?.content?.find((node: { type: string }) => node.type === 'table');
      const firstCell = table?.content?.[0]?.content?.[0];
      return firstCell?.content?.map((block: { content?: Array<{ text?: string }> }) =>
        block.content?.map((segment) => segment.text ?? '').join('') ?? '',
      );
    });

    expect(paragraphs).toEqual(['Line one', 'Line two']);
  });
});
