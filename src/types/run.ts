import type { CardInstance } from './card.js';
import type { EventId, SkillId } from './ids.js';

/**
 * Minimal read-only views of run / global state.
 *
 * These are the contracts that engine subsystems (ConditionEvaluator,
 * sampling, etc.) depend on. The full RunState / GlobalState (which can
 * mutate) will be defined later in 01_engine_primitives.md §10 terms.
 *
 * Producing a snapshot from a full state is a cheap projection at
 * call sites — keeps consumers decoupled from the mutable shapes.
 */

export interface PlayerSnapshot {
  readonly hp: number;
  readonly maxHp: number;
  readonly gold: number;
  /** Whole-run deck (drawPile + hand + discardPile + exhaustPile). */
  readonly deck: ReadonlyArray<CardInstance>;
  readonly skillIds: ReadonlyArray<SkillId>;
}

export interface RunSnapshot {
  readonly difficultyLevel: number;
  readonly player: PlayerSnapshot;
}

export interface InventorySnapshot {
  readonly cards: ReadonlyArray<CardInstance>;
}

export interface GlobalSnapshot {
  readonly gold: number;
  readonly inventory: InventorySnapshot;
  readonly passiveSkills: ReadonlyArray<SkillId>;
  readonly eventsCleared: ReadonlySet<EventId>;
}
