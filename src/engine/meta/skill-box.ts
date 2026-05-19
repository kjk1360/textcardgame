import type { SkillId } from '../../types/index.js';
import type { IRandom } from '../rng.js';
import type { MetaState } from './inventory.js';

/**
 * Skill box system — meta gold → random skill from a grade-specific
 * pool. Used in the initial start phase before entering a new dungeon.
 *
 * Doc: 06_meta_progression.md §"스킬 박스 (Skill Box)"
 *
 * Grades are ordered from cheapest to most expensive, with each grade
 * pulling from its own pool of skills.
 */

export type SkillGrade = 'lowest' | 'low' | 'mid' | 'high' | 'highest';

export interface SkillBoxDefinition {
  readonly grade: SkillGrade;
  readonly priceGold: number;
  readonly entries: ReadonlyArray<SkillBoxEntry>;
}

export interface SkillBoxEntry {
  readonly skillId: SkillId;
  readonly weight: number;
}

export interface SkillBoxRegistry {
  /** Returns the box definition for a grade, or undefined if not configured. */
  get(grade: SkillGrade): SkillBoxDefinition | undefined;
  /** All configured grades, in any order. */
  all(): ReadonlyArray<SkillBoxDefinition>;
}

// ====================================================================
// Affordability + purchase
// ====================================================================

/**
 * Grades the player has enough gold to afford right now. Used by the
 * Start Phase UI to gate which options appear / are enabled.
 */
export function affordableGrades(
  meta: MetaState,
  registry: SkillBoxRegistry,
): SkillGrade[] {
  return registry.all()
    .filter(b => b.priceGold <= meta.gold)
    .map(b => b.grade);
}

/**
 * Cheapest affordable grade, or null if none.
 */
export function cheapestAffordableGrade(
  meta: MetaState,
  registry: SkillBoxRegistry,
): SkillGrade | null {
  const aff = registry.all().filter(b => b.priceGold <= meta.gold);
  if (aff.length === 0) return null;
  aff.sort((a, b) => a.priceGold - b.priceGold);
  return aff[0]!.grade;
}

export type PurchaseResult =
  | { ok: true; grade: SkillGrade; skillId: SkillId; goldSpent: number }
  | { ok: false; reason: 'unknown-grade' }
  | { ok: false; reason: 'insufficient-gold'; needed: number; have: number }
  | { ok: false; reason: 'empty-pool' };

/**
 * Buy a skill box of `grade`: deducts gold, samples a skill from the
 * box's pool (weighted), returns the picked skillId.
 *
 * Mutates meta.gold. Does NOT add the skill to any character — caller
 * is responsible for that (different sites add to slot character or
 * to in-progress run).
 */
export function purchaseSkillBox(
  meta: MetaState,
  grade: SkillGrade,
  registry: SkillBoxRegistry,
  rng: IRandom,
): PurchaseResult {
  const def = registry.get(grade);
  if (!def) return { ok: false, reason: 'unknown-grade' };
  if (meta.gold < def.priceGold) {
    return { ok: false, reason: 'insufficient-gold', needed: def.priceGold, have: meta.gold };
  }
  if (def.entries.length === 0) {
    return { ok: false, reason: 'empty-pool' };
  }
  const skillId = weightedSample(def.entries, rng);
  meta.gold -= def.priceGold;
  return { ok: true, grade, skillId, goldSpent: def.priceGold };
}

// ====================================================================
// Internals
// ====================================================================

function weightedSample(entries: ReadonlyArray<SkillBoxEntry>, rng: IRandom): SkillId {
  const total = entries.reduce((s, e) => s + e.weight, 0);
  if (total <= 0) return entries[0]!.skillId; // defensive
  let r = rng.float() * total;
  for (const e of entries) {
    r -= e.weight;
    if (r <= 0) return e.skillId;
  }
  return entries[entries.length - 1]!.skillId;
}

// ====================================================================
// Convenience: array-backed registry for tests + simple deployments
// ====================================================================

export function makeSkillBoxRegistry(
  boxes: ReadonlyArray<SkillBoxDefinition>,
): SkillBoxRegistry {
  const map = new Map<SkillGrade, SkillBoxDefinition>();
  for (const b of boxes) map.set(b.grade, b);
  return {
    get: g => map.get(g),
    all: () => [...map.values()],
  };
}
