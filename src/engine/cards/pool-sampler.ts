import type { CardDefId, CardPool } from '../../types/index.js';
import type { IRandom } from '../rng.js';

/**
 * CardPool sampler — picks N CardDefIds from a CardPool with weighted
 * probability, no replacement.
 *
 * Mirrors weightedSampleWithoutReplacement in modifiers/sampler.ts but
 * stays typed to CardDefId so the two pool worlds remain separate.
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
