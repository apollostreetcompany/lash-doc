import { expect, test, type Page } from '@playwright/test';

const SAMPLE_DOCUMENT = `
  <h1>Accessibility Title</h1>
  <p>Opening paragraph.</p>
  <h2>Section Alpha</h2>
  <p>Alpha body.</p>
  <h3>Nested Note</h3>
  <p>Nested body.</p>
`;

const ready = async (page: Page) =>
  page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

const loadDocument = async (page: Page) => {
  await ready(page);

  await page.evaluate((html) => {
    const editor = (
      window as unknown as {
        __lashEditor?: { commands: { setContent: (content: string) => void } };
      }
    ).__lashEditor;
    editor?.commands.setContent(html);
  }, SAMPLE_DOCUMENT);

  await page.waitForFunction(() => {
    const outline = (window as unknown as { __lashOutlineItems?: Array<{ title: string }> })
      .__lashOutlineItems;
    return Array.isArray(outline) && outline.some((item) => item.title === 'Section Alpha');
  });

  return page.evaluate<Array<{ headingId: string; title: string }> | undefined>(() => {
    return (
      window as unknown as {
        __lashOutlineItems?: Array<{ headingId: string; title: string }>;
      }
    ).__lashOutlineItems;
  });
};

test('sr-headings', async ({ page }) => {
  await page.goto('/');
  const outline = await loadDocument(page);
  const alpha = outline?.find((item) => item.title === 'Section Alpha');
  expect(alpha).toBeTruthy();

  const editorRegion = page.getByRole('region', { name: 'Document editor' });
  await expect(
    editorRegion.getByRole('heading', { level: 1, name: 'Accessibility Title' }),
  ).toBeVisible();
  await expect(
    editorRegion.getByRole('heading', { level: 2, name: 'Section Alpha' }),
  ).toBeVisible();
  await expect(editorRegion.getByRole('heading', { level: 3, name: 'Nested Note' })).toBeVisible();

  await expect(page.getByRole('navigation', { name: 'Outline' })).toBeVisible();
  await expect(page.getByTestId(`outline-toggle-${alpha!.headingId}`)).toHaveAttribute(
    'aria-label',
    'Collapse Section Alpha',
  );
  await expect(page.getByRole('button', { name: 'Jump to Section Alpha' })).toBeVisible();
});
