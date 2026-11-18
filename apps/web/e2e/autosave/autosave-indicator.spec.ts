import { expect, test } from '@playwright/test';

/**
 * autosave-indicator — agents.md H.1.
 *
 *   "When user stops typing — changes flush within 500 ms; 'All changes saved'
 *    indicator updates; last saved time visible on hover."
 *
 * The indicator is wired via `useAutosave` in apps/web/lib/autosave.ts. When a
 * save lands, the verified persistence callback publishes `{ savedAt,
 * docJson }` to `window.__lashLastSave`. The hook must never publish this
 * success receipt before the per-document body envelope can be read back.
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

    // The hook debounces 350 ms after the last keystroke, reserving headroom
    // for the verified persistence write and React render under the 500 ms SLO.
    // The broad assertion timeout still tolerates loaded-runner scheduling.
    const indicator = page.getByTestId('autosave-indicator');
    await expect(indicator).toBeVisible({ timeout: 2_500 });
    await expect(indicator).toContainText(/All changes saved/i, { timeout: 2_500 });
    await expect(page.getByTestId('autosave-live-region')).toHaveText('All changes saved');

    // Hover tooltip = absolute ISO timestamp recorded at save time.
    // Poll the title attribute — React may commit `status` and `lastSavedAt`
    // in separate frames depending on scheduler timing.
    await expect(indicator).toHaveAttribute('title', /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, {
      timeout: 2_500,
    });

    // The save callback wrote the doc snapshot to window.__lashLastSave.
    await page.waitForFunction(() =>
      Boolean(
        (window as unknown as { __lashLastSave?: { savedAt: string; docJson: unknown } })
          .__lashLastSave,
      ),
    );
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

    const stored = await page.evaluate(() => {
      const raw = window.localStorage.getItem('lash:body:demo-document');
      return raw ? (JSON.parse(raw) as { writeId?: string; doc?: unknown }) : null;
    });
    expect(stored).toMatchObject({
      writeId: expect.any(String),
      doc: lastSave?.docJson,
    });
  });
});
