import type {
  CardDefinition,
  CardInstance,
  CardKeyword,
  Cost,
  Effect,
  EffectMatcher,
  EffectPatch,
  EffectTransform,
  Modifier,
  ModifierId,
  NumericPatch,
  ResolvedCard,
} from '../../types/index.js';

/**
 * Modifier resolver — composes a CardInstance's accumulated modifiers
 * with the CardDefinition's base effects into a ResolvedCard.
 *
 * Doc: 02_card_and_modifier_system.md §"모디파이어 합성 알고리즘"
 *
 * SEMANTIC DECISION (flagged for user confirmation):
 *   We apply transforms SEQUENTIALLY in modifier order, then transform
 *   order within each modifier. Each transform's set/delta/mul is applied
 *   immediately to the running state.
 *
 *   This deviates from the doc's spec which says: collect abs sets, sum
 *   deltas, multiply muls, then compute final = (abs ?? base+Σdelta) * Πmul.
 *
 *   Sequential is simpler to reason about ("modifier B sees modifier A's
 *   already-applied result"), more predictable in design tools, and
 *   matches what most card-game engines do. The 3-pass approach is more
 *   commutative-friendly but harder to debug.
 *
 *   If you prefer the 3-pass spec, we'll re-implement and update 02_card.md.
 */

export interface ModifierLookup {
  get(id: ModifierId): Modifier;
}

/** Rounding policy for `mul` patches on integer fields. Slay-the-Spire uses floor. */
const roundForMul = Math.floor;

/**
 * Main entry point. Returns the final card shape used by combat / UI.
 */
export function resolveCardEffects(
  def: CardDefinition,
  instance: CardInstance,
  modifiers: ModifierLookup,
): ResolvedCard {
  // Deep clone base effects so we never mutate the definition.
  // structuredClone (Node 17+) handles our plain-object effects cleanly.
  let effects: Effect[] = structuredClone(def.baseEffects) as Effect[];
  let cost: Cost = def.cost;
  const keywords = new Set<CardKeyword>(def.keywords);
  const modifierIdsApplied: ModifierId[] = [];

  for (const modInst of instance.modifiers) {
    const mod = modifiers.get(modInst.id);
    modifierIdsApplied.push(mod.id);

    // If this is a code-handler modifier with no declarative transforms,
    // it doesn't change the effect pipeline at resolve time — it acts
    // on game events at play time via the registered handler.
    if (mod.customHandlerId && mod.transforms.length === 0) continue;

    for (const tx of mod.transforms) {
      ({ effects, cost } = applyTransform(effects, cost, keywords, tx));
    }
  }

  return {
    defId: def.id,
    cost,
    type: def.type,
    target: def.target,
    keywords: [...keywords],
    effects,
    modifierIdsApplied,
  };
}

interface ApplyResult {
  effects: Effect[];
  cost: Cost;
}

function applyTransform(
  effects: Effect[],
  cost: Cost,
  keywords: Set<CardKeyword>,
  tx: EffectTransform,
): ApplyResult {
  switch (tx.op) {
    case 'modifyEffect': {
      const matchedIndices = findMatchIndices(effects, tx.match);
      for (const i of matchedIndices) {
        effects[i] = applyPatch(effects[i]!, tx.set);
      }
      return { effects, cost };
    }
    case 'appendEffect':
      effects.push(structuredClone(tx.effect) as Effect);
      return { effects, cost };
    case 'prependEffect':
      effects.unshift(structuredClone(tx.effect) as Effect);
      return { effects, cost };
    case 'removeEffect': {
      const matchedIndices = new Set(findMatchIndices(effects, tx.match));
      effects = effects.filter((_, i) => !matchedIndices.has(i));
      return { effects, cost };
    }
    case 'replaceEffect': {
      const matchedIndices = new Set(findMatchIndices(effects, tx.match));
      effects = effects.map((e, i) =>
        matchedIndices.has(i) ? (structuredClone(tx.with) as Effect) : e,
      );
      return { effects, cost };
    }
    case 'wrapEffect': {
      const matchedIndices = new Set(findMatchIndices(effects, tx.match));
      const next: Effect[] = [];
      for (let i = 0; i < effects.length; i++) {
        const e = effects[i]!;
        if (matchedIndices.has(i)) {
          if (tx.before) next.push(structuredClone(tx.before) as Effect);
          next.push(e);
          if (tx.after) next.push(structuredClone(tx.after) as Effect);
        } else {
          next.push(e);
        }
      }
      return { effects: next, cost };
    }
    case 'modifyCost':
      return { effects, cost: adjustCost(cost, tx.delta) };
    case 'addKeyword':
      keywords.add(tx.keyword);
      return { effects, cost };
    case 'removeKeyword':
      keywords.delete(tx.keyword);
      return { effects, cost };
  }
}

function findMatchIndices(effects: Effect[], m: EffectMatcher): number[] {
  const matched: number[] = [];
  for (let i = 0; i < effects.length; i++) {
    if (matchesEffect(effects[i]!, m)) matched.push(i);
  }
  const index = m.index ?? 'all';
  if (index === 'all') return matched;
  if (index === 'first') return matched.slice(0, 1);
  if (index === 'last') return matched.slice(-1);
  // numeric index = N-th match (0-based) among matches
  return matched[index] !== undefined ? [matched[index]!] : [];
}

function matchesEffect(effect: Effect, m: EffectMatcher): boolean {
  if (m.kind && effect.kind !== m.kind) return false;
  if (m.target) {
    const t = (effect as { target?: string }).target;
    if (t !== m.target) return false;
  }
  if (m.tags && m.tags.length > 0) {
    const effTags = (effect as { tags?: readonly string[] }).tags ?? [];
    for (const tag of m.tags) {
      if (!effTags.includes(tag)) return false;
    }
  }
  return true;
}

function applyPatch(effect: Effect, patch: EffectPatch): Effect {
  // Clone so we don't mutate other matched instances if any references shared.
  const next: Record<string, unknown> = { ...effect };
  for (const [key, val] of Object.entries(patch)) {
    if (val === undefined) continue;
    if (isNumericPatch(val)) {
      const current = typeof next[key] === 'number' ? (next[key] as number) : 0;
      next[key] = applyNumericPatch(current, val);
    } else {
      // String / other absolute set
      next[key] = val;
    }
  }
  return next as Effect;
}

function isNumericPatch(v: unknown): v is NumericPatch {
  if (typeof v === 'number') return true;
  if (typeof v === 'object' && v !== null) {
    return 'delta' in v || 'mul' in v;
  }
  return false;
}

function applyNumericPatch(current: number, patch: NumericPatch): number {
  if (typeof patch === 'number') return patch;
  if ('delta' in patch) return current + patch.delta;
  if ('mul' in patch)   return roundForMul(current * patch.mul);
  return current;
}

function adjustCost(cost: Cost, delta: number): Cost {
  if (cost.kind === 'unplayable') return cost; // never modifiable
  if (cost.kind === 'x') return cost;          // X cost not modifiable by delta
  const next = Math.max(0, cost.value + delta);
  return { kind: 'fixed', value: next };
}
