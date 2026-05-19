import type {
  CardDefinition,
  CardInstance,
  CardKeyword,
  Cost,
  Effect,
  EffectMatcher,
  EffectPatch,
  Modifier,
  ModifierId,
  NumericPatch,
  ResolvedCard,
} from '../../types/index.js';

/**
 * Modifier resolver — composes a CardInstance's accumulated modifiers
 * with the CardDefinition's base effects into a ResolvedCard.
 *
 * GUARANTEE: The same SET of modifiers always produces the same result,
 * regardless of attach order. This is critical because the game's
 * enhancement events are randomized — players cannot control the order
 * in which modifiers stack.
 *
 * Algorithm (doc: 02_card_and_modifier_system.md):
 *
 *   0. Sort modifiers by ID (canonical order — eliminates attach-order effects)
 *
 *   1. modifyEffect — accumulate per (effectIndex, field):
 *        - absValue: alphabetically-latest mod ID wins on tie
 *        - deltaSum: all deltas summed (commutative)
 *        - mulProduct: all muls multiplied (commutative)
 *        - applied as: final = (abs ?? base + Σdelta) × Πmul, then floor
 *
 *   2. removeEffect — filter matching (idempotent)
 *   3. replaceEffect — swap matching (apply in sorted mod-id order)
 *   4. wrapEffect — wrap matching with before/after (sorted)
 *   5. prependEffect — insert at start (sorted, so later mods appear earlier)
 *   6. appendEffect — push to end (sorted, so later mods appear later)
 *
 *   7. modifyCost — sum all deltas (commutative)
 *   8. keywords — added = ∪addKeyword, removed = ∪removeKeyword,
 *                  final = (base ∪ added) \ removed   (remove wins over add)
 *
 * For conflicting ops on the same effect (e.g., one mod removes damage,
 * another replaces it), use Modifier.conflictsWith[] to declare them
 * mutually exclusive — the data pipeline will prevent both from being
 * attached at the same time.
 */

export interface ModifierLookup {
  get(id: ModifierId): Modifier;
}

/** Rounding policy for `mul` patches on integer fields. Slay-the-Spire uses floor. */
const roundForMul = Math.floor;

export function resolveCardEffects(
  def: CardDefinition,
  instance: CardInstance,
  modifiers: ModifierLookup,
): ResolvedCard {
  // 0. Canonical sort
  const sortedInstances = [...instance.modifiers].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const sortedDefs = sortedInstances.map(mi => modifiers.get(mi.id));

  // Pure-handler modifiers (customHandlerId + no transforms) don't change
  // the resolved card at resolve time — they hook into game events.
  const declarative = sortedDefs.filter(
    m => !(m.customHandlerId && m.transforms.length === 0),
  );

  // Deep-clone base so we never mutate the definition.
  let effects: Effect[] = structuredClone(def.baseEffects) as Effect[];

  // ---- Phase 1: modifyEffect (3-pass accumulators) ----
  const accumulators = new Map<number, FieldAccumulator>();
  for (const mod of declarative) {
    for (const tx of mod.transforms) {
      if (tx.op !== 'modifyEffect') continue;
      const matched = findMatchIndices(effects, tx.match);
      for (const idx of matched) {
        let acc = accumulators.get(idx);
        if (!acc) {
          acc = new FieldAccumulator();
          accumulators.set(idx, acc);
        }
        acc.addPatch(tx.set, mod.id);
      }
    }
  }
  effects = effects.map((eff, i) => {
    const acc = accumulators.get(i);
    return acc ? acc.applyTo(eff) : eff;
  });

  // ---- Phase 2: removeEffect ----
  for (const mod of declarative) {
    for (const tx of mod.transforms) {
      if (tx.op !== 'removeEffect') continue;
      effects = effects.filter(e => !matchesEffect(e, tx.match));
    }
  }

  // ---- Phase 3: replaceEffect ----
  for (const mod of declarative) {
    for (const tx of mod.transforms) {
      if (tx.op !== 'replaceEffect') continue;
      effects = effects.map(e =>
        matchesEffect(e, tx.match) ? (structuredClone(tx.with) as Effect) : e,
      );
    }
  }

  // ---- Phase 4: wrapEffect ----
  for (const mod of declarative) {
    for (const tx of mod.transforms) {
      if (tx.op !== 'wrapEffect') continue;
      const next: Effect[] = [];
      for (const e of effects) {
        if (matchesEffect(e, tx.match)) {
          if (tx.before) next.push(structuredClone(tx.before) as Effect);
          next.push(e);
          if (tx.after) next.push(structuredClone(tx.after) as Effect);
        } else {
          next.push(e);
        }
      }
      effects = next;
    }
  }

  // ---- Phase 5: prependEffect ----
  // Iterating sorted-forward and unshifting means alphabetically-later
  // mods end up closer to the start. To make alphabetically-earlier mods
  // appear closer to the base (symmetric with append), iterate in reverse.
  for (let i = declarative.length - 1; i >= 0; i--) {
    const mod = declarative[i]!;
    for (const tx of mod.transforms) {
      if (tx.op !== 'prependEffect') continue;
      effects.unshift(structuredClone(tx.effect) as Effect);
    }
  }

  // ---- Phase 6: appendEffect ----
  for (const mod of declarative) {
    for (const tx of mod.transforms) {
      if (tx.op !== 'appendEffect') continue;
      effects.push(structuredClone(tx.effect) as Effect);
    }
  }

  // ---- Phase 7: modifyCost (sum) ----
  let costDeltaSum = 0;
  for (const mod of declarative) {
    for (const tx of mod.transforms) {
      if (tx.op !== 'modifyCost') continue;
      costDeltaSum += tx.delta;
    }
  }
  const cost = adjustCost(def.cost, costDeltaSum);

  // ---- Phase 8: keywords (add then remove; remove wins) ----
  const keywords = new Set<CardKeyword>(def.keywords);
  const added = new Set<CardKeyword>();
  const removed = new Set<CardKeyword>();
  for (const mod of declarative) {
    for (const tx of mod.transforms) {
      if (tx.op === 'addKeyword') added.add(tx.keyword);
      else if (tx.op === 'removeKeyword') removed.add(tx.keyword);
    }
  }
  for (const k of added) keywords.add(k);
  for (const k of removed) keywords.delete(k);

  return {
    defId: def.id,
    cost,
    type: def.type,
    target: def.target,
    keywords: [...keywords],
    effects,
    modifierIdsApplied: sortedInstances.map(mi => mi.id),
  };
}

// ====================================================================
// Internals
// ====================================================================

interface AbsRecord {
  value: unknown;
  modId: ModifierId;
}

class FieldAccumulator {
  /** Latest abs per field — tie broken by alphabetically-greater mod id. */
  private abs = new Map<string, AbsRecord>();
  private deltaSum = new Map<string, number>();
  private mulProduct = new Map<string, number>();

  addPatch(patch: EffectPatch, modId: ModifierId): void {
    for (const [key, val] of Object.entries(patch)) {
      if (val === undefined) continue;

      if (isNumericPatch(val)) {
        if (typeof val === 'number') {
          this.recordAbs(key, val, modId);
        } else if ('delta' in val) {
          this.deltaSum.set(key, (this.deltaSum.get(key) ?? 0) + val.delta);
        } else if ('mul' in val) {
          this.mulProduct.set(key, (this.mulProduct.get(key) ?? 1) * val.mul);
        }
      } else {
        // Non-numeric (string/enum) field — absolute set only.
        this.recordAbs(key, val, modId);
      }
    }
  }

  private recordAbs(key: string, value: unknown, modId: ModifierId): void {
    const cur = this.abs.get(key);
    if (!cur || modId.localeCompare(cur.modId) > 0) {
      this.abs.set(key, { value, modId });
    }
  }

  applyTo(effect: Effect): Effect {
    const result: Record<string, unknown> = { ...effect };
    const allKeys = new Set<string>([
      ...this.abs.keys(),
      ...this.deltaSum.keys(),
      ...this.mulProduct.keys(),
    ]);

    for (const key of allKeys) {
      const absRec = this.abs.get(key);
      const delta = this.deltaSum.get(key) ?? 0;
      const mul = this.mulProduct.get(key) ?? 1;

      // Non-numeric field: only abs is meaningful. delta/mul on non-numeric
      // are ignored (a designer/data error — should be caught in validation).
      if (absRec && typeof absRec.value !== 'number') {
        result[key] = absRec.value;
        continue;
      }

      // Numeric field
      const base = absRec
        ? (absRec.value as number)
        : typeof result[key] === 'number'
          ? (result[key] as number)
          : 0;
      const withDelta = base + delta;
      const final = mul === 1 ? withDelta : roundForMul(withDelta * mul);
      result[key] = final;
    }
    return result as Effect;
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

function isNumericPatch(v: unknown): v is NumericPatch {
  if (typeof v === 'number') return true;
  if (typeof v === 'object' && v !== null) {
    return 'delta' in v || 'mul' in v;
  }
  return false;
}

function adjustCost(cost: Cost, delta: number): Cost {
  if (cost.kind === 'unplayable') return cost;
  if (cost.kind === 'x') return cost;
  return { kind: 'fixed', value: Math.max(0, cost.value + delta) };
}
