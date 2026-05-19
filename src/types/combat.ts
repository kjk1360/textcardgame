import type { CardInstance } from './card.js';
import type { StatusId } from './ids.js';

/**
 * Player-side pile state during a combat encounter.
 *
 * Pile conventions:
 *   - `drawPile[length-1]` is the TOP of the deck (next to draw).
 *     Implemented via .push()/.pop().
 *   - `discardPile[length-1]` is the most recently discarded.
 *   - `exhaustPile[length-1]` is the most recently exhausted.
 *
 * Cards move between piles via the helpers in `src/engine/combat/piles.ts`.
 * Direct mutation outside those helpers is a bug — order/cap invariants
 * can break.
 */
export interface PlayerCombatState {
  hand: CardInstance[];
  drawPile: CardInstance[];
  discardPile: CardInstance[];
  exhaustPile: CardInstance[];
}

/**
 * StatusInstance — a stack of a status effect bound to an actor.
 *
 * `stacks` is the canonical magnitude. `duration` is used for 'duration'
 * stacking-rule statuses (e.g., "약화 N턴") where stacks count remaining
 * turns rather than potency.
 */
export interface StatusInstance {
  readonly id: StatusId;
  stacks: number;
  duration?: number;
}
