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
    if (input === 'typing') {
      await page.route('**/api/account/session', (route) =>
        route.fulfill({ status: 204, headers: { 'x-lash-account-status': 'authenticated' } }),
      );
      let promotionRequests = 0;
      await page.route('**/api/documents/*/promote', (route) => {
        promotionRequests += 1;
        return route.abort();
      });
      await page.getByRole('button', { name: 'Share document', exact: true }).click();
      const share = page.getByRole('dialog', { name: /^Share “/u });
      await share.getByRole('button', { name: 'Save to my account', exact: true }).click();
      await expect(share.getByRole('alert')).toContainText('0 comments and 1 suggestion');
      expect(promotionRequests).toBe(0);
      await share.getByRole('button', { name: 'Close sharing', exact: true }).click();
    }
    await openSuggestions(page);
    await page.getByRole('button', { name: 'Accept suggestion' }).click();
    await expect(page.getByTestId('suggestion-status')).toHaveText('Suggestion accepted');

    await page.reload();
    await openSuggestions(page);
    await expect(editorFor(page)).toHaveText(`${reminder}${wording} once, then ${proposal}`);
    await expect(page.getByTestId('suggestion-status')).toHaveText('Suggestion accepted');
  });
}
