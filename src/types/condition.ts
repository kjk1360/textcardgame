import type { CardDefId, EffectTag, EventId, SkillId } from './ids.js';

/**
 * ConditionExpr — universal condition language.
 *
 * Used by: ChoiceOption.condition, BranchStep, StatusHook.condition,
 * SkillHook.condition, PoolCondition (custom subset), etc.
 *
 * Doc: 01_engine_primitives.md §8
 */
export type ConditionExpr =
  | { kind: 'always' }
  | { kind: 'never' }
  | { kind: 'and'; of: readonly ConditionExpr[] }
  | { kind: 'or';  of: readonly ConditionExpr[] }
  | { kind: 'not'; of: ConditionExpr }
  | { kind: 'hasGold';            min?: number; max?: number }
  | { kind: 'hasGoldMeta';        min?: number }
  | { kind: 'hasCardInDeck';      defId?: CardDefId; tag?: EffectTag; min?: number }
  | { kind: 'hasCardInInventory'; defId?: CardDefId; tag?: EffectTag; min?: number }
  | { kind: 'hasSkill';           skillId: SkillId }
  | { kind: 'hasPassive';         skillId: SkillId }
  | { kind: 'hpPercent';          min?: number; max?: number }
  | { kind: 'difficultyAtLeast';  level: number }
  | { kind: 'eventCleared';       eventId: EventId }
  | { kind: 'eventNotCleared';    eventId: EventId }
  | { kind: 'random';             chance: number }
  | { kind: 'custom';             predicateId: string; params?: Record<string, unknown> };
