import { expect, test, type Page } from '@playwright/test';

const MIN_TOUCH_TARGET = 44;
const SUB_PIXEL_TOLERANCE = 0.5;

const ready = async (page: Page) =>
  page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

test.use({
  viewport: { width: 375, height: 812 },
  hasTouch: true,
});

test('mobile buttons meet 44px touch-target minimum', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await expect(page.getByTestId('lash-editor-content')).toBeVisible();

  const buttons = await page.locator('button:visible').all();
  expect(buttons.length).toBeGreaterThan(0);

  const offenders: Array<{
    text: string;
    classes: string;
    width: number;
    height: number;
  }> = [];

  for (const button of buttons) {
    const classes = (await button.getAttribute('class')) ?? '';
    if (classes.includes('lash-blame-empty')) continue;

    const box = await button.boundingBox();
    if (!box) continue;
    if (box.width === 0 || box.height === 0) continue;

    const widthOk = box.width >= MIN_TOUCH_TARGET - SUB_PIXEL_TOLERANCE;
    const heightOk = box.height >= MIN_TOUCH_TARGET - SUB_PIXEL_TOLERANCE;
    if (!widthOk || !heightOk) {
      const text = ((await button.textContent()) ?? '').trim().slice(0, 40);
      offenders.push({
        text,
        classes,
        width: Number(box.width.toFixed(2)),
        height: Number(box.height.toFixed(2)),
      });
    }
  }

  expect(
    offenders,
    `Buttons below ${MIN_TOUCH_TARGET}px touch target:\n${JSON.stringify(offenders, null, 2)}`,
  ).toEqual([]);
});
