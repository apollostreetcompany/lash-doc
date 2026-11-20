import { expect, test } from '@playwright/test';

const title = 'Quarterly planning';
const passage = 'Select these words when the planning memo opens.';
const targets = {
  paper: '.lash-doc-paper',
  title: '.lash-doc-title',
  toolbar: '.lash-toolbar-bar',
  share: '[data-testid="topbar-share-button"]',
  passage: '.ProseMirror > p',
};

type Frame = { x: number; y: number; width: number; opacity: number; visible: boolean };
type FrameSamples = {
  targets: Record<string, Frame[]>;
  closedNavigation: { visible: boolean; right: number; activityPresent: boolean } | null;
  titleValue: string | null;
  complete: boolean;
};
type FrameWindow = Window & { lashFirstFrames?: FrameSamples };

for (const { width, height, reducedMotion } of [
  { width: 1440, height: 900, reducedMotion: false },
  { width: 375, height: 812, reducedMotion: false },
  { width: 375, height: 812, reducedMotion: true },
]) {
  test(`the editor is readable and stable on its first frame at ${width}px${reducedMotion ? ' with reduced motion' : ''}`, async ({
    page,
  }) => {
    const documentId = 'writing-first-frame';
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
    await page.addInitScript(
      ({ documentId, title, passage, targets, mobile }) => {
        window.localStorage.setItem(`lash:title:${documentId}`, title);
        window.localStorage.setItem(
          `lash:body:${documentId}`,
          JSON.stringify({
            documentId,
            doc: {
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: passage }] }],
            },
            version: 1,
            schemaVersion: 'lash-schema-v1',
            revision: 1,
            writeId: 'first-frame-fixture',
            savedAt: '2026-01-01T00:00:00.000Z',
          }),
        );
        const samples: FrameSamples = {
          targets: Object.fromEntries(Object.keys(targets).map((target) => [target, []])),
          closedNavigation: null,
          titleValue: null,
          complete: false,
        };
        (window as FrameWindow).lashFirstFrames = samples;
        const capture = () => {
          const sidebar = document.querySelector('#lash-sidebar');
          if (mobile && sidebar && !samples.closedNavigation) {
            samples.closedNavigation = {
              visible: getComputedStyle(sidebar).visibility === 'visible',
              right: sidebar.getBoundingClientRect().right,
              activityPresent: Boolean(document.querySelector('#lash-rail')),
            };
          }
          for (const [key, selector] of Object.entries(targets)) {
            const frames = samples.targets[key];
            if (frames.length >= 3) continue;
            const element = document.querySelector<HTMLElement>(selector);
            if (!element) continue;
            const range = key === 'passage' ? document.createRange() : null;
            if (range) {
              if (element.textContent !== passage) continue;
              range.selectNodeContents(element);
            }
            const rect = (range ?? element).getBoundingClientRect();
            if (!rect.width || !rect.height) continue;
            if (key === 'title' && frames.length === 0 && element instanceof HTMLInputElement) {
              samples.titleValue = element.value;
            }
            let opacity = 1;
            for (
              let ancestor: HTMLElement | null = element;
              ancestor;
              ancestor = ancestor.parentElement
            ) {
              opacity *= Number(getComputedStyle(ancestor).opacity);
            }
            frames.push({
              x: rect.x,
              y: rect.y,
              width: rect.width,
              opacity,
              visible: getComputedStyle(element).visibility === 'visible',
            });
          }
          samples.complete = Object.values(samples.targets).every((frames) => frames.length === 3);
          if (!samples.complete) requestAnimationFrame(capture);
        };
        requestAnimationFrame(capture);
      },
      { documentId, title, passage, targets, mobile: width <= 767 },
    );
    await page.goto(`/doc/${documentId}`);
    await page.waitForFunction(() => (window as FrameWindow).lashFirstFrames?.complete);
    const samples = await page.evaluate(() => (window as FrameWindow).lashFirstFrames);
    if (!samples) throw new Error('No editor frames sampled');
    for (const [target, [first, ...following]] of Object.entries(samples.targets)) {
      expect(first.visible, `${target} visibility on first frame`).toBe(true);
      expect(first.opacity, `${target} opacity on first frame`).toBeGreaterThanOrEqual(0.99);
      for (const frame of following) {
        expect(frame.opacity, `${target} stays readable`).toBeGreaterThanOrEqual(0.99);
        for (const axis of ['x', 'y', 'width'] as const) {
          expect(
            Math.abs(frame[axis] - first[axis]),
            `${target} ${axis} shift`,
          ).toBeLessThanOrEqual(0.5);
        }
      }
    }
    if (width <= 767) {
      const navigation = samples.closedNavigation;
      if (!navigation) throw new Error('No mobile navigation frame sampled');
      expect(navigation.visible).toBe(false);
      expect(navigation.right).toBeLessThanOrEqual(1);
      expect(navigation.activityPresent).toBe(false);
    }
    expect(samples.titleValue, 'saved title on first frame').toBe(title);
  });
}
