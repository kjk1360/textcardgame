/**
 * Seeded pseudo-random number generator (Mulberry32).
 *
 * - Deterministic: same seed → same sequence forever.
 * - Cheap (no crypto), single 32-bit state.
 * - Good enough for game randomness (deck shuffling, sampling, intent rolls).
 *   NOT for cryptography, NOT for anything security-sensitive.
 *
 * All engine randomness flows through this. Direct Math.random() in
 * engine code is a bug — breaks save/load reproducibility and tests.
 */

export interface IRandom {
  /** [0.0, 1.0) — uniform float */
  float(): number;
  /** Inclusive both ends. */
  intBetween(min: number, max: number): number;
  /** Pick a random element. Throws on empty array. */
  pick<T>(arr: readonly T[]): T;
  /** Returns a NEW shuffled array (does not mutate input). Fisher-Yates. */
  shuffle<T>(arr: readonly T[]): T[];
}

export function makeRng(seed: string): IRandom {
  let state = seedFromString(seed);

  function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    float: next,
    intBetween(min, max) {
      if (max < min) throw new Error(`intBetween: max(${max}) < min(${min})`);
      return min + Math.floor(next() * (max - min + 1));
    },
    pick(arr) {
      if (arr.length === 0) throw new Error('pick: empty array');
      return arr[Math.floor(next() * arr.length)]!;
    },
    shuffle(arr) {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = a[i]!;
        a[i] = a[j]!;
        a[j] = tmp;
      }
      return a;
    },
  };
}

/** FNV-1a 32-bit. Stable hash of a seed string. */
function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
