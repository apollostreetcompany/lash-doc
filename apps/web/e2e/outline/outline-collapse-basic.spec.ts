import { expect, test } from '@playwright/test';

import { seedOutlineDocument } from './seed-outline-document';

test.describe('outline-collapse-basic', () => {
  test('collapses descendants and updates outline state', async ({ page }) => {
    await page.goto('/');
    const { editor, outline } = await seedOutlineDocument(page);

    const alphaParagraph = editor.getByText('Alpha body one.', { exact: true });
    const nestedParagraph = editor.getByText('Nested insight.', { exact: true });
    await expect(alphaParagraph).toBeVisible();
    await expect(nestedParagraph).toBeVisible();

    await outline.getByRole('button', { name: 'Collapse Section Alpha' }).click();

    await expect(alphaParagraph).toBeHidden();
    await expect(nestedParagraph).toBeHidden();
    await expect(editor.getByText('Beta body.', { exact: true })).toBeVisible();

    const expand = outline.getByRole('button', { name: 'Expand Section Alpha' });
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    const entry = outline.getByRole('listitem').filter({
      has: page.getByRole('button', { name: 'Jump to Section Alpha' }),
    });
    await expect(entry).toHaveAttribute('data-collapsed', 'true');
    await expect(entry.locator('.outline-meta')).toHaveText(/sections ·/);
  });
});
