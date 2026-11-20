import { expect, test, type Page } from '@playwright/test';

test('finds and reopens an older title in a large document library', async ({ page }) => {
  await page.goto('/documents');
  await page.evaluate(() => {
    const records = Array.from({ length: 120 }, (_, index) => ({
      id: `archive-${index}`,
      title: index === 0 ? 'Original field notes' : `Workshop notes ${index}`,
      createdAt: '2024-05-01T12:00:00Z',
      updatedAt: new Date(Date.UTC(2024, 4, 1, 12, index)).toISOString(),
    }));
    records.push({
      id: `doc-v1-${'a'.repeat(64)}`,
      title: 'Old shared title from the browser',
      createdAt: '2024-05-01T12:00:00Z',
      updatedAt: '2024-05-03T12:00:00Z',
    });
    localStorage.setItem('lash:documents', JSON.stringify(records));
  });
  await page.reload();
  const list = page.getByRole('list', { name: 'Documents, most recent first' });
  await expect(list.getByRole('link').first()).toHaveAccessibleName(/^Workshop notes 119/);
  await expect(page.getByRole('link', { name: /^Old shared title from the browser/ })).toHaveCount(
    0,
  );
  const initialRows = await list.getByRole('link').count();
  expect(initialRows).toBeLessThan(120);
  await page.getByRole('button', { name: 'Show more documents' }).click();
  await expect(list.getByRole('link').nth(initialRows)).toBeFocused();
  await page.getByRole('searchbox', { name: 'Search by title' }).fill('original field');
  const older = list.getByRole('link', { name: /^Original field notes/ });
  await expect(older).toBeVisible();
  await older.click();
  await expect(page.getByRole('textbox', { name: 'Document title' })).toHaveValue(
    'Original field notes',
  );
  const options = page.getByRole('combobox', { name: 'Open document' });
  await expect(
    options.getByRole('option', { name: 'Old shared title from the browser' }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('lash:documents'))).toContain(
    'Old shared title from the browser',
  );
});

test('keeps an unreadable document list while a draft opened by its link stays editable', async ({
  page,
}) => {
  const path = '/doc/device-inventory-recovery';
  const legacyTitle = 'Earlier draft title';
  const originalBody = 'Original device copy.';
  const editedBody = 'The edited device copy stays here.';
  const raw = ` [ {"id":"device-inventory-recovery","title":"${legacyTitle}"}, {"unexpected":true} ] `;
  const editor = page.getByRole('textbox', { name: 'Document editor' });
  const title = page.getByRole('textbox', { name: 'Document title' });
  const expectRawRegistry = async () =>
    expect(await page.evaluate(() => localStorage.getItem('lash:documents'))).toBe(raw);

  await page.goto(path);
  await expect(editor).toBeEditable();
  await editor.fill(originalBody);
  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');
  await page.evaluate((value) => localStorage.setItem('lash:documents', value), raw);

  await page.goto('/documents');
  await expect(page.getByRole('main', { name: 'Documents' }).getByRole('alert')).toContainText(
    'Couldn’t load the documents in this browser.',
  );
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  await expect(
    page.getByText('Couldn’t create a document in this browser. Try again.'),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/documents$/u);
  await expectRawRegistry();

  await page.goto(path);
  await expect(editor).toHaveText(originalBody);
  await expect(title).toHaveValue(legacyTitle);
  const indexNotice = page.getByTestId('document-index-notice');
  await expect(indexNotice).toContainText('Lash couldn’t update the document list.');
  await page.getByTestId('new-document-button').click();
  await expect(
    page.getByText('Couldn’t create a document in this browser. Try again.'),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${path}$`, 'u'));
  await expectRawRegistry();

  await title.fill('Renamed device draft');
  await editor.fill(editedBody);
  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');
  await expect(indexNotice).toBeVisible();
  await expect(page.getByTestId('local-body-notice')).toHaveCount(0);
  await expectRawRegistry();

  await page.reload();
  await expect(editor).toHaveText(editedBody);
  await expect(editor).toBeEditable();
  await expect(title).toHaveValue('Renamed device draft');
  await expect(indexNotice).toBeVisible();
  await expectRawRegistry();
});

async function openDocuments(page: Page, compact: boolean) {
  if (compact) await page.getByRole('button', { name: 'Open navigation menu' }).click();
  const link = page.getByRole('link', { name: 'Documents', exact: true });
  if (compact) {
    await expect(link.getByText('Documents')).toBeVisible();
    expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await link.click();
  } else {
    await expect(link.getByText('Documents')).toBeVisible();
    await link.focus();
    await link.press('Enter');
  }
  await expect(page.getByRole('heading', { name: 'Documents', level: 1 })).toBeVisible();
}

async function createAndWrite(page: Page, title: string, body: string) {
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  await expect(page).toHaveURL(/\/doc\/doc-[a-z0-9-]+\/?$/);
  const editor = page.getByRole('textbox', { name: 'Document editor' });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await page.getByRole('textbox', { name: 'Document title' }).fill(title);
  await editor.fill(body);
  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');
  return new URL(page.url()).pathname;
}

test('finds the most recent local documents and reopens saved writing from the keyboard', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Document editor' })).toBeVisible();
  await openDocuments(page, false);
  const older = await createAndWrite(page, 'Launch outline', 'Draft the launch in four steps.');
  await openDocuments(page, false);
  await createAndWrite(page, 'Release checklist', 'Send the final draft for review.');
  await openDocuments(page, false);
  await page.reload();

  const documents = page.getByRole('list', { name: 'Documents, most recent first' });
  await expect(documents.getByRole('link').first()).toHaveAccessibleName(/^Release checklist/);
  await expect(documents.getByRole('link').nth(1)).toHaveAccessibleName(/^Launch outline/);

  const search = page.getByRole('searchbox', { name: 'Search by title' });
  await search.fill('  LAUNCH  ');
  await expect(documents.getByRole('link')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(documents.getByRole('link', { name: /^Launch outline/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`${older}$`));
  await expect(page.getByRole('textbox', { name: 'Document title' })).toHaveValue('Launch outline');
  await expect(page.getByRole('textbox', { name: 'Document editor' })).toContainText(
    'Draft the launch in four steps.',
  );
});

test('creates and reopens writing from Documents on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await openDocuments(page, true);
  const path = await createAndWrite(page, 'Pocket draft for review', 'Keep the first sentence.');
  await openDocuments(page, true);

  const search = page.getByRole('searchbox', { name: 'Search by title' });
  await search.fill('No matching document');
  await expect(page.getByText('No documents match your search.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);

  await page.getByRole('link', { name: /^Pocket draft for review/ }).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(page.getByRole('textbox', { name: 'Document editor' })).toContainText(
    'Keep the first sentence.',
  );
});
