import type {
  CardDefinition,
  CardInstance,
  EffectTag,
  Modifier,
  ModifierId,
  ModifierPool,
  ModifierPoolId,
  PoolCondition,
} from '../../types/index.js';
import type { IRandom } from '../rng.js';
import type { ModifierLookup } from './resolver.js';

/**
 * Pool sampler — given a CardInstance and the pools its CardDefinition
 * draws from (plus any event-supplied add/remove overrides), produces
 * N candidate ModifierIds for the player to choose from on upgrade.
 *
 * Doc: 02_card_and_modifier_system.md §"모디파이어 풀 시스템"
 *
 * Rules:
 * - Effective pools = (card.modifierPoolRefs ∪ override.add) \ override.remove
 * - Candidate weights are SUMMED if a modifier appears in multiple
 *   effective pools. (Pool entry weight overrides Modifier.weight.)
 * - Excludes modifiers already attached to the instance (no duplicates).
 * - Excludes modifiers whose `conflictsWith` includes any attached id.
 * - Excludes modifiers whose `requires` aren't all attached.
 * - Excludes pool entries whose `conditional` is unmet.
 * - Excludes modifiers that would exceed CardDefinition.maxModifiers.
 * - Returns fewer than `count` when the candidate pool is too small.
 */

export interface PoolLookup {
  get(id: ModifierPoolId): ModifierPool;
}

export interface PoolSampleContext {
  readonly cardDef: CardDefinition;
  readonly difficultyLevel?: number;
  readonly customPredicates?: ReadonlyMap<
    string,
    (params: Record<string, unknown> | undefined, ctx: PoolSampleContext) => boolean
  >;
}

export interface PoolOverride {
  readonly add?: readonly ModifierPoolId[];
  readonly remove?: readonly ModifierPoolId[];
}

export function sampleModifierUpgrades(
  cardInstance: CardInstance,
  count: number,
  pools: PoolLookup,
  modifiers: ModifierLookup,
  ctx: PoolSampleContext,
  rng: IRandom,
  override?: PoolOverride,
): ModifierId[] {
  // 1. Effective pool list
  const effectivePoolIds = resolvePoolIds(
    ctx.cardDef.modifierPoolRefs,
    override,
  );

  // 2. Slot capacity check (maxModifiers)
  const max = ctx.cardDef.maxModifiers;
  if (max !== undefined && cardInstance.modifiers.length >= max) return [];

  // 3. Build candidate weight map (sum across pools)
  const weights = new Map<ModifierId, number>();
  for (const poolId of effectivePoolIds) {
    const pool = pools.get(poolId);
    for (const entry of pool.entries) {
      if (entry.conditional && !evalPoolCondition(entry.conditional, ctx)) continue;
      weights.set(entry.modifierId, (weights.get(entry.modifierId) ?? 0) + entry.weight);
    }
  }

  // 4. Exclude already-attached
  const attached = new Set(cardInstance.modifiers.map(m => m.id));
  for (const id of attached) weights.delete(id);

  // 5. Exclude conflicts/requires violations
  for (const id of [...weights.keys()]) {
    const mod = modifiers.get(id);
    if (!isCompatibleWithAttached(mod, attached)) {
      weights.delete(id);
    }
  }

  // 6. Zero-or-negative weight cleanup
  for (const [id, w] of [...weights.entries()]) {
    if (w <= 0) weights.delete(id);
  }

  // 7. Weighted sample without replacement
  const entries: Array<{ id: ModifierId; weight: number }> = [...weights].map(
    ([id, weight]) => ({ id, weight }),
  );
  return weightedSampleWithoutReplacement(entries, count, rng);
}

// ====================================================================
// Internals (also exported for testing convenience)
// ====================================================================

export function resolvePoolIds(
  base: readonly ModifierPoolId[],
  override?: PoolOverride,
): ModifierPoolId[] {
  const set = new Set<ModifierPoolId>(base);
  for (const r of override?.remove ?? []) set.delete(r);
  for (const a of override?.add ?? []) set.add(a);
  return [...set];
}

export function isCompatibleWithAttached(
  mod: Modifier,
  attached: ReadonlySet<ModifierId>,
): boolean {
  if (mod.conflictsWith) {
    for (const cid of mod.conflictsWith) {
      if (attached.has(cid)) return false;
    }
  }
  if (mod.requires) {
    for (const rid of mod.requires) {
      if (!attached.has(rid)) return false;
    }
  }
  return true;
}

export function evalPoolCondition(
  cond: PoolCondition,
  ctx: PoolSampleContext,
): boolean {
  switch (cond.kind) {
    case 'hasTag': {
      const tag = cond.tag as EffectTag;
      return ctx.cardDef.tags.includes(tag);
    }
    case 'minLevel':
      return (ctx.difficultyLevel ?? 0) >= cond.level;
    case 'custom': {
      const fn = ctx.customPredicates?.get(cond.predicateId);
      if (!fn) {
        throw new Error(`Custom pool predicate not registered: ${cond.predicateId}`);
      }
      return fn(undefined, ctx);
    }
  }
}

export function weightedSampleWithoutReplacement(
  entries: ReadonlyArray<{ id: ModifierId; weight: number }>,
  n: number,
  rng: IRandom,
): ModifierId[] {
  const picked: ModifierId[] = [];
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
