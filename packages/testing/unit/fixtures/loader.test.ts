import { describe, expect, it } from 'vitest';

import {
  listAvailableFixtures,
  loadFixture,
  RegisteredButMissingFixtureError,
  UnknownFixtureError,
} from '../../fixtures/index';

describe('fixture loader', () => {
  it('lists exactly the fixtures whose source files exist', () => {
    // Today only legal-contract has a markdown file. Asserting EQUALITY (not
    // .toContain) catches a regression where a half-built fixture leaks into
    // available without a real file behind it.
    expect(listAvailableFixtures()).toEqual(['legal-contract']);
  });

  it('loads the legal-contract fixture as non-empty markdown', () => {
    const bundle = loadFixture('legal-contract');
    expect(bundle.name).toBe('legal-contract');
    expect(bundle.markdown.length).toBeGreaterThan(500);
    expect(bundle.markdown).toContain('# MASTER SERVICES AGREEMENT');
    expect(bundle.markdown).toMatch(/##\s+1\.\s+Definitions/);
  });

  it('throws UnknownFixtureError for names not in REGISTERED', () => {
    let caught: unknown;
    try {
      loadFixture('does-not-exist' as never);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnknownFixtureError);
    expect((caught as UnknownFixtureError).code).toBe('UNKNOWN_FIXTURE');
    expect((caught as UnknownFixtureError).message).toMatch(/Unknown fixture/);
  });

  it('throws RegisteredButMissingFixtureError for names that are registered but lack a source file', () => {
    let caught: unknown;
    try {
      loadFixture('multilingual');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RegisteredButMissingFixtureError);
    expect((caught as RegisteredButMissingFixtureError).code).toBe('REGISTERED_BUT_MISSING');
    expect((caught as RegisteredButMissingFixtureError).message).toMatch(/multilingual/);
  });
});
