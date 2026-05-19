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
  /**
   * Currently telegraphed intent for the upcoming enemy turn.
   * Computed by intent system; consumed when the enemy acts.
   */
  intent?: Intent;
  /** Cursor for 'cycle' intent scripts. Treated as 0 when undefined. */
  intentCursor?: number;
  /** Last intent id (for 'scripted' chains). */
  lastIntentId?: string;
}

/**
 * Intent — what an enemy plans to do on its next turn.
 * Has display metadata (UI shows "attack 12 ×2") and the actual effects
 * to run when the intent fires.
 */
export interface Intent {
  readonly id: string;
  readonly display: IntentDisplay;
  readonly effects: ReadonlyArray<import('./effect.js').Effect>;
  /** Optional weight for 'weighted' scripts. */
  readonly weight?: number;
  /** For 'scripted' scripts: next intent id after this one fires. */
  readonly nextIntentId?: string;
}

export interface IntentDisplay {
  readonly kind: 'attack' | 'defend' | 'buff' | 'debuff' | 'unknown';
  /** Headline number (e.g., attack 12). */
  readonly value?: number;
  /** Multi-hit indicator (e.g., ×3). */
  readonly hits?: number;
}

/**
 * IntentScript — how the enemy decides its next intent.
 *
 * - 'cycle': iterate through `intents[]` in order, wrapping at end.
 * - 'weighted': uniform random pick by intent.weight per turn.
 * - 'scripted': follow intent.nextIntentId chain explicitly.
 */
export interface IntentScript {
  readonly mode: 'cycle' | 'weighted' | 'scripted';
  readonly intents: ReadonlyArray<Intent>;
}

export type Actor = PlayerActor | EnemyActor;
