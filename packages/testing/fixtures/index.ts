/**
 * @lash/testing/fixtures — golden documents shared by Vitest unit tests
 *                          and Playwright e2e (Node-side helpers).
 *
 * Per agents.md §Test Harness, the corpus is:
 *   - legal-contract  : heavy headings, lists, dense paragraphs       (CHECKED IN)
 *   - multilingual    : AR/HE bidi + CJK + emoji                      (TODO)
 *   - large-table     : 100×20 cells                                  (TODO M5/F4)
 *   - image-heavy     : 10 images, varied sizes                       (TODO)
 *   - changelog       : hundreds of small edits                       (TODO M2/C2)
 *
 * `FixtureName` is RegisteredFixtureName | AvailableFixtureName — the type
 * lets you reference any name for forward planning, and `loadFixture` throws
 * a deliberate `RegisteredButMissingError` for names that are listed but
 * whose source file isn't in the tree yet. (Don't let typecheck advertise a
 * fixture name that silently ENOENTs at runtime.)
 *
 * Node-only: this module imports `node:fs` and is NOT safe to bundle into
 * browser/Playwright-page code. Call it from the Vitest/Playwright test
 * runner side and pass markdown/parsed content into the page via evaluate().
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type FixtureName = 'legal-contract' | 'multilingual' | 'large-table' | 'image-heavy' | 'changelog';

export interface FixtureBundle {
  name: FixtureName;
  /** Raw markdown source. */
  markdown: string;
}

/** Thrown when a fixture name is in `REGISTERED` but its source file is missing.
 *  Distinct from `Unknown fixture` so consumers can choose to skip-vs-fail. */
export class RegisteredButMissingFixtureError extends Error {
  readonly code = 'REGISTERED_BUT_MISSING' as const;
  constructor(name: FixtureName, path: string) {
    super(`Fixture "${name}" is registered but its source file is missing: ${path}`);
    this.name = 'RegisteredButMissingFixtureError';
  }
}

/** Thrown for names not in `REGISTERED`. */
export class UnknownFixtureError extends Error {
  readonly code = 'UNKNOWN_FIXTURE' as const;
  constructor(name: string) {
    super(`Unknown fixture: ${name}`);
    this.name = 'UnknownFixtureError';
  }
}

const REGISTERED: Record<FixtureName, string> = {
  'legal-contract': 'legal-contract.md',
  multilingual: 'multilingual.md',
  'large-table': 'large-table.md',
  'image-heavy': 'image-heavy.md',
  changelog: 'changelog.md',
};

/** Resolve the fixtures markdown directory.
 *
 *  We avoid `import.meta.url` here entirely. Vitest's default Node env may
 *  parse this module as CJS (where `import.meta` is a syntax error); even in
 *  ESM-mode tests, mixing CJS-style guards with `import.meta.url` causes
 *  bundler/parser surprises. Instead we resolve relative to a known checked-in
 *  source file by walking up from `__dirname` when CJS, or relying on the
 *  fact that this file lives at `packages/testing/fixtures/index.ts` and the
 *  CWD inside Vitest/Playwright runs is the repo root.
 */
const fixtureDir = (() => {
  if (typeof __dirname === 'string') {
    return join(__dirname, 'markdown');
  }
  // Last-resort fallback: relative to repo cwd. Runs that change cwd should
  // resolve their own paths instead of relying on this.
  return join(process.cwd(), 'packages', 'testing', 'fixtures', 'markdown');
})();

/** Helper: distinguish ENOENT from real fs failures. */
const isEnoent = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'ENOENT';

export const loadFixture = (name: FixtureName): FixtureBundle => {
  const file = REGISTERED[name];
  if (!file) {
    throw new UnknownFixtureError(name);
  }
  const path = join(fixtureDir, file);
  try {
    const markdown = readFileSync(path, 'utf-8');
    return { name, markdown };
  } catch (err) {
    if (isEnoent(err)) {
      throw new RegisteredButMissingFixtureError(name, path);
    }
    throw err;
  }
};

/** Lists fixtures whose source file actually exists. ENOENT is silent (a
 *  registered-but-missing fixture is expected during build-up); any OTHER
 *  filesystem error (permissions, malformed path, etc.) is rethrown so it
 *  can't masquerade as "missing fixture". */
export const listAvailableFixtures = (): FixtureName[] => {
  const all = Object.keys(REGISTERED) as FixtureName[];
  return all.filter((name) => {
    const path = join(fixtureDir, REGISTERED[name]);
    try {
      readFileSync(path, 'utf-8');
      return true;
    } catch (err) {
      if (isEnoent(err)) {
        return false;
      }
      throw err;
    }
  });
};

// Used to silence unused import lint for `dirname` if reorganizations remove its callsite.
// (Kept: sometimes useful for path-debug in tests; intentionally not exported.)
void dirname;
