import { expect, test, type Page } from '@playwright/test';

interface TableTestNode {
  type: string;
  attrs?: { cellType?: string; value?: string };
  content?: TableTestNode[];
}

const ready = async (page: Page) => {
  await expect(page.getByRole('textbox', { name: 'Document editor' })).toBeEditable();
  await page.waitForFunction(() => {
    const win = window as Window & {
      __lashEditor?: unknown;
      __lashInsertTable?: unknown;
      __lashSelectTableCells?: unknown;
      __lashTable?: { setCellType?: unknown; setCellValue?: unknown };
    };
    return (
      win.__lashEditor &&
      typeof win.__lashInsertTable === 'function' &&
      typeof win.__lashSelectTableCells === 'function' &&
      typeof win.__lashTable?.setCellType === 'function' &&
      typeof win.__lashTable.setCellValue === 'function'
    );
  });
};

test('table-perf-100x20', async ({ page }) => {
  await page.goto('/doc/table-performance');
  await ready(page);

  const metrics = await page.evaluate(async () => {
    const win = window as unknown as {
      __lashEditor?: { state: { doc: { toJSON: () => TableTestNode } } };
      __lashInsertTable?: (rows?: number, cols?: number) => void;
      __lashSelectTableCells?: (
        anchorRow: number,
        anchorCol: number,
        headRow?: number,
        headCol?: number,
      ) => boolean;
      __lashTable?: {
        setCellType: (type: string, options?: string[]) => boolean;
        setCellValue: (value: string) => boolean;
      };
    };
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const insertStart = performance.now();
    win.__lashInsertTable?.(100, 20);
    await nextFrame();
    const insertMs = performance.now() - insertStart;

    const scroller = document.querySelector<HTMLTableElement>('.ProseMirror table');
    const scrollStart = performance.now();
    if (scroller) scroller.scrollLeft = scroller.scrollWidth - scroller.clientWidth;
    await nextFrame();
    const scrollMs = performance.now() - scrollStart;
    const scrollLeft = scroller?.scrollLeft ?? 0;

    const selectStart = performance.now();
    const selected = win.__lashSelectTableCells?.(99, 19) ?? false;
    const selectDispatchMs = performance.now() - selectStart;
    const selectFrameStart = performance.now();
    await nextFrame();
    const selectFrameMs = performance.now() - selectFrameStart;

    const commitStart = performance.now();
    const typed = win.__lashTable?.setCellType('status') ?? false;
    const valued = win.__lashTable?.setCellValue('Done') ?? false;
    const commitDispatchMs = performance.now() - commitStart;
    const commitFrameStart = performance.now();
    await nextFrame();
    const commitFrameMs = performance.now() - commitFrameStart;

    const doc = win.__lashEditor?.state.doc.toJSON();
    const table = doc?.content?.find((node) => node.type === 'table');
    const rows = table?.content?.length ?? 0;
    const cells = table?.content?.reduce((count, row) => count + (row.content?.length ?? 0), 0);
    const committedCell = table?.content?.[99]?.content?.[19]?.attrs;

    return {
      insertMs,
      scrollMs,
      scrollLeft,
      selectDispatchMs,
      selectFrameMs,
      commitDispatchMs,
      commitFrameMs,
      selected,
      typed,
      valued,
      rows,
      cells,
      committedCell,
    };
  });

  console.info('table-perf-100x20 metrics', JSON.stringify(metrics));

  expect(metrics.rows).toBe(100);
  expect(metrics.cells).toBe(2000);
  expect(metrics.selected).toBe(true);
  expect(metrics.typed).toBe(true);
  expect(metrics.valued).toBe(true);
  expect(metrics.committedCell).toMatchObject({ cellType: 'status', value: 'Done' });
  expect(metrics.insertMs).toBeLessThan(2_500);
  expect(metrics.scrollLeft).toBeGreaterThan(0);
  expect(metrics.scrollMs).toBeLessThan(120);
  expect(metrics.selectDispatchMs).toBeLessThan(50);
  // Dispatch is the product latency budget. Frame settling is still bounded,
  // but with enough room for shared CI runner scheduling variance.
  expect(metrics.selectFrameMs).toBeLessThan(500);
  expect(metrics.commitDispatchMs).toBeLessThan(80);
  expect(metrics.commitFrameMs).toBeLessThan(500);
});
