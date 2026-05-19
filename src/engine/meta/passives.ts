import type { SkillDefinition, SkillId } from '../../types/index.js';
import type { SkillRegistry } from '../skills/engine.js';
import type { MetaState } from './inventory.js';

/**
 * Passive skill management — promote / list / query the global
 * passive-skill pool that all characters share.
 *
 * Doc: 06_meta_progression.md §"패시브 스킬 (Passive Skill)"
 *
 * GlobalState.passiveSkills is the source of truth. This module is
 * the small API surface for mutating + querying it under invariants.
 */

export interface PassiveStateHolder {
  /** Holds the GlobalState.passiveSkills array (mutable). */
  passiveSkills: SkillId[];
}

export type PromotionResult =
  | { ok: true; skillId: SkillId }
  | { ok: false; reason: 'already-passive' | 'not-eligible' | 'unknown-skill' };

/**
 * Promote a skill to permanent passive status. Returns the new state
 * + a result discriminator.
 *
 * Called when the player defeats the final boss and selects which of
 * their character's skills to make永久 across all future characters.
 */
export function promoteToPassive(
  state: PassiveStateHolder,
  skillId: SkillId,
  registry: SkillRegistry,
): PromotionResult {
  if (!registry.has(skillId)) return { ok: false, reason: 'unknown-skill' };
  const def = registry.get(skillId);
  if (!def.passiveEligible) return { ok: false, reason: 'not-eligible' };
  if (state.passiveSkills.includes(skillId)) return { ok: false, reason: 'already-passive' };
  state.passiveSkills.push(skillId);
  return { ok: true, skillId };
}

/**
 * The skills on a slot's character that are CANDIDATES for promotion
 * (passive-eligible, not yet a passive).
 *
 * UI shows these as the post-final-boss reward choices.
 */
export function eligibleForPromotion(
  characterSkillIds: ReadonlyArray<SkillId>,
  state: PassiveStateHolder,
  registry: SkillRegistry,
): SkillDefinition[] {
  const out: SkillDefinition[] = [];
  for (const id of characterSkillIds) {
    if (state.passiveSkills.includes(id)) continue;
    if (!registry.has(id)) continue;
    const def = registry.get(id);
    if (!def.passiveEligible) continue;
    out.push(def);
  }
  return out;
}

/**
 * True when the player has no skills eligible for promotion at final
 * boss kill — caller substitutes a fallback reward (e.g., bonus gold).
 */
export function noEligiblePromotion(
  characterSkillIds: ReadonlyArray<SkillId>,
  state: PassiveStateHolder,
  registry: SkillRegistry,
): boolean {
  return eligibleForPromotion(characterSkillIds, state, registry).length === 0;
}

/**
 * Convenience wrapper using MetaState (the most common shape passed
 * around at rest hub / start phase).
 */
export function promoteToPassiveFromMeta(
  meta: MetaState & PassiveStateHolder,
  skillId: SkillId,
  registry: SkillRegistry,
): PromotionResult {
  return promoteToPassive(meta, skillId, registry);
}
