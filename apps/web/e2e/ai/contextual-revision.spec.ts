import { expect, test } from '@playwright/test';

type RevisionProbe = Window & {
  revisionInput?: { selectedText: string; beforeContext: string };
};

test('opens revision instructions from the exact selection and applies without reselecting', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'LanguageModel', {
      configurable: true,
      value: {
        availability: async () => 'available',
        create: async () => ({
          async prompt(input: string) {
            const request = JSON.parse(input);
            (window as RevisionProbe).revisionInput = request;
            if (
              request.selectedText !== 'the rough plan' ||
              !request.beforeContext.includes('Review ')
            ) {
              throw new Error('The model did not receive the second occurrence.');
            }
            return JSON.stringify({
              revision: 'the tentative plan',
              rationale: 'More precise wording.',
            });
          },
          destroy() {},
        }),
      },
    });
  });
  await page.goto('/');
  const draft = page.getByRole('textbox', { name: 'Document editor' });
  await expect(draft).toHaveAttribute('contenteditable', 'true', { timeout: 15_000 });
  await expect(page.locator('.lash-app')).not.toHaveAttribute('data-entrance', 'true');
  await draft.fill('Keep the rough plan. Review the rough plan.');
  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');

  await draft.locator('p').click();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  for (const _ of 'the rough plan') await page.keyboard.press('Shift+ArrowLeft');
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe('the rough plan');

  await page.getByRole('button', { name: 'Revise selection' }).click({ timeout: 10_000 });
  const instructions = page.getByRole('textbox', { name: 'Revision instructions or question' });
  await expect(instructions).toBeFocused();
  await expect(page.getByTestId('ai-review')).toHaveCount(0);
  expect(await page.evaluate(() => (window as RevisionProbe).revisionInput)).toBeUndefined();
  await instructions.fill('Use the words the tentative plan.');
  await page.getByRole('button', { name: 'Improve writing' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as RevisionProbe).revisionInput))
    .toMatchObject({
      selectedText: 'the rough plan',
      beforeContext: 'Keep the rough plan. Review ',
    });
  await expect(page.getByTestId('ai-original')).toHaveText('the rough plan');
  await expect(draft).toHaveText('Keep the rough plan. Review the rough plan.');
  await page.getByRole('button', { name: 'Apply revision' }).click();
  await expect(draft).toHaveText('Keep the rough plan. Review the tentative plan.');
});
