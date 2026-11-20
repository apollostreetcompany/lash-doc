import { expect, test, type Page } from '@playwright/test';

const editor = '.ProseMirror[contenteditable="true"]';
const probe = ' Large document typing probe.';
const lifecycle = ['keydown', 'beforeinput', 'input'];
const traceDeliveryTimeoutMs = 60_000;

type TextNode = { type: 'text'; text: string };
type Block = {
  type: 'paragraph' | 'heading';
  attrs?: { headingId: string; level: number };
  content: TextNode[];
};
type Body = { type: 'doc'; content: Block[] };
type Envelope = { revision: number; writeId: string; doc: Body };
type TraceEvent = {
  name: string;
  ph: string;
  pid: number;
  tid: number;
  ts: number;
  dur?: number;
  args?: { data?: { type?: string } };
};
type TimingWindow = Window & {
  lashTiming?: {
    observer: PerformanceObserver;
    tasks: PerformanceEntry[];
    inputs: string[];
  };
};

function fixture(words: number): Body {
  let nextWord = 0;
  return {
    type: 'doc',
    content: Array.from({ length: words / 100 }, (_, block): Block => {
      const text = Array.from({ length: 100 }, () => 'word' + (nextWord++).toString(36)).join(' ');
      const content: TextNode[] = [{ type: 'text', text }];
      return block % 12 === 0
        ? {
            type: 'heading',
            attrs: { headingId: 'section-' + block, level: block % 30 === 0 ? 1 : 2 },
            content,
          }
        : { type: 'paragraph', content };
    }),
  };
}

const textBlocks = (body: Body) => body.content.map(({ content }) => content[0].text);
const readEnvelope = (page: Page, key: string) =>
  page.evaluate((key): Envelope => JSON.parse(localStorage.getItem(key) ?? 'null'), key);
const p95 = (samples: number[]) =>
  [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1];

for (const words of [10_000, 50_000]) {
  test(
    words.toLocaleString('en-US') + '-word typing stays within the editor budget',
    async ({ context, page }, testInfo) => {
      const documentId = 'large-doc-' + words;
      const key = 'lash:body:' + documentId;
      const doc = fixture(words);
      await page.addInitScript(
        ({ documentId, key, doc }) => {
          localStorage.setItem(
            key,
            JSON.stringify({
              documentId,
              doc,
              version: 1,
              schemaVersion: 'lash-schema-v1',
              revision: 1,
              writeId: 'large-doc-fixture',
              savedAt: '2026-01-01T00:00:00.000Z',
            }),
          );
        },
        { documentId, key, doc },
      );
      await page.goto('/doc/' + documentId);
      await expect(page.locator('[data-body-mutation-locked="false"] ' + editor)).toBeVisible();

      const blocks = page.locator(editor + ' > *');
      await expect(blocks).toHaveCount(words / 100);
      await blocks.last().click();
      await blocks.last().evaluate((terminal) => {
        const text = terminal.lastChild;
        const selection = window.getSelection();
        if (!(text instanceof Text) || !selection) throw new Error('Missing editor selection.');
        selection.collapse(text, text.length);
      });
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      );

      // A real edit and undo of one character normalize the seed through the app's save path.
      await page.keyboard.type('x');
      await page.keyboard.press('Backspace');
      const saved = page.locator('[data-testid="autosave-indicator"][data-status="saved"]');
      await expect(saved).toBeVisible();
      const baseline = await readEnvelope(page, key);
      expect(baseline.revision).toBeGreaterThan(1);
      expect(textBlocks(baseline.doc)).toEqual(textBlocks(doc));
      const expected = structuredClone(baseline.doc);
      expected.content[expected.content.length - 1].content[0].text += probe;

      await page.evaluate(async () => {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        const tasks: PerformanceEntry[] = [];
        const inputs: string[] = [];
        const observer = new PerformanceObserver((list) => tasks.push(...list.getEntries()));
        observer.observe({ type: 'longtask' });
        document.querySelector('.ProseMirror')?.addEventListener('input', (event) => {
          if (event instanceof InputEvent && event.isTrusted) inputs.push(event.data ?? '');
        });
        (window as TimingWindow).lashTiming = { observer, tasks, inputs };
      });

      // Event Timing omits inputs below its presentation threshold. CDP records
      // every dispatch, including the fast keys the SLO is meant to protect.
      const cdp = await context.newCDPSession(page);
      const events: TraceEvent[] = [];
      cdp.on('Tracing.dataCollected', ({ value }) =>
        events.push(...(value as unknown as TraceEvent[])),
      );
      const completedTrace = new Promise<void>((resolve) =>
        cdp.once('Tracing.tracingComplete', () => resolve()),
      );
      await cdp.send('Tracing.start', {
        transferMode: 'ReportEvents',
        traceConfig: { includedCategories: ['devtools.timeline', 'blink.user_timing'] },
      });
      try {
        await page.evaluate(() => performance.mark('lash-typing-start'));
        await page.keyboard.type(probe);
        await page.evaluate(async () => {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          performance.mark('lash-typing-end');
        });
      } finally {
        await cdp.send('Tracing.end');
        // Chrome delivers the finished trace after the measured typing window.
        // Exclude only the elapsed delivery wait from the test's normal budget.
        const testTimeout = testInfo.timeout;
        const deliveryStartedAt = performance.now();
        testInfo.setTimeout(testTimeout + traceDeliveryTimeoutMs);
        try {
          await test.step('Receive the completed Chromium trace', () => completedTrace, {
            timeout: traceDeliveryTimeoutMs,
          });
        } finally {
          const deliveryTime = Math.ceil(performance.now() - deliveryStartedAt);
          testInfo.setTimeout(testTimeout + Math.min(deliveryTime, traceDeliveryTimeoutMs));
          await cdp.detach();
        }
      }

      const start = events.find(({ name }) => name === 'lash-typing-start');
      const end = events.find(({ name }) => name === 'lash-typing-end');
      if (!start || !end) throw new Error('Missing typing trace markers.');
      const slices = events
        .filter(
          (event) =>
            event.name === 'EventDispatch' &&
            event.ph === 'X' &&
            event.pid === start.pid &&
            event.tid === start.tid &&
            event.ts >= start.ts &&
            event.ts < end.ts &&
            lifecycle.includes(event.args?.data?.type ?? ''),
        )
        .sort((first, second) => first.ts - second.ts);
      expect(slices.map(({ args }) => args?.data?.type)).toEqual(
        Array.from(probe).flatMap(() => lifecycle),
      );
      const perKey = Array.from(probe, (_character, keyIndex) =>
        Math.max(
          ...slices
            .slice(keyIndex * lifecycle.length, (keyIndex + 1) * lifecycle.length)
            .map(({ dur }) => (dur ?? Number.POSITIVE_INFINITY) / 1000),
        ),
      );

      const { inputs, longTasks } = await page.evaluate(() => {
        const timing = (window as TimingWindow).lashTiming;
        if (!timing) throw new Error('Missing typing observer.');
        const start = performance.getEntriesByName('lash-typing-start')[0].startTime;
        const end = performance.getEntriesByName('lash-typing-end')[0].startTime;
        const longTasks = [...timing.tasks, ...timing.observer.takeRecords()]
          .filter((task) => task.startTime < end && task.startTime + task.duration > start)
          .map((task) => task.duration);
        timing.observer.disconnect();
        return { inputs: timing.inputs, longTasks };
      });
      const metrics = {
        words,
        keys: perKey.length,
        p95: p95(perKey),
        max: Math.max(...perKey),
        longTasks,
      };
      console.info('large-doc typing metrics', JSON.stringify(metrics));
      expect(inputs).toEqual(Array.from(probe));
      expect(metrics.p95).toBeLessThan(8);
      expect(metrics.max).toBeLessThan(50);
      expect(metrics.longTasks).toEqual([]);

      await expect(blocks).toHaveText(textBlocks(expected));
      await expect
        .poll(async () => (await readEnvelope(page, key)).revision)
        .toBeGreaterThan(baseline.revision);
      await expect(saved).toBeVisible();
      const final = await readEnvelope(page, key);
      expect(final.writeId).not.toBe(baseline.writeId);
      expect(final.doc).toEqual(expected);
    },
  );
}
