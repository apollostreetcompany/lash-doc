import { expect, test } from '@playwright/test';

import { createDocument, documentEditor, openSource } from '../chips/document-chip-journey';

test.use({ timezoneId: 'America/Los_Angeles', locale: 'ja-JP' });

test('inserts a date at the actual caret using the local calendar date and locale', async ({
  page,
}) => {
  // UTC is already Friday, while the writer is still on Thursday evening.
  await page.clock.setFixedTime(new Date('2026-06-19T02:00:00Z'));
  await openSource(page);
  await documentEditor(page).fill('Later paragraph');
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.type('Review @next Friday 3pm');

  const option = page.getByRole('option', { name: /6月19日/ });
  await expect(option).toBeVisible();
  await page.keyboard.press('Enter');
  const date = page.getByTestId('lash-inline-mention');
  await expect(date).toHaveText(/6月19日/);
  await expect(date).toHaveAttribute('data-iso', '2026-06-19T15:00:00-07:00');
  await expect(date).toHaveAttribute('title', '2026-06-19T15:00:00-07:00');
  await expect(documentEditor(page).locator('p').first()).toContainText('Review');
  await expect(documentEditor(page).locator('p').last()).toHaveText('Later paragraph');
  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');
  await page.reload();
  await expect(date).toHaveAttribute('data-iso', '2026-06-19T15:00:00-07:00');
});

test('chooses a real browser document with keyboard navigation', async ({ page }) => {
  const target = await createDocument(page, 'Research archive');
  await createDocument(page, 'Research notes');
  await openSource(page);
  await page.keyboard.type('Related @research');

  const picker = page.getByRole('listbox', { name: 'Insert a reference' });
  await expect(picker.getByRole('option')).toHaveCount(2);
  await page.keyboard.press('Home');
  await expect(picker).toHaveCount(0);
  await page.keyboard.press('End');
  await expect(picker).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await page.keyboard.press('Backspace');
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('option', { name: /Research notes/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('ArrowDown');
  await expect(picker.getByRole('option', { name: /Research archive/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Enter');
  await expect(documentEditor(page)).not.toContainText('@researc');
  await expect(page.getByTestId('lash-chip')).toHaveAttribute('href', target);
});

test('picks a document on a phone without changing unrelated writing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const target = await createDocument(page, 'Mobile outline');
  await openSource(page);
  await page.keyboard.type('See @Mobile');
  const option = page.getByRole('option', { name: /Mobile outline/ });
  await expect(option).toBeVisible();
  const box = await option.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  await option.click();
  await expect(documentEditor(page)).toContainText('See');
  await expect(page.getByTestId('lash-chip')).toHaveAttribute('href', target);
});
