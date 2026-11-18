import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type JsonRecord = Record<string, unknown>;

const repositoryRoot = path.resolve(process.cwd());
const webRoot = path.join(repositoryRoot, 'apps/web');

const readJson = async (relativePath: string): Promise<JsonRecord> =>
  JSON.parse(await readFile(path.join(repositoryRoot, relativePath), 'utf8')) as JsonRecord;

const productSourceFiles = async (directory: string): Promise<string[]> => {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ['.next', 'e2e', 'node_modules', 'out'].includes(entry.name)) {
      continue;
    }

    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await productSourceFiles(absolute)));
    } else if (entry.isFile() && /\.(?:ts|tsx|js|jsx|mjs)$/u.test(entry.name)) {
      files.push(absolute);
    }
  }
  return files.sort();
};

describe('production and harness TypeScript boundary', () => {
  it('keeps Playwright sources out of the Next application project', async () => {
    const config = await readJson('apps/web/tsconfig.json');
    expect(config.exclude).toEqual(expect.arrayContaining(['node_modules', 'e2e']));

    for (const file of await productSourceFiles(webRoot)) {
      const source = await readFile(file, 'utf8');
      expect(source, `${file} imports the E2E harness`).not.toMatch(
        /(?:from\s+|import\s*\(|require\s*\()\s*['"][^'"]*e2e\//u,
      );
    }
  });

  it('keeps every Playwright source in one strict no-emit harness project', async () => {
    const config = await readJson('apps/web/tsconfig.e2e.json');
    const compilerOptions = config.compilerOptions as JsonRecord;

    expect(config.extends).toBe('../../tsconfig.base.json');
    expect(config.include).toEqual(['e2e/**/*.ts', '../../playwright.config.ts']);
    expect(compilerOptions).toMatchObject({
      allowImportingTsExtensions: true,
      lib: ['ESNext', 'DOM', 'DOM.Iterable'],
      moduleResolution: 'Bundler',
      noEmit: true,
      strict: true,
    });
    expect(config.exclude).toBeUndefined();
  });

  it('exposes non-recursive product, harness, combined, and build commands', async () => {
    const productConfig = await readJson('tsconfig.product.json');
    const productCompilerOptions = productConfig.compilerOptions as JsonRecord;
    const rootPackage = await readJson('package.json');
    const rootScripts = rootPackage.scripts as Record<string, string>;
    const webPackage = await readJson('apps/web/package.json');
    const webScripts = webPackage.scripts as Record<string, string>;

    expect(webScripts.typecheck).toBe('tsc -p tsconfig.json --noEmit');
    expect(webScripts['typecheck:e2e']).toBe('tsc -p tsconfig.e2e.json --noEmit');
    expect(productConfig.include).toEqual([
      'apps/web/next-env.d.ts',
      'apps/web/**/*.ts',
      'apps/web/**/*.tsx',
      'packages/*/src/**/*.ts',
      'packages/*/src/**/*.tsx',
    ]);
    expect(productConfig.exclude).toEqual(
      expect.arrayContaining(['apps/web/e2e', 'packages/testing', 'packages/realtime-worker']),
    );
    expect(productCompilerOptions).toMatchObject({ noEmit: true, strict: true });
    expect(rootScripts['typecheck:product']).toBe(
      'tsc -p tsconfig.product.json --noEmit && pnpm --filter @lash/realtime-worker run typecheck',
    );
    expect(rootScripts['typecheck:harness']).toBe('pnpm --filter @lash/web run typecheck:e2e');
    expect(rootScripts.typecheck).toBe('pnpm run typecheck:product && pnpm run typecheck:harness');
    expect(rootScripts.build).toBe('pnpm run typecheck:product && pnpm --filter @lash/web build');
    expect(rootScripts['build:static']).toBe(
      'pnpm run typecheck:product && pnpm --filter @lash/web build:static',
    );
  });

  it('makes both compiler boundaries explicit in CI and Make', async () => {
    const ci = await readFile(path.join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
    const makefile = await readFile(path.join(repositoryRoot, 'Makefile'), 'utf8');
    const nextConfig = await readFile(path.join(webRoot, 'next.config.mjs'), 'utf8');

    expect(ci).toContain('- name: Product typecheck\n        run: pnpm run typecheck:product');
    expect(ci).toContain(
      '- name: Harness and evidence typecheck\n        run: pnpm run typecheck:harness',
    );
    expect(makefile).toContain('typecheck-product:\n\tpnpm run typecheck:product');
    expect(makefile).toContain('typecheck-harness:\n\tpnpm run typecheck:harness');
    expect(nextConfig).not.toContain('ignoreBuildErrors');
  });
});
