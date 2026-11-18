import { expect, test, type Page } from '@playwright/test';

import { body, editorFor, proposal, proposeWording, wording } from './suggestion-flow';

async function openSuggestions(page: Page) {
  await page.getByRole('button', { name: 'Suggest wording' }).click();
}

const reminder = 'Reminder: ';

for (const input of ['typing', 'pasting'] as const) {
  test(`remembers the moved selection and accepted decision after ${input} and reload`, async ({
    page,
  }) => {
    await page.goto(`/doc/suggestion-durable-${input}`);
    const editor = await proposeWording(page);
    await expect(editor).toHaveText(body);

    if (input === 'pasting') {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.evaluate((text) => navigator.clipboard.writeText(text), reminder);
    }

    await editor.getByText(body, { exact: true }).click();
    await page.keyboard.press('Home');
    if (input === 'pasting') {
      await page.keyboard.press('ControlOrMeta+v');
    } else {
      await page.keyboard.type(reminder);
    }
    await expect(editor).toHaveText(reminder + body);
    await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');

    await page.reload();
    await expect(editorFor(page)).toHaveText(reminder + body);
    await openSuggestions(page);
    await page.getByRole('button', { name: 'Accept suggestion' }).click();
    await expect(page.getByTestId('suggestion-status')).toHaveText('Suggestion accepted');

    await page.reload();
    await openSuggestions(page);
    await expect(editorFor(page)).toHaveText(`${reminder}${wording} once, then ${proposal}`);
    await expect(page.getByTestId('suggestion-status')).toHaveText('Suggestion accepted');
  });
}
