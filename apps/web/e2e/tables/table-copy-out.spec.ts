import { expect, test } from '@playwright/test';

test.describe('table-copy-out', () => {
  test('copies selected cells as TSV text', async ({ page }) => {
    await page.goto('/');
    const editor = page.getByTestId('lash-editor-content');
    await editor.click();

    const applied = await page.evaluate(() => {
      const win = window as unknown as {
        __lashInsertTable?: (rows?: number, cols?: number) => void;
        __lashSelectTableCells?: (anchorRow: number, anchorCol: number, headRow?: number, headCol?: number) => boolean;
        __lashTable?: { setCellType: (type: string, options?: string[]) => boolean; setCellValue: (value: string) => boolean };
      };
      win.__lashInsertTable?.(2, 2);
      const values = [
        ['One', 'Two'],
        ['Three', 'Four'],
      ];
      const results: Array<{ selected: boolean; typed: boolean; value: boolean }> = [];
      values.forEach((row, rowIndex) => {
        row.forEach((value, colIndex) => {
          const selected = win.__lashSelectTableCells?.(rowIndex, colIndex) ?? false;
          const typed = win.__lashTable?.setCellType('text') ?? false;
          const valueResult = win.__lashTable?.setCellValue(value) ?? false;
          results.push({ selected, typed, value: valueResult });
        });
      });
      const rangeSelected = win.__lashSelectTableCells?.(0, 0, 1, 1) ?? false;
      return { results, rangeSelected };
    });

    applied.results.forEach((entry) => {
      expect(entry.selected).toBe(true);
      expect(entry.typed).toBe(true);
      expect(entry.value).toBe(true);
    });
    expect(applied.rangeSelected).toBe(true);

    const copied = await page.evaluate(() => {
      const editorElement = document.querySelector('[data-testid="lash-editor-content"]');
      const data = new DataTransfer();
      const event = new ClipboardEvent('copy', { clipboardData: data });
      editorElement?.dispatchEvent(event);
      return data.getData('text/plain');
    });

    expect(copied).toBe('One\tTwo\nThree\tFour');
  });
});
