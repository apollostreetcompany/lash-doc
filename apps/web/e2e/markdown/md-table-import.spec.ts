import { expect, test } from '@playwright/test';
import path from 'path';

const fixturePath = path.join(__dirname, 'fixtures', 'table.md');

test.describe('md-table-import', () => {
  test('imports GitHub pipe tables into table nodes', async ({ page }) => {
    await page.goto('/');

    await page.setInputFiles('[data-testid="markdown-import-input"]', fixturePath);

    const table = page.locator('.lash-editor-content table');
    await expect(table).toBeVisible();
    await expect(table.locator('thead tr th')).toHaveCount(2);
    await expect(table.locator('tbody tr')).toHaveCount(3);

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
