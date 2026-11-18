import { expect, test } from '@playwright/test';

test('types the first paragraph in order immediately after leaving a heading', async ({ page }) => {
  await page.goto('/doc/heading-body-typing');
  const editor = page.getByRole('textbox', { name: 'Document editor' });
  await expect(editor).toBeEditable();
  await editor.click();

  for (const [index, level] of [1, 2, 3, 1, 2, 3, 1, 2, 3].entries()) {
    const title = `Chapter ${index + 1}`;
    const paragraph = 'Opening paragraph.';
    await page.keyboard.type(`${'#'.repeat(level)} `);
    await page.keyboard.type(title);
    await page.keyboard.press('Enter');
    await page.keyboard.type(paragraph);

    await expect(editor.locator(':scope > :is(h1, h2, h3)').nth(index)).toHaveText(title);
    await expect(editor.locator(':scope > p').nth(index)).toHaveText(paragraph);
    await page.keyboard.press('Enter');
  }

  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');
  await page.reload();
  await expect(editor.locator(':scope > p').filter({ hasText: 'Opening paragraph.' })).toHaveCount(
    9,
  );
});

test('keeps the first character ordered when writing consecutive paragraphs', async ({ page }) => {
  await page.goto('/doc/paragraph-entry-typing');
  const editor = page.getByRole('textbox', { name: 'Document editor' });
  await expect(editor).toBeEditable();
  await editor.click();
  const paragraphs = editor.locator(':scope > p');

  for (let index = 0; index < 9; index += 1) {
    if (index > 0) await page.keyboard.press('Enter');
    const text = `Opening paragraph ${index + 1}.`;
    await page.keyboard.type(text);
    await expect(paragraphs.nth(index)).toHaveText(text);
  }

  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('After the blank line.');
  await expect(paragraphs.nth(9)).toHaveText('');
  await expect(paragraphs.nth(10)).toHaveText('After the blank line.');
});
