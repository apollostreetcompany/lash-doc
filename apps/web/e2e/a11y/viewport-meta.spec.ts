import { expect, test } from '@playwright/test';

/**
 * Mobile foundation: assert the viewport meta tag is present with
 * `width=device-width`, and that body min-height resolves to either
 * `100dvh` (modern browsers) or a pixel value matching the viewport
 * height (older browsers that fall through to the 100vh fallback).
 */
test('viewport meta + body min-height honors dynamic viewport', async ({ page }) => {
  await page.goto('/');

  // (a) viewport meta exists with width=device-width
  const viewport = page.locator('meta[name="viewport"]');
  await expect(viewport).toHaveCount(1);
  const content = await viewport.getAttribute('content');
  expect(content).toBeTruthy();
  expect(content).toContain('width=device-width');

  // (b) computed body min-height resolves to 100dvh (literal) or to a pixel
  // value equal to the viewport height (the 100vh fallback browsers compute).
  const { minHeight, innerHeight } = await page.evaluate(() => ({
    minHeight: window.getComputedStyle(document.body).minHeight,
    innerHeight: window.innerHeight,
  }));

  const pxMatch = /^(\d+(?:\.\d+)?)px$/.exec(minHeight);
  const px = pxMatch ? parseFloat(pxMatch[1]) : Number.NaN;
  const ok = minHeight === '100dvh' || (Number.isFinite(px) && Math.abs(px - innerHeight) <= 1);

  expect(ok, `body min-height was "${minHeight}", expected 100dvh or ~${innerHeight}px`).toBe(true);
});
