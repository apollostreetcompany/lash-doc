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
  await page.waitForFunction(() => {
    return Boolean(
      (window as unknown as { __lashEditor?: unknown }).__lashEditor,
    );
  });

  await page.evaluate((html) => {
    const editor = (window as unknown as { __lashEditor?: { commands: { setContent: (content: string) => void } } }).__lashEditor;
    editor?.commands.setContent(html);
  }, SAMPLE_DOCUMENT);

  await page.waitForFunction(() => {
    const outline = (window as unknown as { __lashOutlineItems?: Array<{ title: string }> }).__lashOutlineItems;
    return Array.isArray(outline) && outline.some((item) => item.title === 'Section Alpha');
  });
};

test.describe('outline-caret-move', () => {
  test('moves selection to next visible heading when collapsing', async ({ page }) => {
    await page.goto('/');
    await loadDocument(page);

    const headingData = await page.evaluate<
      | {
          alphaId: string;
          betaTitle: string;
          alphaSelection: number;
        }
      | null
    >(() => {
      const outline = (window as unknown as {
        __lashOutlineItems?: Array<{ headingId: string; title: string; contentFrom: number }>;
      }).__lashOutlineItems;
      if (!outline) {
        return null;
      }
      const alpha = outline.find((item) => item.title === 'Section Alpha');
      const beta = outline.find((item) => item.title === 'Section Beta');
      if (!alpha || !beta) {
        return null;
      }
      return { alphaId: alpha.headingId, betaTitle: beta.title, alphaSelection: alpha.contentFrom + 2 };
    });

    expect(headingData).toBeTruthy();

    await page.evaluate(({ from }) => {
      const editor = (window as unknown as {
        __lashEditor?: { chain: () => { setTextSelection: (range: { from: number; to: number }) => { run: () => void } } };
      }).__lashEditor;
      editor?.chain().setTextSelection({ from, to: from }).run();
    }, { from: headingData!.alphaSelection });

    await page.getByTestId(`outline-toggle-${headingData!.alphaId}`).click();

    const selectionInfo = await page.evaluate<
      | {
          from: number;
          to: number;
          slice: string;
        }
      | null
    >(() => {
      const editor = (window as unknown as {
        __lashEditor?: {
          state: {
            selection: { from: number; to: number };
            doc: {
              textBetween: (from: number, to: number, blockSeparator?: string, leafText?: string) => string;
              content: { size: number };
            };
          };
        };
      }).__lashEditor;
      if (!editor) {
        return null;
      }
      const { from, to } = editor.state.selection;
      const slice = editor.state.doc.textBetween(from, Math.min(from + 32, editor.state.doc.content.size), '\n', '\n');
      return { from, to, slice };
    });

    expect(selectionInfo).toBeTruthy();
    expect(selectionInfo!.slice).toContain(headingData!.betaTitle);
    await expect(page.locator(`.outline-entry[data-heading-id="${headingData!.alphaId}"]`)).toHaveAttribute('data-collapsed', 'true');
    await expect(page.getByText('Alpha body one.', { exact: true })).not.toBeVisible();
  });
});
