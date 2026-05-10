import { describe, expect, it } from 'vitest';

import { listAvailableFixtures, loadFixture } from '../../fixtures/index';

describe('fixture loader', () => {
  it('lists at least the legal-contract fixture', () => {
    const available = listAvailableFixtures();
    expect(available).toContain('legal-contract');
  });

  it('loads the legal-contract fixture as non-empty markdown', () => {
    const bundle = loadFixture('legal-contract');
    expect(bundle.name).toBe('legal-contract');
    expect(bundle.markdown.length).toBeGreaterThan(500);
    // Sanity: has at least the top-level heading and a numbered subsection
    expect(bundle.markdown).toContain('# MASTER SERVICES AGREEMENT');
    expect(bundle.markdown).toMatch(/##\s+1\.\s+Definitions/);
  });

  it('throws on unknown fixture name', () => {
    expect(() => loadFixture('does-not-exist' as never)).toThrow(/Unknown fixture/);
  });
});
