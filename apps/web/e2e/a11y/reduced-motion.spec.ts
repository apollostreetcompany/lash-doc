import { expect, test } from '@playwright/test';

/**
 * Honor `prefers-reduced-motion: reduce` by zeroing out CSS animation
 * durations and delays on the major chrome surfaces. The global rule in
 * `apps/web/app/globals.css` sets `animation-duration: 0.01ms` so
 * keyframe events still fire imperceptibly, and `animation-delay: 0ms`
 * (CSSOM may normalize to `0s`). A representative slice of the shell is
 * audited; elements that aren't mounted in the current layout are
 * skipped.
 */
test.use({ reducedMotion: 'reduce' });

const TARGETS = ['.lash-sidebar', '.lash-topbar', '.lash-doc-paper', '.lash-rail'];

// Browsers may return time values in different forms (`0s`, `0ms`,
// `0.01ms`, `1e-05s`, etc.) — parse to seconds and compare numerically.
// 1ms = 0.001s, so anything <= 1ms is "effectively zero" for our purposes.
const ZERO_THRESHOLD_SECONDS = 0.001;

const toSeconds = (value: string): number => {
  const trimmed = value.trim();
  if (trimmed.endsWith('ms')) return parseFloat(trimmed) / 1000;
  if (trimmed.endsWith('s')) return parseFloat(trimmed);
  return Number.NaN;
};

const isAllZero = (value: string) =>
  value
    .split(',')
    .map(toSeconds)
    .every((seconds) => Number.isFinite(seconds) && seconds <= ZERO_THRESHOLD_SECONDS);

test('reduced motion zeroes animations', async ({ page }) => {
  // `test.use({ reducedMotion })` should already set this on the context,
  // but emulateMedia explicitly guarantees the page-level state too —
  // some Playwright + WebKit/Chromium combinations need both.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.waitForSelector('[data-testid="lash-editor-content"]');

  const rows = await page.evaluate((selectors) => {
    const matches = matchMedia('(prefers-reduced-motion: reduce)').matches;
    return {
      matches,
      values: selectors.map((sel) => {
        const el = document.querySelector(sel);
        if (!el) return { sel, dur: null, delay: null };
        const cs = getComputedStyle(el);
        return { sel, dur: cs.animationDuration, delay: cs.animationDelay };
      }),
    };
  }, TARGETS);

  expect(rows.matches, 'matchMedia(prefers-reduced-motion: reduce)').toBe(true);

  for (const row of rows.values) {
    if (row.dur === null || row.delay === null) continue;
    expect(isAllZero(row.dur), `${row.sel} animation-duration=${row.dur}`).toBe(true);
    expect(isAllZero(row.delay), `${row.sel} animation-delay=${row.delay}`).toBe(true);
  }
});
