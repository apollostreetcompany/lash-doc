import { expect, test, type Page } from '@playwright/test';

interface TestOutlineItem {
  headingId: string;
  title: string;
  from: number;
}

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

const ready = async (page: Page) =>
  page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

const loadSectionAlpha = async (page: Page): Promise<TestOutlineItem> => {
  await page.evaluate((html) => {
    const editor = (window as unknown as { __lashEditor: import('@tiptap/core').Editor })
      .__lashEditor;
    editor.commands.setContent(html);
  }, SAMPLE_DOCUMENT);

  await page.waitForFunction(() => {
    const outline = (window as unknown as { __lashOutlineItems?: TestOutlineItem[] })
      .__lashOutlineItems;
    return Array.isArray(outline) && outline.some((item) => item.title === 'Section Alpha');
  });
  const section = await page.evaluate(() => {
    const outline = (window as unknown as { __lashOutlineItems?: TestOutlineItem[] })
      .__lashOutlineItems;
    return outline?.find((item) => item.title === 'Section Alpha') ?? null;
  });
  if (!section) {
    throw new Error('Section Alpha outline item did not load');
  }
  return section;
};

test.describe('sidebar regression', () => {
  test('keeps document outline reachable with collapsed desktop sidebar and focuses clicked heading', async ({
    page,
  }) => {
    await page.goto('/');
    await ready(page);
    const section = await loadSectionAlpha(page);

    await expect(page.locator('.lash-app')).toHaveAttribute('data-sidebar-collapsed', 'true');

    const outlineAccess = page.getByTestId('sidebar-outline-access');
    await expect(outlineAccess).toBeVisible();
    await expect(page.getByTestId('lash-document-outline')).toBeVisible();

    const jump = page.getByTestId(`outline-jump-${section.headingId}`);
    await expect(jump).toBeVisible();
    await jump.click();

    await expect
      .poll(() =>
        page.evaluate(() => {
          const editor = (window as unknown as { __lashEditor: import('@tiptap/core').Editor })
            .__lashEditor;
          return editor.state.selection.from;
        }),
      )
      .toBe(section.from);

    await outlineAccess.click();
    await expect(page.locator('.lash-app')).toHaveAttribute('data-sidebar-collapsed', 'false');
  });

  test('mobile drawer closes from its visible close button and restores focus', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await ready(page);

    const app = page.locator('.lash-app');
    const hamburger = page.getByTestId('topbar-mobile-menu');
    await expect(hamburger).toBeVisible();
    await hamburger.click();

    await expect(app).toHaveAttribute('data-mobile-drawer', 'true');
    const closeButton = page.getByTestId('sidebar-mobile-close');
    await expect(closeButton).toBeVisible();
    await closeButton.click();

    await expect(app).toHaveAttribute('data-mobile-drawer', 'false');
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null))
      .toBe('topbar-mobile-menu');
  });
});
