import { expect, test } from '@playwright/test';

const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

const toggleChecklistShortcut = `${modKey}+Shift+X`;

test.describe('checklist-toggle', () => {
  test('toggles individual checklist items without affecting nested items', async ({ page }) => {
    await page.goto('/');

    const editor = page.getByTestId('lash-editor-content');
    await editor.click();

    await page.keyboard.type('Parent');
    await page.keyboard.press(toggleChecklistShortcut);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Child');
    await page.keyboard.press('Tab');

    const checkboxes = editor.locator("li[data-type='taskItem'] input[type='checkbox']");
    await expect(checkboxes).toHaveCount(2);

    const parentCheckbox = checkboxes.first();
    const childCheckbox = checkboxes.nth(1);

    await parentCheckbox.click();

    await expect(parentCheckbox).toBeChecked();
    await expect(childCheckbox).not.toBeChecked();
  });
});
