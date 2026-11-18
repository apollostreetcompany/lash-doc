import { expect, test } from '@playwright/test';

test('a status option can be clicked above the next row in a 100×20 table', async ({ page }) => {
  const documentId = 'table-picker-pointer';
  await page.addInitScript((id) => {
    const rows = Array.from({ length: 100 }, (_, row) => ({
      type: 'tableRow',
      content: Array.from({ length: 20 }, (_, column) => ({
        type: 'tableCell',
        attrs:
          row === 10 && column === 0
            ? { cellType: 'status', options: ['Open', 'Done'], value: 'Open' }
            : undefined,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell text' }] }],
      })),
    }));
    localStorage.setItem(
      'lash:body:' + id,
      JSON.stringify({
        version: 1,
        schemaVersion: 'lash-schema-v1',
        documentId: id,
        revision: 1,
        writeId: 'table-picker-pointer-fixture',
        savedAt: '2026-01-01T00:00:00.000Z',
        doc: { type: 'doc', content: [{ type: 'table', content: rows }] },
      }),
    );
  }, documentId);
  await page.goto('/doc/' + documentId);
  await expect(page.locator('[data-body-mutation-locked="false"]')).toBeVisible();
  const cells = page.locator('.ProseMirror td');
  await expect(cells).toHaveCount(2_000);

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
