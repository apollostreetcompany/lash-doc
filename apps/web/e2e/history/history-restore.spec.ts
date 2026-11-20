import { expect, test } from '@playwright/test';

import { selectDiscussionTab } from '../discussion-tabs';

test('compares two saved device versions and restores the selected destination', async ({
  page,
}) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'Document editor' });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.click();
  await page.keyboard.insertText('Alpha');
  await selectDiscussionTab(page, 'history');
  await expect(page.getByTestId('history-panel')).toBeVisible();
  await expect(page.getByTestId('history-version')).toHaveCount(1);
  await expect(page.getByTestId('history-count')).toContainText(/1 version/);
  await expect(page.getByTestId('history-selected-version')).toContainText('Version 1');

  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(' beta');
  await expect(page.getByTestId('history-version')).toHaveCount(2);
  const diff = page.getByTestId('history-diff');
  await expect(diff).toBeVisible();
  await expect(diff).toHaveAttribute('aria-label', 'Version diff');
  await expect(diff).toHaveAttribute('aria-describedby', /history-diff-announcement-/);
  const announcement = page.getByTestId('history-diff-announcement');
  await expect(announcement).toHaveAttribute('aria-live', 'polite');
  await expect(announcement).toContainText('inserted "beta"');
  const insertion = page.getByTestId('history-diff-insert');
  await expect(insertion).toContainText(' beta');
  await expect(insertion).toHaveAttribute(
    'aria-label',
    'Inserted text by local-user as edit: beta',
  );

  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(' gamma');
  const versions = page.getByTestId('history-version');
  await expect(versions).toHaveCount(3);
  const baseline = page.getByRole('combobox', { name: 'Compare with', exact: true });
  await expect(baseline.locator('option:checked')).toHaveText('Previous version');
  await expect(insertion).toHaveText(' gamma');

  await baseline.selectOption({ label: 'Version 1' });
  await expect(diff).toHaveAttribute('aria-label', 'Version diff, Version 1 to Version 3');
  await expect(insertion).toHaveText(' beta gamma');
  await expect(insertion).toHaveAttribute('aria-label', 'Inserted text: beta gamma');
  await expect(page.getByTestId('history-selected-version')).toHaveText('Version 3');
  await expect(page.getByRole('button', { name: 'Read version', exact: true })).toBeVisible();

  await versions.first().click();
  await expect(baseline.locator('option:checked')).toHaveText('Previous version');
  await baseline.selectOption({ label: 'Version 3' });
  await expect(diff).toHaveAttribute('aria-label', 'Version diff, Version 3 to Version 1');
  await expect(page.getByTestId('history-diff-delete')).toHaveText(' beta gamma');
  await expect(page.getByTestId('history-selected-version')).toHaveText('Version 1');
  await page.getByTestId('history-restore-button').click();

  await expect(editor).toHaveText('Alpha');
  await expect(versions).toHaveCount(4);
});
