import { expect, test, type Page } from '@playwright/test';

type LashTestWindow = Window & {
  __lashEditor?: import('@tiptap/core').Editor;
};

const waitForEditor = async (page: Page) => {
  await page.waitForFunction(() => Boolean((window as LashTestWindow).__lashEditor));
  await expect(page.locator('.lash-app')).toHaveAttribute('data-entrance', 'false');
};

const durationInMilliseconds = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.endsWith('ms')) return Number.parseFloat(trimmed);
  if (trimmed.endsWith('s')) return Number.parseFloat(trimmed) * 1000;
  return Number.NaN;
};

test.describe('focus-mode-a11y', () => {
  test('hides chrome while keeping landmarks available', async ({ page }) => {
    await page.goto('/');

    const heading = page.getByRole('heading', { level: 1, name: 'Lash Collaborative Editor' });
    const outline = page.getByRole('navigation', { name: 'Outline' });
    const editor = page.getByRole('textbox', { name: 'Document editor' });
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+Alt+2');
    await page.keyboard.insertText('Focus outline');
    await expect(heading).toBeVisible();
    await expect(page.getByTestId('lash-toolbar')).toBeVisible();
    await expect(outline).toBeVisible();

    const toggle = page.getByTestId('focus-mode-toggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await expect(page.getByTestId('lash-toolbar')).toBeHidden();
    await expect(outline).toBeHidden();
    await expect(heading).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
  });
});

test.describe('focus-mode-a11y mobile', () => {
  test.use({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
  });

  test('keeps the title, editor region, and stateful exit action discoverable', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await waitForEditor(page);

    const shell = page.getByTestId('lash-editor-shell');
    const tools = page.getByRole('button', { name: 'More document tools' });
    await expect(tools).toHaveAttribute('aria-expanded', 'false');
    await tools.tap();
    const enter = page.getByTestId('mobile-focus-mode-toggle');
    await expect(enter).toHaveAttribute('aria-pressed', 'false');
    expect(
      await enter.evaluate((button) => (button as HTMLButtonElement).tabIndex),
    ).toBeGreaterThanOrEqual(0);

    await enter.tap();
    await expect(shell).toHaveAttribute('data-focus-mode', 'true');

    const exit = page.getByRole('button', { name: 'Exit focus mode' });
    await expect(exit).toBeVisible();
    await expect(exit).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('textbox', { name: 'Document title' })).toBeVisible();
    await expect(shell.getByRole('region', { name: 'Writing canvas' })).toBeVisible();

    const reducedMotionDurations = await page.evaluate(() => {
      const selectors = ['.lash-app', '.lash-topbar', '.lash-doc-paper'];
      return selectors.map((selector) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`Missing reduced-motion target: ${selector}`);
        const style = getComputedStyle(element);
        return {
          selector,
          animationDuration: style.animationDuration,
          transitionDuration: style.transitionDuration,
        };
      });
    });
    for (const row of reducedMotionDurations) {
      for (const duration of `${row.animationDuration},${row.transitionDuration}`.split(',')) {
        expect(
          durationInMilliseconds(duration),
          `${row.selector} duration ${duration}`,
        ).toBeLessThanOrEqual(0.01);
      }
    }

    await exit.focus();
    await expect(exit).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(shell).toHaveAttribute('data-focus-mode', 'false');
    await expect(page.getByRole('button', { name: 'More document tools' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Document title' })).toBeVisible();
    await expect(shell.getByRole('region', { name: 'Writing canvas' })).toBeVisible();
  });
});
