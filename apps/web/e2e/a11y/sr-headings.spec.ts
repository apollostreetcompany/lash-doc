import { expect, test } from '@playwright/test';

test('sr-headings', async ({ page }) => {
  await page.goto('/');

  const editorRegion = page.getByRole('region', { name: 'Writing canvas' });
  const editor = editorRegion.getByRole('textbox', { name: 'Document editor' });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.click();

  const sections = [
    { level: 1, heading: 'Accessibility Title', body: 'Opening paragraph.' },
    { level: 2, heading: 'Section Alpha', body: 'Alpha body.' },
    { level: 3, heading: 'Nested Note', body: 'Nested body.' },
  ];
  for (const [index, section] of sections.entries()) {
    if (index > 0) await page.keyboard.press('Enter');
    await page.keyboard.press(`ControlOrMeta+Alt+${section.level}`);
    await page.keyboard.insertText(section.heading);
    await page.keyboard.press('Enter');
    await page.keyboard.insertText(section.body);
  }

  for (const { level, heading } of sections) {
    await expect(editorRegion.getByRole('heading', { level, name: heading })).toBeVisible();
  }

  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  const outline = page.getByRole('navigation', { name: 'Outline' });
  await expect(outline).toBeVisible();
  await expect(outline.getByRole('button', { name: 'Collapse Section Alpha' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(outline.getByRole('button', { name: 'Jump to Section Alpha' })).toBeVisible();
});
