import { expect, test, type Locator } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

const expectPointerTarget = async (option: Locator) => {
  await expect(option).toBeVisible();
  await expect
    .poll(() =>
      option.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2),
        );
      }),
    )
    .toBe(true);
};

function readRangeAppearance(row: Locator) {
  return row.locator('td').evaluateAll((cells) =>
    cells.slice(16).map((cell) => {
      const { left, top, width, height } = cell.getBoundingClientRect();
      if (!cell.contains(document.elementFromPoint(left + width / 2, top + height / 2))) {
        throw new Error('Expected the four cells in the range comparison to be visible.');
      }
      const style = getComputedStyle(cell);
      return [style.background, style.boxShadow, style.outline, style.border].join(' ');
    }),
  );
}

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
              : row === 99 && column === 19
                ? { cellType: 'status', options: ['Open', 'Done', 'Blocked'], value: 'Open' }
                : undefined,
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: row < 98 ? 'Cell text' : `R${row + 1}C${column + 1}` },
              ],
            },
          ],
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
        doc: {
          type: 'doc',
          content: [
            table(2, 3),
            table(100, 20),
            { type: 'paragraph', content: [{ type: 'text', text: 'Notes below the table' }] },
          ],
        },
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

  const nearEdgeRow = wide.locator('tr').nth(98);
  const nearEdgeCells = nearEdgeRow.locator('td');
  await nearEdgeCells
    .last()
    .evaluate((cell) => cell.scrollIntoView({ block: 'center', inline: 'end' }));
  const selectedCoordinates = () =>
    wide
      .locator('.selectedCell')
      .evaluateAll((selected) =>
        selected.map((cell) => [
          (cell.parentElement as HTMLTableRowElement).rowIndex + 1,
          (cell as HTMLTableCellElement).cellIndex + 1,
        ]),
      );
  await nearEdgeCells.nth(17).locator('p').click();
  await expect.poll(selectedCoordinates).toEqual([]);
  const unselected = await readRangeAppearance(nearEdgeRow);
  const visuallyChangedColumns = async () =>
    (await readRangeAppearance(nearEdgeRow)).flatMap((appearance, index) =>
      appearance === unselected[index] ? [] : [17 + index],
    );

  await nearEdgeCells
    .nth(18)
    .locator('p')
    .click({ modifiers: ['Shift'] });
  await expect.poll(selectedCoordinates).toEqual([
    [99, 18],
    [99, 19],
  ]);
  expect.soft(await visuallyChangedColumns(), 'visible pointer selection').toEqual([18, 19]);
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(selectedCoordinates).toEqual([
    [99, 18],
    [99, 19],
    [99, 20],
  ]);
  expect.soft(await visuallyChangedColumns(), 'visible keyboard extension').toEqual([18, 19, 20]);
  const extendedCellText = nearEdgeCells.nth(19).getByText('R99C20', { exact: true });
  await expect(extendedCellText).toBeVisible();

  const statusCell = cells.nth(10 * 20);
  const picker = statusCell.getByRole('button', { name: 'Open', exact: true });
  await picker.evaluate((control) => control.scrollIntoView({ block: 'center' }));
  await picker.click();
  const canvas = page.getByRole('region', { name: 'Writing canvas' });
  const menus = canvas.getByRole('listbox');
  const option = (name: string) => menus.getByRole('option', { name, exact: true });
  const done = option('Done');
  await expectPointerTarget(done);

  await done.click();
  await expect(statusCell.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  await expect(statusCell).toHaveAttribute('data-picker-open', 'false');
  await expect(cells.nth(11 * 20)).toHaveText('Cell text');

  const edge = wide.locator('tr').nth(99).locator('td').nth(19);
  const edgeButton = (value: string) => edge.getByRole('button', { name: value, exact: true });
  await edgeButton('Open').click();
  await expect(edgeButton('Open')).toHaveAttribute('aria-expanded', 'true');
  await expectPointerTarget(option('Done'));
  await option('Done').click();
  await expect(edgeButton('Done')).toHaveAttribute('aria-expanded', 'false');

  const padding = await edge.evaluate((cell) => {
    const { left, bottom } = cell.getBoundingClientRect();
    const point = { x: left + 8, y: bottom - 8 };
    const target = document.elementFromPoint(point.x, point.y);
    if (!cell.contains(target) || target?.closest('button')) {
      throw new Error('Expected the last cell padding to receive pointer focus.');
    }
    return point;
  });
  await page.mouse.click(padding.x, padding.y, { clickCount: 3 });
  await expect.poll(selectedCoordinates).toEqual([[100, 20]]);
  await page.keyboard.press('Enter');
  await expect(option('Done')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(option('Blocked')).toHaveAttribute('aria-selected', 'true');
  await expectPointerTarget(option('Blocked'));
  await page.keyboard.press('Enter');
  await expect(edgeButton('Blocked')).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Enter');
  await expect(option('Blocked')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(edgeButton('Blocked')).toHaveAttribute('aria-expanded', 'false');
  await expect(wide.locator('tr').nth(99).locator('td').nth(18)).toHaveText('R100C19');
});
