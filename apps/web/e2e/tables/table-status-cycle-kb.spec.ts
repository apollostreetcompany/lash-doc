import { expect, test } from '@playwright/test';

test.describe('table-status-cycle-kb', () => {
  test('cycles status cell options with keyboard interaction', async ({ page }) => {
    page.on('console', (msg) => {
      // eslint-disable-next-line no-console
      console.log('[browser]', msg.text());
    });
    await page.goto('/');
    const editor = page.getByTestId('lash-editor-content');
    await editor.click();

    const setup = await page.evaluate(() => {
      const win = window as unknown as {
        __lashInsertTable?: (rows?: number, cols?: number) => void;
        __lashSelectTableCells?: (anchorRow: number, anchorCol: number, headRow?: number, headCol?: number) => boolean;
        __lashTable?: { setCellType: (type: string, options?: string[]) => boolean };
      };
      (window as any).__LASH_TABLE_DEBUG = true;
      win.__lashInsertTable?.(2, 3);
      const selected = win.__lashSelectTableCells?.(0, 1) ?? false;
      const typed = win.__lashTable?.setCellType('status') ?? false;
      return { selected, typed };
    });

    expect(setup.selected).toBe(true);
    expect(setup.typed).toBe(true);

    const docSnapshot = await page.evaluate(() => {
      const editor = (window as unknown as { __lashEditor?: { getJSON: () => unknown } }).__lashEditor;
      return editor?.getJSON();
    });
    const cellAttrs = await page.evaluate(() => {
      const editor = (window as unknown as { __lashEditor?: { state: { doc: { toJSON: () => any } } } }).__lashEditor;
      const doc = editor?.state.doc.toJSON();
      if (!doc) {
        return null;
      }
      const table = doc.content?.find((node: { type: string }) => node.type === 'table');
      const firstRowSecondCell = table?.content?.[0]?.content?.[1];
      return firstRowSecondCell?.attrs ?? null;
    });
    expect(cellAttrs?.cellType).toBe('status');

    const statusControl = editor.locator('[data-role="table-cell-control"]:not([hidden])').first();
    await expect(statusControl).toHaveText('Todo');

    await page.keyboard.press('Enter');
    await expect(statusControl).toHaveAttribute('aria-expanded', 'true');

    await page.keyboard.press('ArrowDown');
    const activeOption = editor.locator('.lash-table-cell-menu-option[aria-selected="true"]').first();
    await expect(activeOption).toHaveText('In Progress');

    await page.keyboard.press('Enter');
    await expect(statusControl).toHaveAttribute('aria-expanded', 'false');
    await expect(statusControl).toHaveText('In Progress');
  });
});
