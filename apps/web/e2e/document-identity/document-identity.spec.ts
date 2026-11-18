import { expect, test, type Page } from '@playwright/test';

type LashTestWindow = Window & {
  __lashEditor?: {
    readonly isEditable: boolean;
    commands: {
      setContent: (content: string) => boolean;
    };
  };
};

const SECTION_ALPHA_HEADING_ID = 'fixture-section-alpha';
const SAMPLE_DOCUMENT = `
  <h1>Chapter One</h1>
  <p>Opening paragraph.</p>
  <h2 data-heading-id="${SECTION_ALPHA_HEADING_ID}">Section Alpha</h2>
  <p>Alpha body one.</p>
  <h2>Section Beta</h2>
  <p>Beta body.</p>
`;

const docUrl = (docId: string) => `/doc/${docId}`;

const clearDocState = async (page: Page, docIds: string[]) => {
  await page.goto('/');
  await page.evaluate((ids) => {
    window.localStorage.removeItem('lash:documents');
    for (const id of ids) {
      window.localStorage.removeItem(`lash:title:${id}`);
      window.localStorage.removeItem(`lash-outline:${id}`);
    }
  }, docIds);
};

const loadOutlineFixture = async (page: Page) => {
  await expect(page.locator('.ProseMirror[contenteditable="true"]')).toBeVisible();
  await page.waitForFunction(
    () => (window as LashTestWindow).__lashEditor?.isEditable === true,
    undefined,
    { timeout: 5_000 },
  );
  const applied = await page.evaluate((html) => {
    const editor = (window as LashTestWindow).__lashEditor;
    if (!editor) throw new Error('Lash editor test hook is unavailable');
    return editor.commands.setContent(html);
  }, SAMPLE_DOCUMENT);
  expect(applied).toBe(true);
  const sectionAlpha = page.locator(`.outline-entry[data-heading-id="${SECTION_ALPHA_HEADING_ID}"]`);
  await expect(sectionAlpha).toContainText('Section Alpha');
  return sectionAlpha;
};

test.describe('real document identity', () => {
  test('keeps titles isolated across two /doc routes and reloads', async ({ page }) => {
    const alpha = 'identity-alpha';
    const beta = 'identity-beta';
    await clearDocState(page, [alpha, beta]);

    await page.goto(docUrl(alpha));
    await expect(page.getByTestId('lash-doc-title-input')).toBeVisible();
    await page.getByTestId('lash-doc-title-input').fill('Alpha brief');
    await expect(page.getByTestId('document-open-select').locator('option:checked')).toHaveText(
      'Alpha brief',
    );

    await page.goto(docUrl(beta));
    await expect(page.getByTestId('lash-doc-title-input')).toHaveValue('Untitled document');
    await page.getByTestId('lash-doc-title-input').fill('Beta brief');
    await expect(page.getByTestId('document-open-select').locator('option:checked')).toHaveText(
      'Beta brief',
    );

    await page.goto(docUrl(alpha));
    await expect(page.getByTestId('lash-doc-title-input')).toHaveValue('Alpha brief');

    await page.goto(docUrl(beta));
    await expect(page.getByTestId('lash-doc-title-input')).toHaveValue('Beta brief');
  });

  test('creates a new document and navigates to a stable /doc/[id] URL', async ({ page }) => {
    await clearDocState(page, ['demo-document']);
    await page.goto('/');

    await expect(page.getByTestId('new-document-button')).toBeVisible();
    await page.getByTestId('new-document-button').click();

    await expect(page).toHaveURL(/\/doc\/doc-[a-z0-9-]+$/);
    const createdPath = new URL(page.url()).pathname;
    await expect(page.getByTestId('document-open-select')).toHaveValue(createdPath);

    await page.reload();
    await expect(page).toHaveURL(new RegExp(`${createdPath}$`));
    await expect(page.getByTestId('document-open-select')).toHaveValue(createdPath);
  });

  test('opens an existing document from the document switcher', async ({ page }) => {
    const alpha = 'registry-alpha';
    const beta = 'registry-beta';
    await clearDocState(page, [alpha, beta]);

    await page.goto(docUrl(alpha));
    await expect(page.getByTestId('lash-doc-title-input')).toBeVisible();
    await page.getByTestId('lash-doc-title-input').fill('Registry Alpha');

    await page.goto(docUrl(beta));
    await expect(page.getByTestId('lash-doc-title-input')).toBeVisible();
    await page.getByTestId('lash-doc-title-input').fill('Registry Beta');

    await page.goto(docUrl(beta));
    await expect(page.getByTestId('document-open-select')).toBeVisible();
    await page.getByTestId('document-open-select').selectOption(docUrl(alpha));

    await expect(page).toHaveURL(new RegExp(`${docUrl(alpha)}$`));
    await expect(page.getByTestId('lash-doc-title-input')).toHaveValue('Registry Alpha');
  });

  test('keeps outline collapsed state scoped to the routed document id', async ({ page }) => {
    const alpha = 'outline-alpha';
    const beta = 'outline-beta';
    await clearDocState(page, [alpha, beta]);

    await page.goto(docUrl(alpha));
    const alphaSection = await loadOutlineFixture(page);
    await alphaSection.getByTestId(`outline-toggle-${SECTION_ALPHA_HEADING_ID}`).click();
    await expect(alphaSection).toHaveAttribute('data-collapsed', 'true');

    await page.goto(docUrl(beta));
    const betaSection = await loadOutlineFixture(page);
    await expect(page.getByText('Alpha body one.', { exact: true })).toBeVisible();
    await expect(betaSection).toHaveAttribute('data-collapsed', 'false');
  });
});
