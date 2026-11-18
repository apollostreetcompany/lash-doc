import { expect, test } from '@playwright/test';

import { seedOutlineDocument } from './seed-outline-document';

test.describe('outline-persist', () => {
  test('restores collapsed headings from local storage', async ({ page }) => {
    await page.goto('/');
    const { editor, outline } = await seedOutlineDocument(page);
    const entry = outline.getByRole('listitem').filter({
      has: page.getByRole('button', { name: 'Jump to Section Alpha' }),
    });
    const headingId = await entry.getAttribute('data-heading-id');
    if (!headingId) throw new Error('Expected a stable Section Alpha heading ID');

    await outline.getByRole('button', { name: 'Collapse Section Alpha' }).click();
    await expect(entry).toHaveAttribute('data-collapsed', 'true');
    await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');

    await page.reload();

    await expect(editor.getByRole('heading', { name: 'Section Alpha', level: 2 })).toBeVisible();
    await expect(editor.getByText('Alpha body one.', { exact: true })).toBeHidden();
    await expect(entry).toHaveAttribute('data-heading-id', headingId);
    await expect(entry).toHaveAttribute('data-collapsed', 'true');
    await outline.getByRole('button', { name: 'Expand Section Alpha' }).click();
    await expect(editor.getByText('Alpha body one.', { exact: true })).toBeVisible();
  });
});
