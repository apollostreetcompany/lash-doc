import { expect, test, type Page } from '@playwright/test';

const SAMPLE_DOCUMENT = `
  <h1>Chapter One</h1>
  <p>Opening paragraph.</p>
  <h2>Section Alpha</h2>
  <p>Alpha body one.</p>
  <p>Alpha body two.</p>
  <h3>Deep Dive</h3>
  <p>Nested insight.</p>
  <h2>Section Beta</h2>
  <p>Beta body.</p>
`;

const loadDocument = async (page: Page) => {
  await page.evaluate((html) => {
    const editor = (window as unknown as { __lashEditor?: { commands: { setContent: (content: string) => void } } }).__lashEditor;
    editor?.commands.setContent(html);
  }, SAMPLE_DOCUMENT);

  await page.waitForFunction(() => {
    const outline = (window as unknown as { __lashOutlineItems?: Array<{ title: string }> }).__lashOutlineItems;
    return Array.isArray(outline) && outline.some((item) => item.title === 'Section Alpha');
  });

  const outline = await page.evaluate<
    Array<{ headingId: string; title: string }> | undefined
  >(() => {
    return (window as unknown as { __lashOutlineItems?: Array<{ headingId: string; title: string }> }).__lashOutlineItems;
  });

  const target = outline?.find((item) => item.title === 'Section Alpha');
  return target?.headingId;
};

test.describe('outline-collapse-basic', () => {
  test('collapses descendants and updates outline state', async ({ page }) => {
    await page.goto('/');

    const headingId = await loadDocument(page);
    expect(headingId).toBeTruthy();

    const alphaParagraph = page.getByText('Alpha body one.', { exact: true });
    await expect(alphaParagraph).toBeVisible();

    await page.getByTestId(`outline-toggle-${headingId}`).click();

    await expect(alphaParagraph).not.toBeVisible();

    const outlineEntry = page.locator(`[data-heading-id="${headingId}"]`);
    await expect(outlineEntry).toHaveAttribute('data-collapsed', 'true');
    await expect(page.getByTestId(`outline-toggle-${headingId}`)).toHaveAttribute('aria-expanded', 'false');

    const meta = outlineEntry.locator('.outline-meta');
    await expect(meta).toHaveText(/sections ·/);
  });
});
