#!/usr/bin/env node
/**
 * Headless visual snapshots of the Lash editor at multiple viewport sizes.
 *
 * Usage: node scripts/visual-snap.mjs [baseUrl] [outputDir]
 */
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseUrl = process.argv[2] ?? 'http://localhost:3000';
const outDir = process.argv[3] ?? join(__dirname, '..', 'visual-snapshots');

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'tablet-1024', width: 1024, height: 768 },
  { name: 'tablet-large-768', width: 768, height: 1024 },
  { name: 'mobile-375', width: 375, height: 812 },
];

const SEED_BLOCKS = [
  { kind: 'heading', level: 1, text: 'Quarterly product launch' },
  {
    kind: 'paragraph',
    text:
      'This document tracks the launch plan, owners, and outstanding risks for the upcoming release.',
  },
  { kind: 'heading', level: 2, text: 'Goals' },
  {
    kind: 'list',
    items: [
      'Cut time-to-first-edit by 50%',
      "Match Quip's clarity, exceed its responsiveness",
      'Ship history, suggestions, and AI assistance from day one',
    ],
  },
  { kind: 'heading', level: 2, text: 'Tasks' },
  {
    kind: 'tasks',
    items: [
      { checked: true, text: 'Lock the editor schema (Ada)' },
      { checked: true, text: 'Review collaboration latency' },
      { checked: false, text: 'Final accessibility audit (Grace)' },
      { checked: false, text: 'Ship the launch blog post' },
    ],
  },
  { kind: 'heading', level: 2, text: 'Notes' },
  {
    kind: 'paragraph',
    text:
      "The blocker is integration with the existing identity service. Will revisit after Friday's review.",
  },
];

function seedBlocks(blocks) {
  // eslint-disable-next-line no-undef
  const win = window;
  const editor = win.__lashEditor;
  if (!editor) return false;
  const content = blocks.map((block) => {
    if (block.kind === 'heading') {
      return {
        type: 'heading',
        attrs: { level: block.level },
        content: [{ type: 'text', text: block.text }],
      };
    }
    if (block.kind === 'paragraph') {
      return { type: 'paragraph', content: [{ type: 'text', text: block.text }] };
    }
    if (block.kind === 'quote') {
      return {
        type: 'blockquote',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: block.text }] }],
      };
    }
    if (block.kind === 'list') {
      return {
        type: 'bulletList',
        content: block.items.map((text) => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        })),
      };
    }
    if (block.kind === 'tasks') {
      return {
        type: 'taskList',
        content: block.items.map((item) => ({
          type: 'taskItem',
          attrs: { checked: item.checked },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: item.text }] }],
        })),
      };
    }
    return { type: 'paragraph', content: [{ type: 'text', text: '' }] };
  });
  editor.commands.setContent({ type: 'doc', content }, false);
  return true;
}

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.on('console', (msg) => console.log(`  [page:${viewport.name}]`, msg.text()));
    page.on('pageerror', (err) => console.log(`  [error:${viewport.name}]`, err.message));

    console.log(`-> ${viewport.name} ${viewport.width}x${viewport.height}`);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="lash-editor-content"]', { timeout: 15000 });
    await page.waitForFunction(() => Boolean(window.__lashEditor), null, { timeout: 15000 });
    await page.evaluate(seedBlocks, SEED_BLOCKS);
    await page.waitForFunction(
      () => window.__lashEditor?.getText({ blockSeparator: '\n' }).includes('Quarterly'),
      null,
      { timeout: 5000 },
    );
    await page.waitForTimeout(400);
    await page.screenshot({
      path: join(outDir, `${viewport.name}.png`),
      fullPage: false,
    });
    await context.close();
  }

  // Focus mode at 1440 with content
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    console.log('-> focus-mode-1440');
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="lash-editor-content"]', { timeout: 15000 });
    await page.waitForFunction(() => Boolean(window.__lashEditor), null, { timeout: 15000 });
    await page.evaluate(seedBlocks, SEED_BLOCKS);
    await page.waitForFunction(
      () => window.__lashEditor?.getText({ blockSeparator: '\n' }).includes('Quarterly'),
      null,
      { timeout: 5000 },
    );
    await page.waitForTimeout(200);
    await page.locator('[data-testid="focus-mode-toggle"]').click();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: join(outDir, 'focus-mode-1440.png'),
      fullPage: false,
    });
    await context.close();
  }

  // Desktop 1440 - chat tab interaction (selection)
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    console.log('-> desktop-1440-chat');
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="lash-editor-content"]', { timeout: 15000 });
    await page.waitForFunction(() => Boolean(window.__lashEditor), null, { timeout: 15000 });
    await page.evaluate(seedBlocks, SEED_BLOCKS);
    await page.waitForFunction(
      () => window.__lashEditor?.getText({ blockSeparator: '\n' }).includes('Quarterly'),
      null,
      { timeout: 5000 },
    );
    await page.waitForTimeout(300);
    // Click chat tab to focus chat section
    await page.locator('[data-testid="rail-tab-chat"]').click();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: join(outDir, 'desktop-1440-chat.png'),
      fullPage: false,
    });
    await context.close();
  }

  // Desktop 1440 with table
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    console.log('-> desktop-1440-table');
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="lash-editor-content"]', { timeout: 15000 });
    await page.evaluate(() => {
      const editor = window.__lashEditor;
      if (!editor) return;
      editor.commands.setContent(
        {
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 1 },
              content: [{ type: 'text', text: 'Release tracker' }],
            },
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Status of each launch milestone across the squad.' },
              ],
            },
          ],
        },
        false,
      );
      window.__lashInsertTable?.(4, 3);
    });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: join(outDir, 'desktop-1440-table.png'),
      fullPage: false,
    });
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(`\nSnapshots written to ${outDir}`);
