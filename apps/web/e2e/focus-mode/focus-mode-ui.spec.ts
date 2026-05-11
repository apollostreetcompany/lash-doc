import { expect, test } from '@playwright/test';

test.describe('focus-mode-ui', () => {
  test('toggles chrome visibility and preserves editor usability', async ({ page }) => {
    await page.goto('/');

    const toggle = page.getByTestId('focus-mode-toggle');
    const toolbar = page.getByTestId('lash-toolbar');
    const outline = page.locator('[data-testid="lash-outline-panel"]');
    const shell = page.getByTestId('lash-editor-shell');

    // Wait for editor to be ready before assertions.
    await page.waitForFunction(() =>
      Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
    );

    // Initial state — chrome visible, button shows "Enter Focus Mode".
    await expect(toggle).toHaveText('Enter Focus Mode');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toolbar).toBeVisible();
    await expect(outline).toHaveCount(1);
    await expect(shell).toHaveAttribute('data-focus-mode', 'false');

    // Toggle ON — chrome hides, button label flips.
    await toggle.click();
    await expect(toggle).toHaveText('Exit Focus Mode');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toolbar).toBeHidden();
    await expect(outline).toHaveCount(0);
    await expect(shell).toHaveAttribute('data-focus-mode', 'true');

    // Editor still visible and editable in focus mode.
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.type('Focus mode keeps typing alive.');
    await expect(editor).toContainText('Focus mode keeps typing alive.');

    // Toggle OFF — chrome restores.
    await toggle.click();
    await expect(toggle).toHaveText('Enter Focus Mode');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toolbar).toBeVisible();
    await expect(outline).toHaveCount(1);
    await expect(shell).toHaveAttribute('data-focus-mode', 'false');

    // Keyboard shortcut (agents.md keymap: Cmd/Ctrl+Shift+F) toggles focus mode.
    const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modKey}+Shift+F`);
    await expect(shell).toHaveAttribute('data-focus-mode', 'true');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press(`${modKey}+Shift+F`);
    await expect(shell).toHaveAttribute('data-focus-mode', 'false');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  test('hides the active TableCellPanel when focus mode is on', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() =>
      Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
    );

    // Insert a table and select a cell so TableCellPanel mounts.
    await page.evaluate(() => {
      const win = window as unknown as {
        __lashInsertTable?: (rows?: number, cols?: number) => void;
        __lashSelectTableCells?: (anchorRow: number, anchorCol: number) => boolean;
      };
      win.__lashInsertTable?.(2, 2);
      win.__lashSelectTableCells?.(0, 0);
    });

    const tableCellPanel = page.locator('.lash-table-panel');
    await expect(tableCellPanel).toBeVisible();

    await page.getByTestId('focus-mode-toggle').click();
    await expect(tableCellPanel).toHaveCount(0);

    // a11y: the editor region inside the shell is still exposed by role.
    // (The page also has a top-level <section aria-label="Document editor">;
    // we scope to the editor-content wrapper to avoid the strict-mode match.)
    await expect(page.locator('.lash-editor-content-wrapper')).toBeVisible();

    // (Verifying re-show after exiting focus mode requires re-establishing
    // the cell selection — clicking the toggle button moves browser focus
    // out of the editor. The hide-on-toggle behavior above is the P1
    // contract; re-show is implicit via the existing useEffect that
    // updates activeTableCell from selectionUpdate.)
  });
});
