import { expect, test } from '@playwright/test';
import path from 'node:path';

const fixturePath = path.join(__dirname, 'fixtures', 'table.md');

test.describe('md-table-import', () => {
  test('imports GitHub pipe tables into table nodes', async ({ page }) => {
    const source = '/doc/markdown-table-source';
    await page.goto(source);
    const editor = page.getByRole('textbox', { name: 'Document editor' });
    await expect(editor).toBeEditable();
    await editor.fill('Source note stays intact');
    await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');
    const readSourceBody = () =>
      page.evaluate(() => window.localStorage.getItem('lash:body:markdown-table-source'));
    const sourceBefore = await readSourceBody();
    expect(sourceBefore).toContain('Source note stays intact');

    const pendingFileChooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Markdown', exact: true }).click();
    await (await pendingFileChooser).setFiles(fixturePath);
    const dialog = page.getByRole('dialog', { name: 'Import Markdown as new document' });
    await dialog.getByRole('button', { name: 'Create new document' }).click();
    await page.waitForURL((url) => url.pathname.startsWith('/doc/') && url.pathname !== source);

    await page.reload();
    const table = editor.getByRole('table');
    await expect(table).toBeVisible();
    const rows = table.getByRole('row');
    await expect(rows).toHaveCount(4);
    await expect(rows.first().locator('th')).toHaveText(['Status', 'Owner']);
    await expect(rows.nth(1).getByRole('cell')).toHaveText(['Todo', 'Alex']);
    await expect(rows.nth(2).getByRole('cell')).toHaveText(['In Progress', 'Blair']);
    await expect(rows.nth(3).getByRole('cell')).toHaveText(['Done', 'Casey']);

    await page.goto(source);
    await expect(editor).toHaveText('Source note stays intact');
    await expect(table).toHaveCount(0);
    expect(await readSourceBody()).toBe(sourceBefore);
  });
});
