import { expect, test, type Page } from '@playwright/test';

test.use({ hasTouch: true });

type LashTestWindow = Window & {
  __lashEditor?: import('@tiptap/core').Editor;
  __lashEntranceSnapshots?: EntranceSnapshot[];
};

interface EntranceSnapshot {
  reducedMotion: boolean;
  sidebar: {
    animationName: string;
    right: number;
    transform: string;
    transitionDuration: string;
    visibility: string;
  };
  rail: null | {
    animationName: string;
    left: number;
    transform: string;
    transitionDuration: string;
    visibility: string;
  };
}

const clearLocalState = async (page: Page) => {
  await page.addInitScript(() => window.localStorage.clear());
};

const openDocument = async (page: Page, documentId: string) => {
  await clearLocalState(page);
  await page.goto(`/doc/${documentId}`);
  await page.waitForFunction(() => Boolean((window as LashTestWindow).__lashEditor));
};

const installEntranceObserver = async (page: Page) => {
  await page.addInitScript(() => {
    const snapshots: EntranceSnapshot[] = [];
    (window as LashTestWindow).__lashEntranceSnapshots = snapshots;
    let captureQueued = false;

    const capture = () => {
      if (captureQueued) return;
      captureQueued = true;
      window.requestAnimationFrame(() => {
        captureQueued = false;
        const app = document.querySelector<HTMLElement>('.lash-app');
        const sidebar = document.querySelector<HTMLElement>('.lash-sidebar');
        const rail = document.querySelector<HTMLElement>('.lash-rail');
        if (app?.dataset.entrance !== 'true' || !sidebar) return;
        const sidebarStyle = getComputedStyle(sidebar);
        const railStyle = rail ? getComputedStyle(rail) : null;
        snapshots.push({
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
          sidebar: {
            animationName: sidebarStyle.animationName,
            right: sidebar.getBoundingClientRect().right,
            transform: sidebarStyle.transform,
            transitionDuration: sidebarStyle.transitionDuration,
            visibility: sidebarStyle.visibility,
          },
          rail:
            rail && railStyle
              ? {
                  animationName: railStyle.animationName,
                  left: rail.getBoundingClientRect().left,
                  transform: railStyle.transform,
                  transitionDuration: railStyle.transitionDuration,
                  visibility: railStyle.visibility,
                }
              : null,
        });
      });
    };

    new MutationObserver(capture).observe(document, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ['data-entrance'],
    });
    capture();
  });
};

const durationInMilliseconds = (value: string) => {
  const first = value.split(',')[0]?.trim() ?? value;
  if (first.endsWith('ms')) return Number.parseFloat(first);
  if (first.endsWith('s')) return Number.parseFloat(first) * 1_000;
  return Number.NaN;
};

test('VIS-02 closed mobile drawers are absent from focus and opening establishes a modal focus path', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openDocument(page, 'vis-02-focus');

  const app = page.locator('.lash-app');
  const sidebar = page.locator('#lash-sidebar');
  const rail = page.locator('#lash-rail');
  const menu = page.getByTestId('topbar-mobile-menu');
  const discussion = page.getByTestId('topbar-discussion-button');

  await expect(sidebar).toHaveAttribute('aria-hidden', 'true');
  await expect(sidebar).toHaveAttribute('inert', '');
  await expect(rail).toHaveCount(0);
  await expect(menu).toHaveAttribute('aria-controls', 'lash-sidebar');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(discussion).not.toHaveAttribute('aria-controls', 'lash-rail');
  await expect(discussion).toHaveAttribute('aria-expanded', 'false');

  expect(
    await page.getByTestId('sidebar-collapse-toggle').evaluate((button) => {
      (button as HTMLButtonElement).focus();
      return document.activeElement === button;
    }),
  ).toBe(false);

  await menu.tap();
  await expect(app).toHaveAttribute('data-mobile-drawer', 'true');
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(sidebar).not.toHaveAttribute('aria-hidden', 'true');
  const sidebarClose = page.getByTestId('sidebar-mobile-close');
  await expect(sidebarClose).toBeFocused();
  await expect(page.getByTestId('lash-topbar')).toHaveAttribute('inert', '');

  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(
        () => document.activeElement?.closest('#lash-sidebar')?.id === 'lash-sidebar',
      ),
    ).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(app).toHaveAttribute('data-mobile-drawer', 'false');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeFocused();

  await discussion.tap();
  await expect(app).toHaveAttribute('data-rail-mobile', 'true');
  await expect(rail).toHaveCount(1);
  await expect(discussion).toHaveAttribute('aria-expanded', 'true');
  await expect(discussion).toHaveAttribute('aria-controls', 'lash-rail');
  await expect
    .poll(() =>
      page.evaluate(() => document.activeElement?.closest('#lash-rail')?.id === 'lash-rail'),
    )
    .toBe(true);
  if (process.env.LASH_B43_VISUAL_OUTPUT) {
    await page.screenshot({
      path: process.env.LASH_B43_VISUAL_OUTPUT,
      animations: 'disabled',
      fullPage: false,
    });
  }
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => document.activeElement?.closest('#lash-rail')?.id === 'lash-rail'),
    ).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(app).toHaveAttribute('data-rail-mobile', 'false');
  await expect(discussion).toHaveAttribute('aria-expanded', 'false');
  await expect(discussion).not.toHaveAttribute('aria-controls', 'lash-rail');
  await expect(rail).toHaveCount(0);
  await expect(discussion).toBeFocused();
});

for (const reducedMotion of [false, true]) {
  test(`VIS-02 closed mobile chrome stays off-canvas on its first frame${
    reducedMotion ? ' with reduced motion' : ''
  }`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
    await installEntranceObserver(page);
    await clearLocalState(page);
    await page.goto(`/doc/vis-02-entry-${reducedMotion ? 'reduced' : 'standard'}`);
    await page.waitForFunction(
      () => ((window as LashTestWindow).__lashEntranceSnapshots?.length ?? 0) > 0,
    );

    const snapshot = await page.evaluate(
      () => (window as LashTestWindow).__lashEntranceSnapshots?.[0] ?? null,
    );
    expect(snapshot).not.toBeNull();
    expect(snapshot?.reducedMotion).toBe(reducedMotion);
    expect(snapshot?.sidebar.animationName).toBe('none');
    expect(snapshot?.sidebar.visibility).toBe('hidden');
    expect(snapshot?.sidebar.right ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(1);
    expect(snapshot?.sidebar.transform).not.toBe('none');
    expect(snapshot?.rail).toBeNull();

    if (reducedMotion && snapshot) {
      expect(durationInMilliseconds(snapshot.sidebar.transitionDuration)).toBeLessThanOrEqual(0.01);
    }
  });
}
