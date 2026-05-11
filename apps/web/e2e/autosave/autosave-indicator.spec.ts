import { expect, test } from '@playwright/test';

/**
 * autosave-indicator — agents.md H.1.
 *
 *   "When user stops typing — changes flush within 500 ms; 'All changes saved'
 *    indicator updates; last saved time visible on hover."
 *
 * The indicator is wired via `useAutosave` in apps/web/lib/autosave.ts. When a
 * save lands, the hook also publishes `{ savedAt, docJson }` to
 * `window.__lashLastSave` so this spec can assert the snapshot reached the
 * persistence callback.
 */
test.describe('autosave-indicator', () => {
  test('shows "All changes saved" within ~500 ms of idle and exposes snapshot', async ({
    page,
  }) => {
    await page.goto('/');

    const editorContent = page.getByTestId('lash-editor-content');
    await editorContent.click();

    // Wait for the editor to be ready before typing.
    await page.waitForFunction(() =>
      Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
    );

    // Clear any prior save state so we observe the new save cleanly.
    await page.evaluate(() => {
      delete (window as unknown as { __lashLastSave?: unknown }).__lashLastSave;
    });

    await page.keyboard.type('Autosave smoke test');

    // The hook debounces 500 ms after the last keystroke; allow up to ~2.5 s
    // before asserting visibility (e2e SLO budget for the H.1 acceptance,
    // generous to cover Playwright + CI scheduler jitter).
    const indicator = page.getByTestId('autosave-indicator');
    await expect(indicator).toBeVisible({ timeout: 2_500 });
    await expect(indicator).toContainText(/saved/i, { timeout: 2_500 });

    // Hover tooltip = absolute ISO timestamp recorded at save time.
    // Poll the title attribute — React may commit `status` and `lastSavedAt`
    // in separate frames depending on scheduler timing.
    await expect(indicator).toHaveAttribute('title', /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, {
      timeout: 2_500,
    });

    // The save callback wrote the doc snapshot to window.__lashLastSave.
    const lastSave = await page.evaluate(() => {
      const win = window as unknown as {
        __lashLastSave?: { savedAt: string; docJson: unknown };
      };
      return win.__lashLastSave ?? null;
    });

    expect(lastSave).not.toBeNull();
    expect(lastSave?.savedAt).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(lastSave?.docJson).toBeTruthy();
    expect(typeof lastSave?.docJson).toBe('object');
  });
});
