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

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

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

/** Walk up from `start` looking for a `pnpm-workspace.yaml` marker; that's
 *  always the Lash repo root. Returns null if not found within 8 hops. */
const findRepoRoot = (start: string): string | null => {
  let cur = resolve(start);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(cur, 'pnpm-workspace.yaml'))) {
      return cur;
    }
    const parent = dirname(cur);
    if (parent === cur) {
      return null;
    }
    cur = parent;
  }
  return null;
};

/** Resolve the fixtures markdown directory across run contexts.
 *
 *  - CJS (Vitest default): `__dirname` is set; `__dirname/markdown` works directly.
 *  - ESM mode: `__dirname` is undefined; we walk up from `process.cwd()` to the
 *    repo root (sentinel: `pnpm-workspace.yaml`) and resolve repo-relative.
 *  - Vitest invoked from `packages/testing/` (or any subdir): same repo-root
 *    walk handles it; we never compute a path that requires cwd === repo-root.
 *  - Last resort: assume cwd IS the repo root (works in CI from the workspace root).
 *
 *  Multiple candidates are checked; the first existing one wins. This avoids the
 *  proconsult-m0/C P1 scenario where `pnpm vitest` run from `packages/testing/`
 *  computed `packages/testing/packages/testing/fixtures/markdown`.
 */
const fixtureDir = (() => {
  const candidates: string[] = [];
  if (typeof __dirname === 'string') {
    candidates.push(join(__dirname, 'markdown'));
    const root = findRepoRoot(__dirname);
    if (root) candidates.push(join(root, 'packages', 'testing', 'fixtures', 'markdown'));
  }
  const cwdRoot = findRepoRoot(process.cwd());
  if (cwdRoot) candidates.push(join(cwdRoot, 'packages', 'testing', 'fixtures', 'markdown'));
  candidates.push(join(process.cwd(), 'packages', 'testing', 'fixtures', 'markdown'));
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
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

