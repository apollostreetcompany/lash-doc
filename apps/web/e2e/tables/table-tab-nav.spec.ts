import { expect, test } from '@playwright/test';

test.describe('table-tab-nav', () => {
  test('tab and shift+tab move between cells across rows', async ({ page }) => {
    await page.goto('/');
    const editor = page.getByTestId('lash-editor-content');
    await editor.click();

    await page.evaluate(() => {
      const win = window as unknown as { __lashInsertTable?: (rows?: number, cols?: number) => void };
      win.__lashInsertTable?.(2, 2);
    });

    await page.keyboard.type('A1');
    await page.keyboard.press('Tab');
    await page.keyboard.type('A2');
    await page.keyboard.press('Tab');
    await page.keyboard.type('B1');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.type('-back');

    const tableValues = await page.evaluate(() => {
      const editor = (window as unknown as { __lashEditor?: { state: { doc: { toJSON: () => any } } } }).__lashEditor;
      const doc = editor?.state.doc.toJSON();
      const table = doc?.content?.find((node: { type: string }) => node.type === 'table');
      if (!table) {
        return [];
      }
      return table.content.map((row: { content: Array<{ content: Array<{ content: Array<{ text?: string }> }> }> }) =>
        row.content.map((cell) => {
          const paragraph = cell.content?.[0];
          const textNode = paragraph?.content?.[0];
          return textNode?.text ?? '';
        }),
      );
    });

    expect(tableValues).toEqual([
      ['A1', 'A2-back'],
      ['B1', ''],
    ]);
  });
});
