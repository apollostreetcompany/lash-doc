import { expect, test, type Page } from '@playwright/test';

import { selectDiscussionTab } from '../discussion-tabs';

const title = 'Kickoff notes';
const firstDraft = 'The kickoff begins on Tuesday.';
const addedSentence = ' The review starts the following morning.';

async function leaveAndReopenDraft(page: Page) {
  await page.getByRole('link', { name: 'Documents', exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
  await page.getByRole('searchbox', { name: 'Search by title' }).fill(title);
  await page.getByRole('link', { name: /^Kickoff notes/ }).click();
  await expect(page.getByRole('textbox', { name: 'Document title' })).toHaveValue(title);
}

test('History retains the first and later edits after leaving as soon as they save', async ({
  page,
}) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'Document editor' });
  await expect(editor).toBeEditable();
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  await expect(page).toHaveURL(/\/doc\/doc-/);

  await page.getByRole('textbox', { name: 'Document title' }).fill(title);
  await editor.click();
  await page.keyboard.insertText(firstDraft);
  const saved = page.getByTestId('autosave-indicator');
  await expect(saved).toHaveText(/^All changes saved/);
  await leaveAndReopenDraft(page);
  await expect(editor.locator('p')).toHaveText(firstDraft);

  await selectDiscussionTab(page, 'history');
  const versions = page.getByTestId('history-version');
  await expect(versions).toHaveCount(1);
  await expect(page.getByTestId('history-diff-insert')).toHaveText(firstDraft);
  await page.getByRole('button', { name: 'Close activity panel' }).click();

  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(addedSentence);
  await expect(saved).toHaveText(/^All changes saved/);
  await leaveAndReopenDraft(page);
  await expect(editor.locator('p')).toHaveText(firstDraft + addedSentence);

  const status = page.getByRole('group', { name: 'Document status' });
  const history = status.getByRole('button', { name: 'History', exact: true });
  await expect(history).toBeVisible();
  await history.click();
  await expect(page.getByRole('tabpanel', { name: 'History', exact: true })).toBeVisible();
  await expect(versions).toHaveCount(2);
  await expect(page.getByTestId('history-diff-insert')).toHaveText(addedSentence.trim());

  await versions.first().click();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(editor.locator('p')).toHaveText(firstDraft);
  await expect(versions).toHaveCount(3);
});

test.describe('History entry on a phone', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('opens History directly and returns focus to the same control', async ({ page }) => {
    await page.goto('/');
    const editor = page.getByRole('textbox', { name: 'Document editor' });
    await expect(editor).toBeEditable();

    const status = page.getByRole('group', { name: 'Document status' });
    const history = status.getByRole('button', { name: 'History', exact: true });
    await expect(history).toBeInViewport();
    await history.tap();

    const tab = page.getByRole('tab', { name: 'History', exact: true });
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    const historyPanel = page.getByRole('tabpanel', { name: 'History', exact: true });
    await expect(historyPanel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(historyPanel).toBeHidden();
    await expect(history).toBeFocused();
  });

  test('keeps the desktop draft editable after resizing an open phone History drawer', async ({
    page,
  }) => {
    await page.goto('/');
    const editor = page.getByRole('textbox', { name: 'Document editor' });
    await expect(editor).toBeEditable();
    await selectDiscussionTab(page, 'history');

    const canvas = page.locator('#lash-main');
    const historyPanel = page.getByRole('tabpanel', { name: 'History', exact: true });
    const bodyPosition = () => page.evaluate(() => document.body.style.position);
    await expect(canvas).toHaveAttribute('inert', '');
    await expect.poll(bodyPosition).toBe('fixed');

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(historyPanel).toBeVisible();
    await expect(canvas).not.toHaveAttribute('inert');
    await expect.poll(bodyPosition).toBe('');
    await editor.click();
    await page.keyboard.insertText('The draft stays editable.');
    await expect(editor.locator('p')).toHaveText('The draft stays editable.');

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(historyPanel).toBeHidden();
    await expect(canvas).not.toHaveAttribute('inert');
    await expect.poll(bodyPosition).toBe('');
    await expect(editor.locator('p')).toHaveText('The draft stays editable.');
  });
});
