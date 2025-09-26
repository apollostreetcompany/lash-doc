import { expect, test } from '@playwright/test';

const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

const toggleChecklistShortcut = `${modKey}+Shift+X`;

test.describe('checklist-nesting', () => {
  test('nests and outdents checklist items with Tab and Shift+Tab', async ({ page }) => {
    await page.goto('/');

    const editor = page.getByTestId('lash-editor-content');
    await editor.click();

    await page.keyboard.type('Top Task');
    await page.keyboard.press(toggleChecklistShortcut);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Nested Task');
    await page.keyboard.press('Tab');

    const items = editor.locator("li[data-type='taskItem']");
    await expect(items).toHaveCount(2);

    const nestedItem = items.nth(1);
    await expect(nestedItem.locator("xpath=ancestor::li[@data-type='taskItem'][1]")).toBeVisible();

    await page.keyboard.press('Shift+Tab');

    const updatedItems = editor.locator("li[data-type='taskItem']");
    await expect(updatedItems).toHaveCount(2);

    const requeryNested = updatedItems.nth(1);
    const parentAfterOutdent = await requeryNested.evaluate((node) => node.parentElement?.parentElement?.getAttribute('data-type'));
    expect(parentAfterOutdent).not.toBe('taskItem');
  });
});
