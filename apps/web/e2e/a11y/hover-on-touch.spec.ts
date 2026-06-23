/**
 * Mobile hover-on-touch affordances
 *
 * Verifies that hover-only UI affordances have touch-friendly fallbacks:
 * - Avatar stack unstacks (margin-left -4px instead of -8px) on touch viewports
 * - Tooltip rule fires on :focus-visible (keyboard) not just :hover
 * - Sidebar item SVG nudges on :active (tap)
 */
import { expect, test, type Page } from '@playwright/test';

const builtCssText = async (page: Page): Promise<string> => {
  const stylesheetUrls = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href*="static/css"]'),
    ).map((link) => link.href),
  );

  expect(stylesheetUrls.length, 'expected at least one built CSS file').toBeGreaterThan(0);

  const cssChunks = await Promise.all(
    stylesheetUrls.map(async (url) => {
      const response = await page.request.get(url);
      expect(response.ok(), `failed to fetch ${url}`).toBe(true);
      return response.text();
    }),
  );

  return cssChunks.join('\n');
};

test.use({
  viewport: { width: 375, height: 812 },
  hasTouch: true,
  isMobile: true,
});

test.describe('hover-on-touch affordances', () => {
  test('avatar stack uses -4px margin (unstacked) on touch viewport', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('lash-home')).toBeVisible();

    // Solo documents no longer render placeholder collaborators, so attach a
    // CSS fixture to verify the mobile cascade without changing product state.
    await page.evaluate(() => {
      const stack = document.createElement('div');
      stack.className = 'lash-avatar-stack';
      stack.setAttribute('data-testid', 'avatar-stack-css-fixture');
      stack.innerHTML = '<span class="lash-avatar">A</span><span class="lash-avatar">B</span>';
      document.body.appendChild(stack);
    });

    const secondAvatar = page.locator(
      '[data-testid="avatar-stack-css-fixture"] .lash-avatar + .lash-avatar',
    );
    await expect(secondAvatar).toBeAttached();

    const marginLeft = await secondAvatar.evaluate(
      (el) => window.getComputedStyle(el as Element).marginLeft,
    );
    expect(marginLeft).toBe('-4px');
  });

  test('tooltip rule has a :focus-visible variant for keyboard a11y', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('lash-home')).toBeVisible();

    const cssText = await builtCssText(page);

    // Built CSS uses single-colon `:after` (legacy alias).
    expect(cssText).toMatch(/\.lash-icon-btn\[data-tooltip\]:focus-visible:(?::?)after/);
  });

  test('sidebar item SVG has a translateX(1px) rule on :active (tap)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('lash-home')).toBeVisible();

    const cssText = await builtCssText(page);

    expect(cssText).toMatch(/\.lash-sidebar-item:active\s+svg\s*\{[^}]*translateX\(1px\)/);
  });
});
