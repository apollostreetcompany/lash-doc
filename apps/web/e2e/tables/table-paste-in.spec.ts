import { expect, test } from '@playwright/test';

test.describe('table-paste-in', () => {
  test('fills cell range from TSV clipboard data', async ({ page }) => {
    await page.goto('/');
    const editor = page.getByTestId('lash-editor-content');
    await editor.click();

    const setup = await page.evaluate(() => {
      const win = window as unknown as {
        __lashInsertTable?: (rows?: number, cols?: number) => void;
        __lashSelectTableCells?: (anchorRow: number, anchorCol: number, headRow?: number, headCol?: number) => boolean;
      };
      win.__lashInsertTable?.(2, 2);
      const selected = win.__lashSelectTableCells?.(0, 0, 1, 1) ?? false;
      return { selected };
    });

    expect(setup.selected).toBe(true);

    await page.evaluate((tsv) => {
      const editorElement = document.querySelector('[data-testid="lash-editor-content"]');
      const data = new DataTransfer();
      data.setData('text/plain', tsv);
      const event = new ClipboardEvent('paste', { clipboardData: data });
      editorElement?.dispatchEvent(event);
    }, 'Alpha\tBeta\nGamma\tDelta');

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
      ['Alpha', 'Beta'],
      ['Gamma', 'Delta'],
    ]);
  });
});
