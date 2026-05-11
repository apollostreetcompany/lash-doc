import { expect, test, type Page } from '@playwright/test';

const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

const toggleChecklistShortcut = `${modKey}+Shift+X`;

const waitForEditor = async (page: Page) => {
  // Wait until the EditorWorkspace effect has bound `__lashEditor`, otherwise
  // keystrokes can race against editor mount and never reach ProseMirror.
  await page.waitForFunction(() => {
    return Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor);
  });
};

test.describe('checklist-nesting', () => {
  test('nests and outdents checklist items with Tab and Shift+Tab', async ({ page }) => {
    await page.goto('/');
    await waitForEditor(page);

    const editor = page.getByTestId('lash-editor-content');
    await editor.click();

    await page.keyboard.type('Top Task');
    await page.keyboard.press(toggleChecklistShortcut);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Nested Task');
    await page.keyboard.press('Tab');

    const items = editor.locator("li[data-type='taskItem']");
    await expect(items).toHaveCount(2);

    // After Tab, the nested item should be a descendant of another taskItem.
    const nestedItem = items.nth(1);
    await expect(
      nestedItem.locator("xpath=ancestor::li[@data-type='taskItem'][1]"),
    ).toBeVisible();

    // Toggle the outer (top) item; the nested item must keep its own state.
    const checkboxes = items.locator("input[type='checkbox']");
    await checkboxes.first().click();
    await expect(checkboxes.first()).toBeChecked();
    await expect(checkboxes.nth(1)).not.toBeChecked();
    await expect(items.first()).toHaveAttribute('data-checked', 'true');
    await expect(items.nth(1)).not.toHaveAttribute('data-checked', 'true');

    // Caret is in the nested item — Shift+Tab outdents it back to top level.
    await page.keyboard.press('Shift+Tab');

    const updatedItems = editor.locator("li[data-type='taskItem']");
    await expect(updatedItems).toHaveCount(2);

    // After outdent, the formerly-nested item is no longer a descendant of a
    // taskItem — its closest taskItem ancestor is itself (it has none above).
    const requeryNested = updatedItems.nth(1);
    const parentAfterOutdent = await requeryNested.evaluate(
      (node) => node.parentElement?.parentElement?.getAttribute('data-type'),
    );
    expect(parentAfterOutdent).not.toBe('taskItem');
  });
});
