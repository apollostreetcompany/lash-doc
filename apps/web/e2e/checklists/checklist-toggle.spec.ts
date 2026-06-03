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

test.describe('checklist-toggle', () => {
  test('toggles individual checklist items without affecting nested items', async ({ page }) => {
    await page.goto('/');
    await waitForEditor(page);

    const editor = page.getByTestId('lash-editor-content');
    await editor.click();

    await page.keyboard.insertText('Parent');
    await page.keyboard.press(toggleChecklistShortcut);
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('Child');
    await page.keyboard.press('Tab');

    const items = editor.locator("li[data-type='taskItem']");
    await expect(items).toHaveCount(2);

    const checkboxes = items.locator("input[type='checkbox']");
    await expect(checkboxes).toHaveCount(2);

    const parentCheckbox = checkboxes.first();
    const childCheckbox = checkboxes.nth(1);

    await parentCheckbox.click();

    // Toggling the parent must NOT propagate to the nested child item.
    await expect(parentCheckbox).toBeChecked();
    await expect(childCheckbox).not.toBeChecked();

    // The DOM attribute mirrors the node state — TipTap reflects checked
    // state on the <li data-type="taskItem"> element via `data-checked`.
    await expect(items.first()).toHaveAttribute('data-checked', 'true');
    await expect(items.nth(1)).not.toHaveAttribute('data-checked', 'true');
  });
});
