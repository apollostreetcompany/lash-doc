import { expect, test, type Page } from '@playwright/test';

const ready = async (page: Page) =>
  page.waitForFunction(() =>
    Boolean(
      (
        window as unknown as {
          __lashEditor?: unknown;
          __lashInsertTable?: unknown;
          __lashSelectTableCells?: unknown;
          __lashTable?: unknown;
        }
      ).__lashEditor,
    ),
  );

test('table-perf-100x20', async ({ page }) => {
  await page.goto('/');
  await ready(page);

  const metrics = await page.evaluate(async () => {
    const win = window as unknown as {
      __lashEditor?: { state: { doc: { toJSON: () => any } } };
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

    const wrapper = document.querySelector<HTMLElement>('.lash-editor-content-wrapper');
    const scrollStart = performance.now();
    if (wrapper) {
      wrapper.scrollLeft = wrapper.scrollWidth;
      wrapper.scrollTop = wrapper.scrollHeight;
    }
    await nextFrame();
    const scrollMs = performance.now() - scrollStart;

    const selectStart = performance.now();
    const selected = win.__lashSelectTableCells?.(99, 19) ?? false;
    await nextFrame();
    const selectMs = performance.now() - selectStart;

    const commitStart = performance.now();
    const typed = win.__lashTable?.setCellType('status') ?? false;
    const valued = win.__lashTable?.setCellValue('Done') ?? false;
    await nextFrame();
    const commitMs = performance.now() - commitStart;

    const doc = win.__lashEditor?.state.doc.toJSON();
    const table = doc?.content?.find((node: { type: string }) => node.type === 'table');
    const rows = table?.content?.length ?? 0;
    const cells = table?.content?.reduce(
      (count: number, row: { content?: unknown[] }) => count + (row.content?.length ?? 0),
      0,
    );

    return { insertMs, scrollMs, selectMs, commitMs, selected, typed, valued, rows, cells };
  });

  expect(metrics.rows).toBe(100);
  expect(metrics.cells).toBe(2000);
  expect(metrics.selected).toBe(true);
  expect(metrics.typed).toBe(true);
  expect(metrics.valued).toBe(true);
  expect(metrics.insertMs).toBeLessThan(2_500);
  expect(metrics.scrollMs).toBeLessThan(120);
  expect(metrics.selectMs).toBeLessThan(120);
  expect(metrics.commitMs).toBeLessThan(150);
});
