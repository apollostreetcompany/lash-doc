import { expect, test, type Page } from '@playwright/test';

const INVITATION = 'Start writing…';

type LashTestWindow = Window & {
  __lashEditor?: import('@tiptap/core').Editor;
};

const openEmptyDocument = async (page: Page, documentId: string) => {
  await page.goto(`/doc/${documentId}`);
  const editable = page.getByRole('textbox', { name: 'Document editor' });
  await expect(editable).toBeVisible();
  await expect(editable).toHaveAttribute('contenteditable', 'true');
  return editable;
};

const channel = (value: string) =>
  value
    .match(/[\d.]+/gu)
    ?.slice(0, 3)
    .map(Number) ?? [];

const linear = (value: number) => {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
};

const contrast = (foreground: string, background: string) => {
  const foregroundChannels = channel(foreground);
  const backgroundChannels = channel(background);
  if (foregroundChannels.length !== 3 || backgroundChannels.length !== 3) return 0;
  const luminance = (channels: number[]) =>
    0.2126 * linear(channels[0]) + 0.7152 * linear(channels[1]) + 0.0722 * linear(channels[2]);
  const lighter = Math.max(luminance(foregroundChannels), luminance(backgroundChannels));
  const darker = Math.min(luminance(foregroundChannels), luminance(backgroundChannels));
  return (lighter + 0.05) / (darker + 0.05);
};

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
]) {
  test.describe(`VIS-01 ${viewport.name}`, () => {
    test.use({ hasTouch: viewport.name === 'mobile' });

    test('empty paper invites writing without entering document data', async ({ page }) => {
      const documentId = `vis-01-${viewport.name}`;
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const editable = await openEmptyDocument(page, documentId);
      const paragraph = editable.locator(`p[data-placeholder="${INVITATION}"]`);

      await expect(editable).toHaveAttribute('role', 'textbox');
      await expect(editable).toHaveAttribute('aria-multiline', 'true');
      await expect(editable).toHaveAttribute('aria-placeholder', INVITATION);
      await expect(paragraph).toHaveCount(1);
      await page.reload();
      await expect(editable).toHaveAttribute('aria-placeholder', INVITATION);
      await expect(paragraph).toHaveCount(1);

      const boxBefore = await editable.boundingBox();
      expect(boxBefore?.height ?? 0).toBeGreaterThanOrEqual(224);

      if (viewport.name === 'desktop') await expect(editable).toHaveCSS('cursor', 'text');

      const placeholder = await paragraph.evaluate((node) => {
        const invitation = getComputedStyle(node, '::before');
        const paper = node.closest<HTMLElement>('.lash-doc-paper');
        return {
          background: paper ? getComputedStyle(paper).backgroundColor : '',
          foreground: invitation.color,
          text: invitation.content,
        };
      });
      expect(placeholder.text).toBe(JSON.stringify(INVITATION));
      expect(contrast(placeholder.foreground, placeholder.background)).toBeGreaterThanOrEqual(4.5);

      if (viewport.name === 'mobile') {
        await editable.tap({
          position: { x: 40, y: Math.min(150, (boxBefore?.height ?? 224) - 16) },
        });
      } else {
        await editable.click({
          position: { x: 72, y: Math.min(180, (boxBefore?.height ?? 224) - 16) },
        });
      }
      await expect(editable).toBeFocused();
      await page.keyboard.type('A clear first thought.');
      await expect(editable).toContainText('A clear first thought.');
      await expect(editable.locator('[data-placeholder]')).toHaveCount(0);

      const boxAfter = await editable.boundingBox();
      expect(Math.abs((boxAfter?.height ?? 0) - (boxBefore?.height ?? 0))).toBeLessThanOrEqual(1);

      await expect
        .poll(
          () => page.evaluate((id) => window.localStorage.getItem(`lash:body:${id}`), documentId),
          { timeout: 2_500 },
        )
        .not.toBeNull();
      const storedBody = await page.evaluate(
        (id) => window.localStorage.getItem(`lash:body:${id}`),
        documentId,
      );
      expect(storedBody).toContain('A clear first thought.');
      expect(storedBody).not.toContain(INVITATION);

      await page.reload();
      await expect(editable).toContainText('A clear first thought.');
      await expect(editable).not.toHaveAttribute('aria-placeholder', INVITATION);
      await expect(editable.locator('[data-placeholder]')).toHaveCount(0);
      expect(
        await page.evaluate((id) => window.localStorage.getItem(`lash:body:${id}`), documentId),
      ).not.toContain(INVITATION);
    });
  });
}

test('VIS-01 read-only and print modes suppress invitation rendering', async ({ page }) => {
  const editable = await openEmptyDocument(page, 'vis-01-modes');
  const paragraph = editable.locator('p.is-editor-empty');
  await expect
    .poll(() => paragraph.evaluate((node) => getComputedStyle(node, '::before').content))
    .toBe(JSON.stringify(INVITATION));

  await page.emulateMedia({ media: 'print' });
  await expect
    .poll(() => paragraph.evaluate((node) => getComputedStyle(node, '::before').content))
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
