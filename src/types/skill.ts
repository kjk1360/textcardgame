import type { ConditionExpr } from './condition.js';
import type { Effect } from './effect.js';
import type { EffectTag, SkillId } from './ids.js';

/**
 * Skill — character-bound (or globally passive) hook bundle.
 *
 * Doc: 01_engine_primitives.md §6
 *
 * Skills are SkillDefinitions (registry data) referenced by id from
 * either:
 *   - SlotCharacter.skillIds (current-character skills, lost on death)
 *   - GlobalState.passiveSkills (永久 — applied to every character)
 *
 * The engine treats both sources identically when firing hooks; the
 * difference is purely persistence-time.
 */

export type SkillGrade = 'lowest' | 'low' | 'mid' | 'high' | 'highest';

/** Game events that skill hooks can listen to. Superset of status events. */
export type GameEventName =
  | 'onRunStart'
  | 'onRunEnd'
  | 'onCombatStart'
  | 'onCombatEnd'
  | 'onTurnStart'
  | 'onTurnEnd'
  | 'onCardPlayed'
  | 'onCardDrawn'
  | 'onCardDiscarded'
  | 'onCardExhausted'
  | 'onDamageDealtByPlayer'
  | 'onDamageTakenByPlayer'
  | 'onEnemyKilled'
  | 'onNodeEntered'
  | 'onNodeCleared'
  | 'onRestEntered';

export interface SkillHook {
  readonly on: GameEventName;
  readonly effects: ReadonlyArray<Effect>;
  readonly condition?: ConditionExpr;
}

export interface SkillDefinition {
  readonly id: SkillId;
  readonly name: string;
  readonly description: string;
  readonly grade: SkillGrade;
  readonly tags: ReadonlyArray<EffectTag>;
  readonly hooks: ReadonlyArray<SkillHook>;
  /**
   * Whether this skill can be selected as a permanent passive when the
   * final boss is defeated. Set to false for balance-breaking skills.
   */
  readonly passiveEligible: boolean;
  /**
   * If true, multiple copies of this skill stack. If false, second
   * application is a no-op (already had it).
   */
  readonly stackable?: boolean;
}

/**
 * SkillInstance — a skill bound to a character at runtime.
 * Most skills are stateless (just reference the def). Some maintain
 * counters (e.g., "every 3rd turn: +1 draw") via `state`.
 */
export interface SkillInstance {
  readonly id: SkillId;
  readonly acquired: {
    readonly kind: 'starter' | 'event' | 'shop' | 'reward' | 'box' | 'passive';
    readonly contextId?: string;
  };
  /** Per-instance counters / flags for stateful skills. */
  state?: Record<string, number>;
}
