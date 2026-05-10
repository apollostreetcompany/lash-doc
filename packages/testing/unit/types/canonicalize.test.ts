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
  // LOCKED VECTOR — DO NOT EDIT WITHOUT A COORDINATED HASH-MIGRATION PR.
  // SHA-256 hex of the canonical text `{"a":1,"b":[1,2,3]}` (verified via
  // `echo -n '{"a":1,"b":[1,2,3]}' | shasum -a 256` on the Lash dev box).
  const LOCKED_HASH_AB123 = 'bfa6ceebf136e4837ec687f2be09f612c645c9ec1f99e3ef5d497b0d5bb99e0a';

  it('is sha256 hex of canonicalize() output and matches the locked vector', async () => {
    const a = await hashCanonical({ a: 1, b: [1, 2, 3] });
    const b = await hashCanonical({ b: [1, 2, 3], a: 1 });
    expect(a).toBe(b); // insertion-order independence
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(LOCKED_HASH_AB123);
  });

  it('matches a second locked vector for an empty object', async () => {
    // SHA-256 hex of `{}` — verified the same way as above.
    const LOCKED_HASH_EMPTY_OBJECT = '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a';
    const h = await hashCanonical({});
    expect(h).toBe(LOCKED_HASH_EMPTY_OBJECT);
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
