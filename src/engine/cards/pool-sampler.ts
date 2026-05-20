import type { CardDefId, CardPool } from '../../types/index.js';
import type { IRandom } from '../rng.js';

/**
 * CardPool sampler — picks N CardDefIds from one or more CardPools
 * with weighted probability, no replacement.
 *
 * Two flavors:
 *  - `sampleCardsFromPool` (single-pool, legacy convenience)
 *  - `sampleCardsFromPools` (multi-pool, dedupe via MAX weight —
 *    mirrors the modifier sampler's set-of-options semantics)
 *
 * Doc: 04_event_flow_system.md §"카드 풀 (CardPool)"
 */

export interface CardPoolSampleOptions {
  /** CardDefIds to exclude from selection (e.g., already-offered duplicates). */
  readonly exclude?: ReadonlySet<CardDefId>;
}

export function sampleCardsFromPool(
  pool: CardPool,
  count: number,
  rng: IRandom,
  opts?: CardPoolSampleOptions,
): CardDefId[] {
  // Filter eligible entries
  const eligible = pool.entries
    .filter(e => !(opts?.exclude?.has(e.cardDefId)))
    .map(e => ({ id: e.cardDefId, weight: e.weight }));
  return weightedSampleCards(eligible, count, rng);
}

/**
 * Merge multiple pools into one weighted bag and sample N cards.
 *
 * Dedupe semantics (matches `modifiers/sampler.ts`): when a card
 * appears in multiple pools, its weight is the MAX across those pools.
 * Being in N pools means "valid in either context", not "more likely".
 *
 * Pool ordering does not affect outcome — dedupe is deterministic by
 * (cardDefId → max weight).
 */
export function sampleCardsFromPools(
  pools: ReadonlyArray<CardPool>,
  count: number,
  rng: IRandom,
  opts?: CardPoolSampleOptions,
): CardDefId[] {
  const weights = new Map<CardDefId, number>();
  for (const pool of pools) {
    for (const entry of pool.entries) {
      if (opts?.exclude?.has(entry.cardDefId)) continue;
      const prev = weights.get(entry.cardDefId);
      weights.set(
        entry.cardDefId,
        prev === undefined ? entry.weight : Math.max(prev, entry.weight),
      );
    }
  }
  const entries = [...weights].map(([id, weight]) => ({ id, weight }));
  return weightedSampleCards(entries, count, rng);
}

function weightedSampleCards(
  entries: Array<{ id: CardDefId; weight: number }>,
  n: number,
  rng: IRandom,
): CardDefId[] {
  const picked: CardDefId[] = [];
  const pool = entries.map(e => ({ ...e }));
  for (let i = 0; i < n && pool.length > 0; i++) {
    const total = pool.reduce((s, e) => s + e.weight, 0);
    if (total <= 0) break;
    let r = rng.float() * total;
    let idx = 0;
    for (; idx < pool.length - 1; idx++) {
      r -= pool[idx]!.weight;
      if (r <= 0) break;
    }
    picked.push(pool[idx]!.id);
    pool.splice(idx, 1);
  }
  return picked;
}
