import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const exportedNames = (relativePath: string) => {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  return [...source.matchAll(/^export\s+(?:async\s+)?(?:const|function)\s+(\w+)/gmu)]
    .map((match) => match[1])
    .sort();
};

describe('Next auth route export contract', () => {
  it('keeps the account-session route limited to valid Next route exports', () => {
    expect(exportedNames('../../../../apps/web/app/api/account/session/route.ts')).toEqual([
      'GET',
      'dynamic',
    ]);
  });

  it('keeps the sign-out route limited to valid Next route exports', () => {
    expect(exportedNames('../../../../apps/web/app/api/auth/sign-out/route.ts')).toEqual([
      'POST',
      'dynamic',
    ]);
  });
});
