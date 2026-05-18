import { expect, test } from '@playwright/test';

const ESSAY = [
  'Lash should feel instant while a writer is moving quickly through a draft.',
  'The editor has to accept a long train of ordinary prose without pulling focus,',
  'dropping characters, delaying the caret, or asking React to redraw unrelated chrome.',
  'This benchmark types enough words to exercise the real keyboard path, history scheduling,',
  'outline updates, and editor transactions while still staying deterministic in CI.',
  'A responsive document surface is not a decoration here; it is the product promise.',
  'When the user writes an essay, the page should keep up with every sentence and every pause.',
].join(' ');

type LashTypingMetrics = {
  eventSampleCount: number;
  charCount: number;
  totalMs: number;
  eventWorkP50Ms: number;
  eventWorkP95Ms: number;
  eventWorkMaxMs: number;
  longTasks: number;
  textLength: number;
};

test('typing-latency essay stays under p95 budget', async ({ page }) => {
  await page.goto('/');
  const editable = page.locator('.ProseMirror').first();
  await expect(editable).toBeVisible();

  await page.evaluate(() => {
    const win = window as unknown as {
      __lashTypingPerf?: {
        eventWorkSamples: number[];
        longTasks: number[];
      };
    };

    const eventWorkSamples: number[] = [];
    const longTasks: number[] = [];

    if ('PerformanceObserver' in window) {
      try {
        const eventObserver = new PerformanceObserver((list) => {
          for (const rawEntry of list.getEntries()) {
            const entry = rawEntry as PerformanceEntry & {
              processingStart?: number;
              processingEnd?: number;
            };
            if (
              (entry.name === 'keydown' ||
                entry.name === 'beforeinput' ||
                entry.name === 'input') &&
              typeof entry.processingStart === 'number' &&
              typeof entry.processingEnd === 'number'
            ) {
              eventWorkSamples.push(entry.processingEnd - entry.processingStart);
            }
          }
        });
        eventObserver.observe({
          type: 'event',
          buffered: true,
          durationThreshold: 0,
        } as PerformanceObserverInit);

        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTasks.push(entry.duration);
          }
        });
        observer.observe({ entryTypes: ['longtask'] });
      } catch {
        // Long Task API is Chromium-only; the latency samples are the gate.
      }
    }

    win.__lashTypingPerf = { eventWorkSamples, longTasks };
  });

  await editable.focus();

  const startedAt = Date.now();
  await page.keyboard.type(ESSAY, { delay: 0 });
  const totalMs = Date.now() - startedAt;

  await page.waitForTimeout(100);

  await expect
    .poll(async () =>
      page.evaluate(() => (document.querySelector('.ProseMirror')?.textContent ?? '').length),
    )
    .toBe(ESSAY.length);

  const metrics = await page.evaluate(
    ({ charCount, total }) => {
      const win = window as unknown as {
        __lashTypingPerf?: {
          eventWorkSamples: number[];
          longTasks: number[];
        };
      };
      const eventWorkSamples = win.__lashTypingPerf?.eventWorkSamples ?? [];
      return {
        eventSampleCount: eventWorkSamples.length,
        charCount,
        totalMs: total,
        eventWorkP50Ms: percentile(eventWorkSamples, 50),
        eventWorkP95Ms: percentile(eventWorkSamples, 95),
        eventWorkMaxMs: Math.max(...eventWorkSamples),
        longTasks: win.__lashTypingPerf?.longTasks.length ?? 0,
        textLength: (document.querySelector('.ProseMirror')?.textContent ?? '').length,
      } satisfies LashTypingMetrics;

      function percentile(values: number[], percentileValue: number): number {
        const sorted = [...values].sort((left, right) => left - right);
        const index = Math.min(
          sorted.length - 1,
          Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
        );
        return sorted[index] ?? 0;
      }
    },
    { charCount: ESSAY.length, total: totalMs },
  );

  expect(metrics.textLength).toBe(ESSAY.length);
  console.info('typing-latency metrics', JSON.stringify(metrics));
  expect(metrics.eventSampleCount).toBeGreaterThanOrEqual(Math.floor(metrics.charCount * 0.98));
  expect(metrics.eventWorkP95Ms, JSON.stringify(metrics)).toBeLessThan(8);
  expect(metrics.eventWorkMaxMs, JSON.stringify(metrics)).toBeLessThan(24);
  expect(metrics.totalMs, JSON.stringify(metrics)).toBeLessThan(5_000);
  expect(metrics.longTasks).toBe(0);
});
