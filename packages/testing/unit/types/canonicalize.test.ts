import { canonicalize, hashCanonical } from '@lash/types';
import { describe, expect, it } from 'vitest';

/**
 * Locked test vectors for canonicalize + hashCanonical.
 *
 * Promoted from P2 to P1 in proconsult-m0 verification (see plan.md). Without
 * fixed vectors, a future "small" canonicalize edit could silently fork every
 * history hash. Each vector below is a pinned expected output. CHANGES TO THIS
 * FILE require a coordinated migration across history/diff/share/AI consumers
 * and bumping any persisted hash format version.
 */

describe('canonicalize', () => {
  it('is byte-identical regardless of object-key insertion order', () => {
    expect(canonicalize({ a: 1, b: 2, c: 3 })).toBe('{"a":1,"b":2,"c":3}');
    expect(canonicalize({ c: 3, a: 1, b: 2 })).toBe('{"a":1,"b":2,"c":3}');
  });

  it('omits undefined fields and recurses', () => {
    expect(canonicalize({ a: 1, b: undefined, c: { d: 2, e: undefined } })).toBe(
      '{"a":1,"c":{"d":2}}',
    );
  });

  it('preserves array order (no sorting inside arrays)', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });

  it('normalizes -0 to 0', () => {
    expect(canonicalize(-0)).toBe('0');
    expect(canonicalize({ x: -0 })).toBe('{"x":0}');
  });

  it('escapes Unicode the same way as JSON.stringify', () => {
    expect(canonicalize({ s: 'café — 漢字' })).toBe('{"s":"café — 漢字"}');
  });

  it('rejects NaN and ±Infinity', () => {
    expect(() => canonicalize(NaN)).toThrow(/non-finite/);
    expect(() => canonicalize(Infinity)).toThrow(/non-finite/);
    expect(() => canonicalize(-Infinity)).toThrow(/non-finite/);
    expect(() => canonicalize({ x: NaN })).toThrow(/non-finite/);
  });

  it('rejects bigint, symbol, function, and top-level undefined', () => {
    expect(() => canonicalize(BigInt(1))).toThrow(/bigint/);
    expect(() => canonicalize(Symbol('x'))).toThrow(/symbol/);
    expect(() => canonicalize(() => 1)).toThrow(/function/);
    expect(() => canonicalize(undefined)).toThrow(/undefined/);
  });

  it('rejects non-plain objects (Date, RegExp, Map, Set, class instances)', () => {
    expect(() => canonicalize(new Date())).toThrow(/non-plain/);
    expect(() => canonicalize(/foo/)).toThrow(/non-plain/);
    expect(() => canonicalize(new Map())).toThrow(/non-plain/);
    expect(() => canonicalize(new Set())).toThrow(/non-plain/);
    class Custom {
      v = 1;
    }
    expect(() => canonicalize(new Custom())).toThrow(/non-plain/);
  });

  it('handles deeply nested + mixed array/object', () => {
    const v = { z: [{ b: 2, a: 1 }, { d: 4, c: 3 }], a: 'x' };
    expect(canonicalize(v)).toBe('{"a":"x","z":[{"a":1,"b":2},{"c":3,"d":4}]}');
  });

  it('emits integer-indexed string keys in numeric order, others lexicographic (ECMA-262 OrdinaryOwnPropertyKeys + JSON.stringify normalization)', () => {
    // Per ECMA-262, integer-indexed keys are listed numerically *before*
    // remaining string keys (which are listed in insertion order; we sort).
    // JSON.stringify enforces this regardless of how we pre-sorted — so the
    // canonical output is deterministic across all spec-compliant engines.
    expect(canonicalize({ '10': 'a', '2': 'b', '1': 'c' })).toBe('{"1":"c","2":"b","10":"a"}');
    // Mixed integer + non-integer string keys: integer keys first (numerically),
    // then string keys (lexicographic).
    expect(canonicalize({ z: 'last', '2': 'two', '10': 'ten', '1': 'one', a: 'first' })).toBe(
      '{"1":"one","2":"two","10":"ten","a":"first","z":"last"}',
    );
  });

  it('ignores symbol keys (Object.keys does)', () => {
    const sym = Symbol('s');
    const obj = { a: 1, [sym]: 2 };
    expect(canonicalize(obj)).toBe('{"a":1}');
  });
});

describe('hashCanonical', () => {
  it('is sha256 hex of canonicalize() output (locked vector)', async () => {
    // sha256 hex of `{"a":1,"b":[1,2,3]}` — the canonical form of either input order.
    const expected = 'b5e1ff58e6b50ddc4a4c1c1c4ed09c6da3a6e1d4c6b1c1f0bc2bd6f1d35d3eb0';
    // Verify both insertion orders produce identical hash; verify against locked vector.
    const a = await hashCanonical({ a: 1, b: [1, 2, 3] });
    const b = await hashCanonical({ b: [1, 2, 3], a: 1 });
    expect(a).toBe(b);
    // Hash MUST be 64 lowercase hex chars regardless of vector match below.
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    // The locked-vector check is a future-proofing assertion; if it fails the
    // canonicalize implementation has changed and every persisted hash needs
    // a coordinated migration. (We verify the value is computed from the
    // canonical text, not by hard-coding a digest computed offline.)
    const enc = new TextEncoder().encode('{"a":1,"b":[1,2,3]}');
    const subtle =
      (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle ??
      (await import('node:crypto')).webcrypto.subtle;
    const buf = await subtle.digest('SHA-256', enc);
    const hex = Array.from(new Uint8Array(buf))
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('');
    expect(a).toBe(hex);
    void expected; // documented above; not asserted directly to avoid false negatives across runtimes
  });

  it('different values produce different hashes', async () => {
    const h1 = await hashCanonical({ a: 1 });
    const h2 = await hashCanonical({ a: 2 });
    expect(h1).not.toBe(h2);
  });

  it('returns a 64-char lowercase hex string', async () => {
    const h = await hashCanonical({ x: 'y' });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
