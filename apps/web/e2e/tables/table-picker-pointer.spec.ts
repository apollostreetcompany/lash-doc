import { expect, test } from '@playwright/test';

test('a readable 100×20 table scrolls locally and keeps its status options clickable', async ({
  page,
}) => {
  const documentId = 'table-picker-pointer';
  await page.addInitScript((id) => {
    const table = (rowCount: number, columns: number) => ({
      type: 'table',
      content: Array.from({ length: rowCount }, (_, row) => ({
        type: 'tableRow',
        content: Array.from({ length: columns }, (_, column) => ({
          type: 'tableCell',
          attrs:
            row === 10 && column === 0
              ? { cellType: 'status', options: ['Open', 'Done'], value: 'Open' }
              : undefined,
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell text' }] }],
        })),
      })),
    });
    localStorage.setItem(
      'lash:body:' + id,
      JSON.stringify({
        version: 1,
        schemaVersion: 'lash-schema-v1',
        documentId: id,
        revision: 1,
        writeId: 'table-picker-pointer-fixture',
        savedAt: '2026-01-01T00:00:00.000Z',
        doc: { type: 'doc', content: [table(2, 3), table(100, 20)] },
      }),
    );
  }, documentId);
  await page.goto('/doc/' + documentId);
  await expect(page.locator('[data-body-mutation-locked="false"]')).toBeVisible();
  const tables = page.locator('.ProseMirror table');
  await expect(tables).toHaveCount(2);
  await expect(page.getByRole('table')).toHaveCount(2);
  const narrow = tables.first();
  const wide = tables.last();
  const cells = wide.locator('td');
  await expect(cells).toHaveCount(2_000);
  expect(await narrow.evaluate((table) => table.scrollWidth - table.clientWidth)).toBeLessThan(2);
  expect(
    await cells.nth(1).evaluate((cell) => cell.getBoundingClientRect().width),
  ).toBeGreaterThanOrEqual(100);
  await expect(cells.nth(1).locator('.lash-table-cell-control')).toBeHidden();
  await cells.nth(19).scrollIntoViewIfNeeded();
  expect(await wide.evaluate((table) => table.scrollLeft)).toBeGreaterThan(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThan(2);

  const statusCell = cells.nth(10 * 20);
  const picker = statusCell.getByRole('button', { name: 'Open', exact: true });
  await picker.evaluate((control) => control.scrollIntoView({ block: 'center' }));
  await picker.click();
  const done = statusCell.getByRole('option', { name: 'Done', exact: true });
  await expect(done).toBeVisible();
  await expect
    .poll(() =>
      done.evaluate((option) => {
        const rect = option.getBoundingClientRect();
        const target = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return option.contains(target);
      }),
    )
    .toBe(true);

  await done.click();
  await expect(statusCell.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  await expect(statusCell).toHaveAttribute('data-picker-open', 'false');
  await expect(cells.nth(11 * 20)).toHaveText('Cell text');
});
