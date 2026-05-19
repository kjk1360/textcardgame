import { describe, expect, it } from 'vitest';
import { makeRng } from './rng.js';

describe('makeRng', () => {
  it('same seed produces same sequence', () => {
    const a = makeRng('seed-1');
    const b = makeRng('seed-1');
    for (let i = 0; i < 100; i++) {
      expect(a.float()).toBe(b.float());
    }
  });

  it('different seeds produce different sequences', () => {
    const a = makeRng('seed-1');
    const b = makeRng('seed-2');
    const aVals = Array.from({ length: 20 }, () => a.float());
    const bVals = Array.from({ length: 20 }, () => b.float());
    expect(aVals).not.toEqual(bVals);
  });

  it('float() stays in [0, 1)', () => {
    const r = makeRng('floats');
    for (let i = 0; i < 1000; i++) {
      const v = r.float();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  describe('intBetween', () => {
    it('returns values within inclusive range', () => {
      const r = makeRng('ints');
      for (let i = 0; i < 1000; i++) {
        const v = r.intBetween(5, 10);
        expect(v).toBeGreaterThanOrEqual(5);
        expect(v).toBeLessThanOrEqual(10);
        expect(Number.isInteger(v)).toBe(true);
      }
    });

    it('handles min === max', () => {
      const r = makeRng('same');
      for (let i = 0; i < 10; i++) {
        expect(r.intBetween(7, 7)).toBe(7);
      }
    });

    it('throws when max < min', () => {
      const r = makeRng('bad');
      expect(() => r.intBetween(10, 5)).toThrow();
    });
  });

  describe('pick', () => {
    it('returns a member of the input array', () => {
      const r = makeRng('pick');
      const arr = ['a', 'b', 'c', 'd'];
      for (let i = 0; i < 100; i++) {
        expect(arr).toContain(r.pick(arr));
      }
    });

    it('throws on empty', () => {
      const r = makeRng('empty');
      expect(() => r.pick([])).toThrow();
    });
  });

  describe('shuffle', () => {
    it('returns same elements (permutation)', () => {
      const r = makeRng('shuffle');
      const input = [1, 2, 3, 4, 5];
      const out = r.shuffle(input);
      expect(out.sort()).toEqual([1, 2, 3, 4, 5]);
    });

    it('does not mutate input', () => {
      const r = makeRng('shuffle');
      const input = [1, 2, 3, 4, 5];
      const copy = [...input];
      r.shuffle(input);
      expect(input).toEqual(copy);
    });

    it('is deterministic for same seed', () => {
      const a = makeRng('det');
      const b = makeRng('det');
      const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      expect(a.shuffle(arr)).toEqual(b.shuffle(arr));
    });
  });
});
