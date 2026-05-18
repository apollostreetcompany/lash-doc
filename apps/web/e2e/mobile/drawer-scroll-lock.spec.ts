import { devices, expect, test } from '@playwright/test';

// Mobile chromium emulates iOS Safari's viewport, hasTouch, and isMobile
// flags. We need all three to validate the iOS scroll-lock path:
//   - hasTouch + isMobile drive the `pointer: coarse` branches.
//   - The 375x812 viewport matches iPhone X / 13 mini, the device class we
//     care about most for the drawer UX.
test.use({
  ...devices['iPhone 13 Mini'],
  // Override the viewport so the test matches the spec verbatim.
  viewport: { width: 375, height: 812 },
});

test.describe('mobile drawer scroll-lock and focus restore', () => {
  test('locks body scroll and restores focus on close', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('lash-home')).toBeVisible();
    await page.waitForFunction(() =>
      Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
    );

    const hamburger = page.getByTestId('topbar-mobile-menu');
    await expect(hamburger).toBeVisible();
    await hamburger.click();

    // The drawer is open: body must be position-fixed so iOS cannot
    // rubber-band the page behind the sheet.
    await expect.poll(() => page.evaluate(() => document.body.style.position)).toBe('fixed');

    const lockedTop = await page.evaluate(() => document.body.style.top);
    expect(lockedTop.endsWith('px')).toBe(true);
    expect(await page.evaluate(() => document.body.style.width)).toBe('100%');

    // The canvas behind the drawer must be inert so AT cannot reach it.
    expect(
      await page.evaluate(() => document.querySelector('.lash-canvas')?.hasAttribute('inert')),
    ).toBe(true);

    // Close via Escape and verify the body style is restored.
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => document.body.style.position)).toBe('');
    expect(await page.evaluate(() => document.body.style.top)).toBe('');
    expect(await page.evaluate(() => document.body.style.width)).toBe('');

    // Focus must return to the hamburger trigger so the keyboard / AT
    // user is not stranded at the document root.
    const focusedTestId = await page.evaluate(
      () => document.activeElement?.getAttribute('data-testid') ?? null,
    );
    expect(focusedTestId).toBe('topbar-mobile-menu');
  });

  test('rail observer ignores rubber-band overscroll near bottom', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() =>
      Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
    );

    // Tap the History chip; the active tab should latch and not get
    // yanked back to chat by the observer mid-scroll.
    const historyChip = page.getByTestId('rail-tab-history');
    await expect(historyChip).toBeVisible();
    await historyChip.click();

    const activeBefore = await page.evaluate(() => {
      const tab = document.querySelector('[data-testid="rail-tab-history"]');
      return tab?.getAttribute('data-active') ?? null;
    });

    // Force a rubber-band style overscroll inside the rail body.
    await page.evaluate(() => {
      const body = document.querySelector<HTMLElement>('.lash-rail-body');
      if (!body) return;
      body.scrollTop = body.scrollHeight + 200;
    });
    await page.waitForTimeout(200);

    const activeAfter = await page.evaluate(() => {
      const tab = document.querySelector('[data-testid="rail-tab-history"]');
      return tab?.getAttribute('data-active') ?? null;
    });

    expect(activeAfter).toBe(activeBefore);
  });
});
