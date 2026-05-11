import { expect, test } from '@playwright/test';
import path from 'path';

const fixturePath = path.join(__dirname, 'fixtures', 'table.md');

test.describe('md-table-import', () => {
  test('imports GitHub pipe tables into table nodes', async ({ page }) => {
    await page.goto('/');

    await page.setInputFiles('[data-testid="markdown-import-input"]', fixturePath);

    const table = page.locator('.lash-editor-content table');
    await expect(table).toBeVisible();
    // TipTap's default table renders all rows in <tbody>; GFM header rows
    // emit <th> cells in the first row but no separate <thead>. Assert
    // structural shape (1 header row of <th> + 3 body rows of <td>).
    await expect(table.locator('tr').first().locator('th')).toHaveCount(2);
    await expect(table.locator('tr')).toHaveCount(4);

    const docHasTable = await page.evaluate(() => {
      const editor = (window as unknown as {
        __lashEditor?: { getJSON: () => { content?: Array<{ type?: string }> } };
      }).__lashEditor;
      if (!editor) {
        return false;
      }
      const doc = editor.getJSON();
      return doc.content?.some((node) => node.type === 'table');
    });

    expect(docHasTable).toBe(true);
  });
});
