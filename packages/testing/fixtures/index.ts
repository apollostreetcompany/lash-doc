/**
 * @lash/testing/fixtures — golden documents shared by Vitest unit tests and Playwright e2e.
 *
 * Fixture corpus per agents.md §Test Harness:
 *   - legal-contract  : heavy headings, lists, dense paragraphs
 *   - multilingual    : AR/HE bidi + CJK + emoji        (TODO M0/A6 follow-up)
 *   - large-table     : 100×20 cells                     (TODO M5/F4)
 *   - image-heavy     : 10 images, varied sizes          (TODO M0/A6 follow-up)
 *   - changelog       : hundreds of small edits          (TODO M2/C2)
 *
 * Each fixture lives as a markdown source under ./markdown/ — markdown roundtrip
 * gives us a single source-of-truth that's easy to diff and version.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export type FixtureName = 'legal-contract' | 'multilingual' | 'large-table' | 'image-heavy' | 'changelog';

export interface FixtureBundle {
  name: FixtureName;
  /** raw markdown source */
  markdown: string;
}

const fixtureDir = (() => {
  // Resolve path-of-this-file in both ESM and CJS test runners.
  const here = typeof __dirname === 'string' ? __dirname : dirname(fileURLToPath(import.meta.url));
  return join(here, 'markdown');
})();

const REGISTERED: Record<FixtureName, string> = {
  'legal-contract': 'legal-contract.md',
  multilingual: 'multilingual.md',
  'large-table': 'large-table.md',
  'image-heavy': 'image-heavy.md',
  changelog: 'changelog.md',
};

export const loadFixture = (name: FixtureName): FixtureBundle => {
  const file = REGISTERED[name];
  if (!file) {
    throw new Error(`Unknown fixture: ${name}`);
  }
  const path = join(fixtureDir, file);
  const markdown = readFileSync(path, 'utf-8');
  return { name, markdown };
};

export const listAvailableFixtures = (): FixtureName[] => {
  // Only fixtures whose source file actually exists are considered "available".
  const all = Object.keys(REGISTERED) as FixtureName[];
  return all.filter((name) => {
    try {
      readFileSync(join(fixtureDir, REGISTERED[name]), 'utf-8');
      return true;
    } catch {
      return false;
    }
  });
};
