import { expect, test } from '@playwright/test';

test.describe('table-select-open-close', () => {
  test('opens, navigates, and commits select cell options', async ({ page }) => {
    await page.goto('/');
    const editor = page.getByTestId('lash-editor-content');
    await editor.click();

    const setup = await page.evaluate(() => {
      const win = window as unknown as {
        __lashInsertTable?: (rows?: number, cols?: number) => void;
        __lashSelectTableCells?: (anchorRow: number, anchorCol: number, headRow?: number, headCol?: number) => boolean;
        __lashTable?: { setCellType: (type: string, options?: string[]) => boolean };
      };
      win.__lashInsertTable?.(2, 3);
      const selected = win.__lashSelectTableCells?.(0, 2) ?? false;
      const typed = win.__lashTable?.setCellType('select', ['High', 'Medium', 'Low']) ?? false;
      return { selected, typed };
    });

    expect(setup.selected).toBe(true);
    expect(setup.typed).toBe(true);

    const selectCell = editor.locator('td[data-cell-type="select"]').first();
    const control = selectCell.locator('.lash-table-cell-control');
    await selectCell.click();

    await page.keyboard.press('Enter');
    await expect(selectCell).toHaveAttribute('data-picker-open', 'true');
    await expect(selectCell).toHaveAttribute('data-active-index', '0');

    await page.keyboard.press('ArrowDown');
    await expect(selectCell).toHaveAttribute('data-active-index', '1');
    await page.keyboard.press('Escape');
    await expect(selectCell).toHaveAttribute('data-picker-open', 'false');
    await expect(control).toHaveText('High');

    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(selectCell).toHaveAttribute('data-picker-open', 'false');
    await expect(control).toHaveText('Medium');
  });
});
