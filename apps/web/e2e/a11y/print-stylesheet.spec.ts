import { expect, test, type Page } from '@playwright/test';

const ready = async (page: Page) =>
  page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

test('print stylesheet hides chrome and normalizes paper', async ({ page }) => {
  await page.goto('/');
  await ready(page);

  await page.emulateMedia({ media: 'print' });

  // Chromium needs a forced reflow before getComputedStyle picks up the
  // newly-active @media print rules.
  await page.evaluate(() => {
    void document.body.offsetHeight;
  });

  // Chrome elements should be hidden under print media.
  const hiddenSelectors = ['.lash-sidebar', '.lash-rail', '.lash-topbar', '.lash-toolbar-bar'];

  for (const selector of hiddenSelectors) {
    const display = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).display : null;
    }, selector);

    expect(display, `${selector} should exist and be display:none in print mode`).toBe('none');
  }

  // The document paper should render with a white background in print mode.
  const paperBackground = await page.evaluate(() => {
    const el = document.querySelector('.lash-doc-paper');
    return el ? getComputedStyle(el).backgroundColor : null;
  });

  expect(paperBackground).toBe('rgb(255, 255, 255)');
});
