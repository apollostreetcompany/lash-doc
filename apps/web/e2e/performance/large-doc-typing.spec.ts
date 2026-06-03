import { expect, test, type Page } from '@playwright/test';

type LashTestWindow = Window & {
  __lashEditor?: {
    commands: {
      focus: (position?: 'start' | 'end') => boolean;
      setContent: (content: unknown, emitUpdate?: boolean) => boolean;
    };
    getText: (options?: { blockSeparator?: string }) => string;
  };
  __lashLargeDocPerf?: {
    eventWorkSamples: number[];
    longTasks: number[];
  };
};

type LargeDocMetrics = {
  label: string;
  eventSampleCount: number;
  eventWorkP95Ms: number;
  eventWorkMaxMs: number;
  longTasks: number;
  typedTextPresent: boolean;
  p95BudgetMs: number;
};

const TYPED_TEXT = ' Large document typing probe.';

const word = (index: number) => `word${index.toString(36)}`;

const largeDocumentContent = (wordCount: number) => {
  const wordsPerBlock = 100;
  const blockCount = Math.ceil(wordCount / wordsPerBlock);
  let nextWord = 0;
  return {
    type: 'doc',
    content: Array.from({ length: blockCount }, (_, blockIndex) => {
      const text = Array.from({ length: wordsPerBlock }, () => word(nextWord++)).join(' ');
      if (blockIndex % 12 === 0) {
        return {
          type: 'heading',
          attrs: { level: blockIndex % 30 === 0 ? 1 : 2 },
          content: [{ type: 'text', text }],
        };
      }
      return {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      };
    }),
  };
};

const installTypingObserver = async (page: Page) => {
  await page.evaluate(() => {
    const win = window as LashTestWindow;
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

        const longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTasks.push(entry.duration);
          }
        });
        longTaskObserver.observe({ entryTypes: ['longtask'] });
      } catch {
        // The Event Timing and Long Task APIs are Chromium-only; Chromium is the gate here.
      }
    }

    win.__lashLargeDocPerf = { eventWorkSamples, longTasks };
  });
};

const seedLargeDocument = async (page: Page, wordCount: number) => {
  await page.evaluate((content) => {
    const editor = (window as LashTestWindow).__lashEditor;
    if (!editor) throw new Error('Lash editor test hook is unavailable');
    editor.commands.setContent(content, false);
  }, largeDocumentContent(wordCount));
};

const ciP95Budget = (wordCount: number) => {
  if (process.env.CI && wordCount >= 50_000) return 16;
  return 8;
};

const measureTyping = async (
  page: Page,
  label: string,
  p95BudgetMs: number,
): Promise<LargeDocMetrics> => {
  await page.evaluate(() => {
    const editor = (window as LashTestWindow).__lashEditor;
    if (!editor) throw new Error('Lash editor test hook is unavailable');
    editor.commands.focus('end');
  });

  await installTypingObserver(page);
  await page.keyboard.type(TYPED_TEXT, { delay: 0 });
  await page.waitForTimeout(150);

  return page.evaluate(
    ({ expectedText, scenario }) => {
      const win = window as LashTestWindow;
      const eventWorkSamples = win.__lashLargeDocPerf?.eventWorkSamples ?? [];
      return {
        label: scenario.label,
        eventSampleCount: eventWorkSamples.length,
        eventWorkP95Ms: percentile(eventWorkSamples, 95),
        eventWorkMaxMs: Math.max(...eventWorkSamples, 0),
        longTasks: win.__lashLargeDocPerf?.longTasks.length ?? 0,
        typedTextPresent:
          win.__lashEditor?.getText({ blockSeparator: '\n' }).includes(expectedText.trim()) ??
          false,
        p95BudgetMs: scenario.p95BudgetMs,
      } satisfies LargeDocMetrics;

      function percentile(values: number[], percentileValue: number): number {
        const sorted = [...values].sort((left, right) => left - right);
        const index = Math.min(
          sorted.length - 1,
          Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
        );
        return sorted[index] ?? 0;
      }
    },
    { expectedText: TYPED_TEXT, scenario: { label, p95BudgetMs } },
  );
};

test.describe('large document typing performance', () => {
  for (const scenario of [
    { label: '10k-word document', words: 10_000 },
    { label: '50k-word document', words: 50_000 },
  ]) {
    test(`${scenario.label} stays under the typing budget`, async ({ page }) => {
      await page.goto(`/doc/perf-${scenario.words}-${Date.now()}`);
      await page.waitForFunction(() => Boolean((window as LashTestWindow).__lashEditor));
      await seedLargeDocument(page, scenario.words);
      await page.waitForTimeout(250);

      const metrics = await measureTyping(page, scenario.label, ciP95Budget(scenario.words));
      console.info('large-doc-typing metrics', JSON.stringify(metrics));

      expect(metrics.typedTextPresent, JSON.stringify(metrics)).toBe(true);
      expect(metrics.eventSampleCount, JSON.stringify(metrics)).toBeGreaterThanOrEqual(
        Math.floor(TYPED_TEXT.length * 0.9),
      );
      expect(metrics.eventWorkP95Ms, JSON.stringify(metrics)).toBeLessThan(metrics.p95BudgetMs);
      expect(metrics.eventWorkMaxMs, JSON.stringify(metrics)).toBeLessThan(50);
      // Large-document rendering tasks are logged for future virtualization
      // work; Bead 32's release gate is the per-input p95/max event budget.
    });
  }
});
