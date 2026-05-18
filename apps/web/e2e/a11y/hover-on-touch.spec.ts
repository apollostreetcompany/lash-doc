/**
 * Mobile hover-on-touch affordances
 *
 * Verifies that hover-only UI affordances have touch-friendly fallbacks:
 * - Avatar stack unstacks (margin-left -4px instead of -8px) on touch viewports
 * - Tooltip rule fires on :focus-visible (keyboard) not just :hover
 * - Sidebar item SVG nudges on :active (tap)
 */
import { expect, test } from '@playwright/test';

test.use({
  viewport: { width: 375, height: 812 },
  hasTouch: true,
  isMobile: true,
});

test.describe('hover-on-touch affordances', () => {
  test('avatar stack uses -4px margin (unstacked) on touch viewport', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('lash-home')).toBeVisible();

    // The avatar stack itself is display:none at <=767px (we hide it in mobile
    // chrome), but the second-avatar margin still resolves through the cascade
    // and is observable via getComputedStyle. We only need to assert the rule
    // applied, not that the element is laid out.
    const secondAvatar = page.locator('.lash-avatar-stack .lash-avatar + .lash-avatar').first();
    await expect(secondAvatar).toBeAttached();

    const marginLeft = await secondAvatar.evaluate(
      (el) => window.getComputedStyle(el as Element).marginLeft,
    );
    expect(marginLeft).toBe('-4px');
  });

  test('tooltip rule has a :focus-visible variant for keyboard a11y', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('lash-home')).toBeVisible();

    const stylesheetUrl = await page.evaluate(() => {
      const link = document.querySelector(
        'link[rel="stylesheet"][href*="static/css"]',
      ) as HTMLLinkElement | null;
      return link?.href ?? null;
    });
    expect(stylesheetUrl).not.toBeNull();

    const response = await page.request.get(stylesheetUrl as string);
    const cssText = await response.text();

    // Built CSS uses single-colon `:after` (legacy alias).
    expect(cssText).toMatch(/\.lash-icon-btn\[data-tooltip\]:focus-visible:(?::?)after/);
  });

  test('sidebar item SVG has a translateX(1px) rule on :active (tap)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('lash-home')).toBeVisible();

    const stylesheetUrl = await page.evaluate(() => {
      const link = document.querySelector(
        'link[rel="stylesheet"][href*="static/css"]',
      ) as HTMLLinkElement | null;
      return link?.href ?? null;
    });
    expect(stylesheetUrl).not.toBeNull();

    const response = await page.request.get(stylesheetUrl as string);
    const cssText = await response.text();

    expect(cssText).toMatch(/\.lash-sidebar-item:active\s+svg\s*\{[^}]*translateX\(1px\)/);
  });
});
