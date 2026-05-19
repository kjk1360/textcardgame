import type { CardInstance } from './card.js';
import type { EnemyId, StatusId } from './ids.js';

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
 * `stacks` is the canonical magnitude. For "N turns" statuses (vulnerable
 * etc.), stacks doubles as the duration counter — `decay: fixedPerTurn`
 * reduces it each turn end.
 */
export interface StatusInstance {
  readonly id: StatusId;
  stacks: number;
}

/**
 * Actor — anything that can take damage, hold block, and carry statuses.
 *
 * Both the player and enemies are actors. The status engine and damage
 * pipeline are generic over this shape.
 *
 * `kind` discriminator is provided so engine code can branch on
 * player-only state (energy, deck) vs enemy-only state (intent).
 */
export interface ActorBase {
  hp: number;
  maxHp: number;
  block: number;
  statuses: StatusInstance[];
}

export interface PlayerActor extends ActorBase {
  readonly kind: 'player';
  energy: number;
  maxEnergy: number;
  /** Cards-in-piles live in PlayerCombatState alongside, not in the actor. */
}

export interface EnemyActor extends ActorBase {
  readonly kind: 'enemy';
  readonly instanceId: string;
  readonly defId: EnemyId;
  /** Intent state to be detailed when enemy AI is implemented. */
}

export type Actor = PlayerActor | EnemyActor;
