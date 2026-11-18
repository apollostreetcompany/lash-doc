import { expect, test, type Page } from '@playwright/test';

const INVITATION = 'Start writing…';

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
  };
  rail: {
    animationName: string;
    left: number;
    transform: string;
    transitionDuration: string;
  } | null;
}

const clearLocalState = async (page: Page) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
};

const waitForEditableDocument = async (page: Page) => {
  const editable = page.getByRole('textbox', { name: 'Document editor' });
  await expect(editable).toHaveAttribute('contenteditable', 'true');
  return editable;
};

const openEmptyDocument = async (page: Page, documentId: string) => {
  await clearLocalState(page);
  await page.goto(`/doc/${documentId}`);
  return waitForEditableDocument(page);
};

const installEntranceObserver = async (page: Page) => {
  await page.addInitScript(() => {
    const snapshots: EntranceSnapshot[] = [];
    (window as LashTestWindow).__lashEntranceSnapshots = snapshots;

    const capture = () => {
      if (snapshots.length > 0) return;
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
        },
        rail:
          rail && railStyle
            ? {
                animationName: railStyle.animationName,
                left: rail.getBoundingClientRect().left,
                transform: railStyle.transform,
                transitionDuration: railStyle.transitionDuration,
              }
            : null,
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
  if (value.endsWith('ms')) return Number.parseFloat(value);
  if (value.endsWith('s')) return Number.parseFloat(value) * 1_000;
  return Number.NaN;
};

test.describe('stranger-visible document entry', () => {
  test('desktop empty paper is named, comfortably clickable, non-mutating, and stable on typing', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const editable = await openEmptyDocument(page, 'stranger-entry-desktop');
    const emptyParagraph = editable.locator(`p[data-placeholder="${INVITATION}"]`);

    await expect(editable).toHaveAttribute('role', 'textbox');
    await expect(editable).toHaveAttribute('aria-multiline', 'true');
    await expect(editable).toHaveAttribute('aria-placeholder', INVITATION);
    await expect(emptyParagraph).toHaveCount(1);

    await expect(page.locator('.lash-app')).toHaveAttribute('data-entrance', 'false');
    const before = await editable.boundingBox();
    expect(before?.height ?? 0).toBeGreaterThanOrEqual(224);
    await editable.click({ position: { x: 72, y: Math.min(180, (before?.height ?? 224) - 16) } });
    await expect(editable).toBeFocused();

    await page.keyboard.type('A clear first thought.');
    await expect(editable).toContainText('A clear first thought.');
    await expect(editable.locator('[data-placeholder]')).toHaveCount(0);

    const after = await editable.boundingBox();
    expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0))).toBeLessThanOrEqual(1);
    const storedBody = () =>
      page.evaluate(() => localStorage.getItem('lash:body:stranger-entry-desktop'));
    await expect.poll(storedBody).toContain('A clear first thought.');
    expect(await storedBody()).not.toContain(INVITATION);
  });

  test('mobile empty paper preserves the same invitation, focus target, and typing behavior', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const editable = await openEmptyDocument(page, 'stranger-entry-mobile');

    await expect(editable.locator(`p[data-placeholder="${INVITATION}"]`)).toHaveCount(1);
    const box = await editable.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(224);
    await editable.tap({ position: { x: 40, y: Math.min(150, (box?.height ?? 224) - 16) } });
    await expect(editable).toBeFocused();

    await page.keyboard.type('Mobile thought.');
    await expect(editable).toContainText('Mobile thought.');
    await expect(editable.locator('[data-placeholder]')).toHaveCount(0);
  });

  test('read-only and print modes suppress invitation rendering while preserving the editor name', async ({
    page,
  }) => {
    const editable = await openEmptyDocument(page, 'stranger-entry-modes');
    const emptyParagraph = editable.locator('p.is-editor-empty');

    await page.emulateMedia({ media: 'print' });
    await expect
      .poll(() => emptyParagraph.evaluate((node) => getComputedStyle(node, '::before').content))
      .toBe('none');
    await page.emulateMedia({ media: 'screen' });

    await page.waitForFunction(() => Boolean((window as LashTestWindow).__lashEditor));
    await page.evaluate(() => {
      const editor = (window as LashTestWindow).__lashEditor;
      if (!editor) throw new Error('Lash editor test hook is unavailable');
      editor.setEditable(false);
    });
    await expect(editable).toHaveAttribute('aria-label', 'Document editor');
    await expect(editable).toHaveAttribute('aria-readonly', 'true');
    await expect(editable).not.toHaveAttribute('aria-placeholder', INVITATION);
    await expect(editable.locator('[data-placeholder]')).toHaveCount(0);
  });
});

test.describe('stranger-visible responsive shell', () => {
  test('desktop has no mobile-menu focus target or dead dimming backdrop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEmptyDocument(page, 'stranger-shell-desktop');

    const mobileMenu = page.getByTestId('topbar-mobile-menu');
    await expect(mobileMenu).toBeHidden();
    expect(await mobileMenu.evaluate((button) => getComputedStyle(button).display)).toBe('none');
    expect(
      await mobileMenu.evaluate((button) => {
        (button as HTMLButtonElement).focus();
        return document.activeElement === button;
      }),
    ).toBe(false);

    const backdropDisplay = await page.locator('.lash-app').evaluate((app) => {
      app.setAttribute('data-mobile-drawer', 'true');
      const backdrop = app.querySelector<HTMLElement>('.lash-app-backdrop');
      return backdrop ? getComputedStyle(backdrop).display : null;
    });
    expect(backdropDisplay).toBe('none');
  });

  test('mobile menu is 44px, opens the real drawer, and restores focus on close', async ({
    page,
  }) => {
    const viewport = { width: 375, height: 812 };
    await page.setViewportSize(viewport);
    await openEmptyDocument(page, 'stranger-shell-mobile');

    const mobileMenu = page.getByTestId('topbar-mobile-menu');
    await expect(mobileMenu).toBeVisible();
    await expect(page.locator('.lash-app')).toHaveAttribute('data-entrance', 'false');
    const layoutMinimum = await mobileMenu.evaluate((button) => {
      const { minWidth, minHeight } = getComputedStyle(button);
      return Math.min(Number.parseFloat(minWidth), Number.parseFloat(minHeight));
    });
    expect(layoutMinimum).toBeGreaterThanOrEqual(44);
    const box = await mobileMenu.boundingBox();
    if (!box) throw new Error('The mobile menu button has no visible bounding box.');
    // Chromium's viewport conversion can report an exact 44px box a fraction below 44.
    const roundingTolerance = 0.001;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44 - roundingTolerance);
    expect(Math.min(box.x, box.y)).toBeGreaterThanOrEqual(-roundingTolerance);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + roundingTolerance);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + roundingTolerance);

    await mobileMenu.tap();
    await expect(page.locator('.lash-app')).toHaveAttribute('data-mobile-drawer', 'true');
    await expect(page.locator('.lash-app-backdrop')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.lash-app')).toHaveAttribute('data-mobile-drawer', 'false');
    await expect(mobileMenu).toBeFocused();
  });

  for (const reducedMotion of [false, true]) {
    test(`closed mobile chrome stays off-canvas on the first frame${
      reducedMotion ? ' with reduced motion' : ''
    }`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
      await installEntranceObserver(page);
      await clearLocalState(page);
      await page.goto(`/doc/stranger-mobile-entry-${reducedMotion ? 'reduced' : 'standard'}`);
      await page.waitForFunction(
        () => ((window as LashTestWindow).__lashEntranceSnapshots?.length ?? 0) > 0,
      );

      const snapshot = await page.evaluate(
        () => (window as LashTestWindow).__lashEntranceSnapshots?.[0] ?? null,
      );
      expect(snapshot).not.toBeNull();
      expect(snapshot?.reducedMotion).toBe(reducedMotion);
      expect(snapshot?.sidebar.animationName).toBe('none');
      expect(snapshot?.rail?.animationName ?? 'none').toBe('none');
      expect(snapshot?.sidebar.right ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(1);
      expect(snapshot?.rail?.left ?? 375).toBeGreaterThanOrEqual(374);
      expect(snapshot?.sidebar.transform).not.toBe('none');
      if (snapshot?.rail) expect(snapshot.rail.transform).not.toBe('none');

      if (reducedMotion && snapshot) {
        expect(durationInMilliseconds(snapshot.sidebar.transitionDuration)).toBeLessThanOrEqual(
          0.01,
        );
        if (snapshot.rail) {
          expect(durationInMilliseconds(snapshot.rail.transitionDuration)).toBeLessThanOrEqual(
            0.01,
          );
        }
      }
    });
  }
});
