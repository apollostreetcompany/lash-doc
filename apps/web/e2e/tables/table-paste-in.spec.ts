import { expect, test } from '@playwright/test';

test.describe('table-paste-in', () => {
  test('fills cell range from TSV clipboard data', async ({ page }) => {
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
      };
      win.__lashInsertTable?.(2, 2);
      const selected = win.__lashSelectTableCells?.(0, 0, 1, 1) ?? false;
      return { selected };
    });

    expect(setup.selected).toBe(true);

    await page.evaluate((tsv) => {
      // Dispatch on ProseMirror element, not wrapper
      const proseMirrorElement = document.querySelector('.ProseMirror');
      // Create a DataTransfer-like object
      const mockData: Record<string, string> = { 'text/plain': tsv };
      const dataTransfer = {
        getData: (format: string) => mockData[format] || '',
      };
      // Create ClipboardEvent and attach dataTransfer
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: dataTransfer, writable: false });
      proseMirrorElement?.dispatchEvent(event);
    }, 'Alpha\tBeta\nGamma\tDelta');

    const tableValues = await page.evaluate(() => {
      const editor = (window as unknown as { __lashEditor?: { state: { doc: { toJSON: () => any } } } }).__lashEditor;
      const doc = editor?.state.doc.toJSON();
      const table = doc?.content?.find((node: { type: string }) => node.type === 'table');
      if (!table) {
        return [];
      }
      return table.content.map((row: { content: Array<{ content: Array<{ content: Array<{ text?: string }> }> }> }) =>
        row.content.map((cell) => {
          const paragraph = cell.content?.[0];
          const textNode = paragraph?.content?.[0];
          return textNode?.text ?? '';
        }),
      );
    });

    expect(tableValues).toEqual([
      ['Alpha', 'Beta'],
      ['Gamma', 'Delta'],
    ]);
  });
});
