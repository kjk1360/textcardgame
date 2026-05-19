import type { CardDefId, EffectTag, ModifierId, SkillId, StatusId } from './ids.js';

/**
 * Target string (flat). Used inside Effect.
 * The structured TargetSpec (in card.ts) is for CardDefinition.target.
 */
export type TargetKind =
  | 'none'
  | 'self'
  | 'enemy'
  | 'allEnemies'
  | 'randomEnemy'
  | 'ally';

/**
 * Pile location (for card manipulation effects).
 */
export type PileLocation = 'hand' | 'draw' | 'discard' | 'exhaust';

/**
 * Effect — the atomic unit of game state change.
 *
 * Discriminated union by `kind`. Adding a new effect kind:
 *   1. Add a new member here
 *   2. Add a handler in src/engine/effects/handlers/*
 *   3. Register it in the EffectExecutor at startup
 *
 * Doc: 01_engine_primitives.md §3, 03_combat_system.md
 */
export type Effect =
  // Damage / defense
  | { kind: 'damage'; amount: number; target: TargetKind; tags?: readonly EffectTag[] }
  | { kind: 'damageMultiHit'; amount: number; hits: number; target: TargetKind }
  | { kind: 'gainBlock'; amount: number; target?: 'self' | 'ally' }
  // Status
  | { kind: 'applyStatus'; status: StatusId; stacks: number; target: TargetKind }
  | { kind: 'removeStatus'; status: StatusId; target: TargetKind }
  // Resource
  | { kind: 'gainEnergy'; amount: number }
  | { kind: 'loseEnergy'; amount: number }
  | { kind: 'gainGold'; amount: number }
  | { kind: 'loseGold'; amount: number }
  | { kind: 'gainHp'; amount: number }
  | { kind: 'loseHp'; amount: number; ignoreBlock?: boolean }
  // Cards
  | { kind: 'draw'; count: number }
  | { kind: 'discardRandom'; count: number }
  | { kind: 'discardChoose'; count: number }
  | { kind: 'exhaustChoose'; count: number; from: PileLocation }
  | { kind: 'addCardToPile'; cardDefId: CardDefId; pile: PileLocation; copies?: number }
  | { kind: 'upgradeCardInDeck'; choose: boolean; tag?: EffectTag }
  // Meta (events only)
  | { kind: 'gainCardToInventory'; cardDefId: CardDefId; modifierIds?: readonly ModifierId[] }
  | { kind: 'gainSkill'; skillId: SkillId }
  | { kind: 'gainGoldMeta'; amount: number }
  // Escape hatch
  | { kind: 'custom'; handlerId: string; params?: Record<string, unknown> };

/** Convenience: the list of kinds, useful for exhaustive switches. */
export type EffectKind = Effect['kind'];
