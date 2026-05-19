import type { CardKeyword } from './card.js';
import type { Effect, EffectKind, TargetKind } from './effect.js';
import type { EffectTag, ModifierId, ModifierPoolId } from './ids.js';

/**
 * EffectMatcher — filters which effects in a card's pipeline a transform
 * applies to. Empty matcher matches all.
 */
export interface EffectMatcher {
  readonly kind?: EffectKind;
  readonly target?: TargetKind;
  readonly tags?: readonly EffectTag[];
  readonly index?: number | 'first' | 'last' | 'all';   // default 'all'
}

/**
 * NumericPatch — patches a numeric field of an effect.
 *
 * - number       → absolute set (later abs wins over earlier)
 * - { delta: N } → additive offset (summed)
 * - { mul: M }   → multiplicative scale (multiplied)
 */
export type NumericPatch = number | { readonly delta: number } | { readonly mul: number };

/**
 * EffectPatch — fields to patch on matched effects. Only fields present
 * on the matched effect kind are meaningful; others are ignored.
 *
 * `target` accepts a flat TargetKind override.
 */
export interface EffectPatch {
  readonly amount?: NumericPatch;
  readonly target?: TargetKind;
  readonly hits?: NumericPatch;
  readonly count?: NumericPatch;
  readonly stacks?: NumericPatch;
}

/**
 * EffectTransform — the DSL for how a modifier changes a card's effect pipeline.
 *
 * Doc: 02_card_and_modifier_system.md §"EffectTransform"
 */
export type EffectTransform =
  | { op: 'modifyEffect';  match: EffectMatcher; set: EffectPatch }
  | { op: 'appendEffect';  effect: Effect }
  | { op: 'prependEffect'; effect: Effect }
  | { op: 'replaceEffect'; match: EffectMatcher; with: Effect }
  | { op: 'removeEffect';  match: EffectMatcher }
  | { op: 'wrapEffect';    match: EffectMatcher; before?: Effect; after?: Effect }
  | { op: 'modifyCost';    delta: number }
  | { op: 'addKeyword';    keyword: CardKeyword }
  | { op: 'removeKeyword'; keyword: CardKeyword };

/**
 * Modifier — a data-defined card upgrade.
 *
 * Most modifiers are pure data (transforms[]). Special-case modifiers
 * that can't be expressed declaratively get a `customHandlerId` and an
 * empty transforms[]; the handler is registered in code separately.
 *
 * Doc: 01_engine_primitives.md §2, 02_card_and_modifier_system.md
 */
export interface Modifier {
  readonly id: ModifierId;
  readonly name: string;
  readonly descriptionTemplate: string;
  readonly tags: readonly EffectTag[];
  readonly weight: number;
  readonly conflictsWith?: readonly ModifierId[];
  readonly requires?: readonly ModifierId[];
  readonly transforms: readonly EffectTransform[];
  readonly customHandlerId?: string;
}

/**
 * PoolCondition — gate on whether a pool entry is currently eligible.
 */
export type PoolCondition =
  | { kind: 'hasTag'; tag: EffectTag }
  | { kind: 'minLevel'; level: number }
  | { kind: 'custom'; predicateId: string };

export interface ModifierPoolEntry {
  readonly modifierId: ModifierId;
  readonly weight: number;
  readonly conditional?: PoolCondition;
}

export interface ModifierPool {
  readonly id: ModifierPoolId;
  readonly name: string;
  readonly entries: readonly ModifierPoolEntry[];
}
