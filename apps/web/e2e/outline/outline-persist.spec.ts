import { expect, test, type Page } from '@playwright/test';

const SAMPLE_DOCUMENT = `
  <h1>Chapter One</h1>
  <p>Opening paragraph.</p>
  <h2>Section Alpha</h2>
  <p>Alpha body one.</p>
  <p>Alpha body two.</p>
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

  return outline?.find((item) => item.title === 'Section Alpha')?.headingId;
};

test.describe('outline-persist', () => {
  test('restores collapsed headings from local storage', async ({ page }) => {
    await page.goto('/');

    const headingId = await loadDocument(page);
    expect(headingId).toBeTruthy();

    await page.getByTestId(`outline-toggle-${headingId}`).click();
    await expect(page.locator(`[data-heading-id="${headingId}"]`)).toHaveAttribute('data-collapsed', 'true');

    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const reloadedHeadingId = await loadDocument(page);
    expect(reloadedHeadingId).toBe(headingId);

    const alphaParagraph = page.getByText('Alpha body one.', { exact: true });
    await expect(alphaParagraph).not.toBeVisible();
    await expect(page.locator(`[data-heading-id="${headingId}"]`)).toHaveAttribute('data-collapsed', 'true');
  });
});
