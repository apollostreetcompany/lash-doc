import { expect, test } from '@playwright/test';

const route = (suffix: string) => `/doc/prod-j09-${suffix}`;

test.describe('calm document header', () => {
  test('presents one truthful local status directly beneath the title', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(route('desktop'));

    const title = page.getByTestId('lash-doc-title-input');
    const status = page.getByRole('group', { name: 'Document status' });
    await expect(title).toBeVisible();
    await expect(page.locator('.ProseMirror')).toBeVisible();

    const untouchedText = await page.locator('.lash-doc-header').innerText();
    expect.soft(await status.count(), 'one Document status line').toBe(1);
    expect.soft(await page.getByTestId('lash-doc-meta').count(), 'obsolete metadata row').toBe(0);
    expect.soft(untouchedText, 'internal route is not visible').not.toContain(route('desktop'));
    expect.soft(untouchedText, 'version count is not visible').not.toMatch(/\b\d+ versions?\b/u);
    expect.soft(untouchedText, 'section count is not visible').not.toMatch(/\b\d+ sections?\b/u);
    expect
      .soft(untouchedText, 'local owner jargon is not visible')
      .not.toContain('Local owner access');
    expect
      .soft(untouchedText, 'local status is not duplicated as Local only')
      .not.toContain('Local only');
    expect.soft(untouchedText, 'local status is not duplicated as Solo').not.toMatch(/\bSolo\b/u);
    expect.soft(untouchedText.match(/On this device/gu) ?? []).toHaveLength(1);
    expect.soft(untouchedText, 'untouched documents do not claim Saved').not.toMatch(/\bSaved\b/u);
    expect.soft(await page.locator('.lash-topbar-saved').count(), 'topbar save duplicate').toBe(0);

    await page.locator('.ProseMirror').click();
    await page.keyboard.type('Calm header proof');
    const indicator = page.getByTestId('autosave-indicator');
    await expect(indicator).toHaveAttribute('data-status', 'saved', { timeout: 2_500 });
    await expect(indicator).toContainText('All changes saved');
    expect.soft(await status.getByTestId('autosave-indicator').count()).toBe(1);
    await expect(page.getByTestId('autosave-live-region')).toHaveText('All changes saved');
  });

  test('keeps title, compact status, and writing canvas in one mobile flow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route('mobile'));

    const title = page.getByTestId('lash-doc-title-input');
    const status = page.getByRole('group', { name: 'Document status' });
    const editor = page.getByTestId('lash-editor-content');
    await expect(title).toBeVisible();
    await expect(editor).toBeVisible();

    const geometry = await page.evaluate(() => {
      const titleBox = document
        .querySelector<HTMLElement>('[data-testid="lash-doc-title-input"]')
        ?.getBoundingClientRect();
      const statusBox = document
        .querySelector<HTMLElement>('[aria-label="Document status"]')
        ?.getBoundingClientRect();
      const editorBox = document
        .querySelector<HTMLElement>('[data-testid="lash-editor-content"]')
        ?.getBoundingClientRect();
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        titleBottom: titleBox?.bottom ?? null,
        statusTop: statusBox?.top ?? null,
        statusBottom: statusBox?.bottom ?? null,
        statusHeight: statusBox?.height ?? null,
        editorTop: editorBox?.top ?? null,
      };
    });

    expect.soft(await status.count(), 'one mobile Document status line').toBe(1);
    expect.soft(await page.getByTestId('lash-doc-meta').count(), 'no mobile metadata grid').toBe(0);
    expect
      .soft(geometry.documentWidth, 'no horizontal overflow')
      .toBeLessThanOrEqual(geometry.viewportWidth);
    expect.soft(geometry.statusHeight, 'compact no-peer status').not.toBeNull();
    if (geometry.statusHeight !== null) expect.soft(geometry.statusHeight).toBeLessThanOrEqual(48);
    expect.soft(geometry.titleBottom, 'title geometry exists').not.toBeNull();
    expect.soft(geometry.statusTop, 'status geometry exists').not.toBeNull();
    if (geometry.titleBottom !== null && geometry.statusTop !== null) {
      expect.soft(geometry.titleBottom).toBeLessThanOrEqual(geometry.statusTop);
    }
    expect.soft(geometry.statusBottom, 'status bottom exists').not.toBeNull();
    expect.soft(geometry.editorTop, 'editor geometry exists').not.toBeNull();
    if (geometry.statusBottom !== null && geometry.editorTop !== null) {
      expect.soft(geometry.statusBottom).toBeLessThanOrEqual(geometry.editorTop);
      expect.soft(geometry.editorTop - geometry.statusBottom).toBeLessThanOrEqual(48);
    }

    const visibleText = await page.locator('.lash-doc-header').innerText();
    expect.soft(visibleText.match(/On this device/gu) ?? []).toHaveLength(1);
    expect.soft(visibleText).not.toContain(route('mobile'));
    expect.soft(visibleText).not.toMatch(/\b(?:Solo|Local only|Ready)\b/u);
  });
});
