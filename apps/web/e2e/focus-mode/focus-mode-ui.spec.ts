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
  });
});
