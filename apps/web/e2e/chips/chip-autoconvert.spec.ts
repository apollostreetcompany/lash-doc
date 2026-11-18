import { expect, test } from '@playwright/test';

import { createDocument, documentEditor, openSource, pasteText } from './document-chip-journey';

test('pastes a real document chip and follows it in the same tab after reload', async ({
  page,
}) => {
  const target = await createDocument(page, 'Launch outline');
  await openSource(page);
  await pasteText(page, new URL(target, page.url()).href);

  const chip = page.getByTestId('lash-chip');
  await expect(chip).toHaveText(/Launch outline/);
  await expect(chip).toHaveAttribute('href', target);
  await expect(chip).toHaveAttribute('data-chip-kind', 'doc');
  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');

  await page.reload();
  await expect(chip).toHaveText(/Launch outline/);
  const tabs = page.context().pages().length;
  await chip.click();
  await expect(page).toHaveURL(new URL(target, page.url()).href);
  await expect(documentEditor(page)).toContainText('Writing in the related document.');
  expect(page.context().pages()).toHaveLength(tabs);
});

test('leaves a foreign lookalike, an unknown document, and a token-bearing URL intact', async ({
  page,
}) => {
  const target = await createDocument(page, 'Private research');
  await openSource(page);

  for (const url of [
    `https://lash.local.example.test${target}`,
    new URL('/doc/missing-document', page.url()).href,
    new URL(`${target}?token=literal-test-token`, page.url()).href,
  ]) {
    await pasteText(page, url);
    await expect(documentEditor(page)).toContainText(url);
    await expect(page.getByTestId('lash-chip')).toHaveCount(0);
    await expect(documentEditor(page)).not.toContainText('Private research');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
  }
});
