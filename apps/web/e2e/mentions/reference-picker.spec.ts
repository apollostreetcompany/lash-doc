import { expect, test } from '@playwright/test';

import { createDocument, documentEditor, openSource } from '../chips/document-chip-journey';

test.use({ timezoneId: 'America/Los_Angeles', locale: 'ja-JP' });

test('keeps synthetic identities out of the normal mention picker and Discussion', async ({
  page,
}) => {
  await openSource(page);
  await page.keyboard.type('@Ada');
  await expect(documentEditor(page)).toHaveText('@Ada');
  await expect(page.getByRole('listbox', { name: 'Insert a reference' })).toHaveCount(0);

  await page.getByTestId('topbar-discussion-button').click();
  await expect(page.getByRole('tab', { name: 'Chat' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Activity (test fixture)' })).toHaveCount(0);
  await expect(page.getByTestId('synthetic-mention-fixture')).toHaveCount(0);
});

test('inserts a date at the actual caret using the local calendar date and locale', async ({
  page,
}) => {
  // UTC is already Friday, while the writer is still on Thursday evening.
  await page.clock.setFixedTime(new Date('2026-06-19T02:00:00Z'));
  await openSource(page);
  await page.keyboard.insertText('Review');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('Later paragraph');
  const paragraphs = documentEditor(page).locator('p');
  await expect(paragraphs).toHaveText(['Review', 'Later paragraph']);
  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');

  const target = paragraphs.first();
  const tail = await target.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    const paragraph = element.getBoundingClientRect();
    return { x: text.right - paragraph.left + 2, y: text.top - paragraph.top + text.height / 2 };
  });
  await target.click({ position: tail });
  await expect
    .poll(() =>
      target.evaluate((element) => {
        const selection = window.getSelection();
        if (
          !selection?.isCollapsed ||
          !selection.focusNode ||
          !element.contains(selection.focusNode)
        )
          return false;
        const suffix = document.createRange();
        suffix.setStart(selection.focusNode, selection.focusOffset);
        suffix.setEnd(element, element.childNodes.length);
        return !suffix.toString();
      }),
    )
    .toBe(true);
  await page.keyboard.type(' @next Friday 3pm');

  const option = page.getByRole('option', { name: /6月19日/ });
  await expect(option).toBeVisible();
  await page.keyboard.press('Enter');
  const date = target.getByTestId('lash-inline-mention');
  await expect(date).toHaveText(/6月19日/);
  await expect(date).toHaveAttribute('data-iso', '2026-06-19T15:00:00-07:00');
  await expect(date).toHaveAttribute('title', '2026-06-19T15:00:00-07:00');
  await expect(target).toHaveText(/^Review\s+@6月19日/u);
  await expect(paragraphs).toHaveCount(2);
  await expect(paragraphs.last()).toHaveText('Later paragraph');
  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');
  await page.reload();
  await expect(date).toHaveAttribute('data-iso', '2026-06-19T15:00:00-07:00');
  await expect(paragraphs.last()).toHaveText('Later paragraph');
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

test.describe('mobile reference picker', () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
  });

  test('picks a document on a phone without changing unrelated writing', async ({ page }) => {
    const target = await createDocument(page, 'Mobile outline');
    await openSource(page);
    await page.keyboard.type('See @Mobile');
    const picker = page.getByRole('listbox', { name: 'Insert a reference' });
    const option = picker.getByRole('option', { name: /Mobile outline/ });
    await expect(option).toBeVisible();
    await expect
      .poll(async () => (await option.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(44);
    const box = await option.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    await option.tap();
    await expect(documentEditor(page)).toContainText('See');
    await expect(page.getByTestId('lash-chip')).toHaveAttribute('href', target);
  });
});
