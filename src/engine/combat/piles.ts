import type { CardInstance, CardInstanceId, PlayerCombatState } from '../../types/index.js';
import type { IRandom } from '../rng.js';

/**
 * Pile management — the rules for moving cards between hand / draw /
 * discard / exhaust during combat. Pure with respect to RNG (all
 * randomness flows through the passed IRandom).
 *
 * Doc: 03_combat_system.md §"드로우 알고리즘"
 *
 * Functions mutate the passed PlayerCombatState in place. This matches
 * the engine's overall reducer pattern (state lives in a single mutable
 * holder; controlled operations bring it through legal transitions).
 */

export interface DrawResult {
  readonly drawn: CardInstance[];
  readonly reshuffled: boolean;
  /**
   * Cards that would have entered the hand but were sent straight to
   * discard because the hand was already at the hard cap. Should be
   * empty in normal play (designs target hardLimit=14 as never-trip).
   */
  readonly overflowed: CardInstance[];
}

/**
 * Draw N cards into hand.
 *
 * - Pops from top of drawPile (end of array).
 * - When drawPile is exhausted and discardPile has cards, the discard
 *   is shuffled into the drawPile and drawing continues.
 * - When both are empty, drawing stops short.
 * - Cards that would push hand beyond `handHardLimit` are routed to
 *   discardPile instead. They count toward the draw attempt (don't
 *   continue trying more).
 */
export function draw(
  state: PlayerCombatState,
  n: number,
  rng: IRandom,
  handHardLimit: number,
): DrawResult {
  const drawn: CardInstance[] = [];
  const overflowed: CardInstance[] = [];
  let reshuffled = false;

  for (let i = 0; i < n; i++) {
    if (state.drawPile.length === 0) {
      if (state.discardPile.length === 0) break;
      reshuffleDiscardIntoDraw(state, rng);
      reshuffled = true;
    }
    const card = state.drawPile.pop()!;
    if (state.hand.length >= handHardLimit) {
      state.discardPile.push(card);
      overflowed.push(card);
    } else {
      state.hand.push(card);
      drawn.push(card);
    }
  }

  return { drawn, reshuffled, overflowed };
}

/**
 * Move all of discardPile into drawPile, shuffled, then clear discard.
 * Used both for natural reshuffles (draw empties drawPile) and for
 * effects that explicitly reshuffle (e.g., a rare card "shuffle deck").
 */
export function reshuffleDiscardIntoDraw(
  state: PlayerCombatState,
  rng: IRandom,
): void {
  if (state.discardPile.length === 0) return;
  const shuffled = rng.shuffle(state.discardPile);
  // We push the shuffled discard onto whatever remains in drawPile.
  // Existing draw cards (if any) stay on top and are drawn first.
  state.drawPile.unshift(...shuffled);
  state.discardPile.length = 0;
}

export function addToDiscard(state: PlayerCombatState, card: CardInstance): void {
  state.discardPile.push(card);
}

export function addToExhaust(state: PlayerCombatState, card: CardInstance): void {
  state.exhaustPile.push(card);
}

export type DrawPilePosition = 'top' | 'bottom' | 'random';

/**
 * Add a card to drawPile at a specific position.
 *
 * - 'top'    → next to be drawn (push to end of array)
 * - 'bottom' → drawn last (unshift to start)
 * - 'random' → uniformly random index
 */
export function addToDraw(
  state: PlayerCombatState,
  card: CardInstance,
  position: DrawPilePosition,
  rng: IRandom,
): void {
  switch (position) {
    case 'top':
      state.drawPile.push(card);
      return;
    case 'bottom':
      state.drawPile.unshift(card);
      return;
    case 'random': {
      const idx = rng.intBetween(0, state.drawPile.length);
      state.drawPile.splice(idx, 0, card);
      return;
    }
  }
}

/**
 * Adds a card directly into hand (subject to hard cap).
 * Returns true if it fit, false if it overflowed (and was discarded).
 */
export function addToHand(
  state: PlayerCombatState,
  card: CardInstance,
  handHardLimit: number,
): boolean {
  if (state.hand.length >= handHardLimit) {
    state.discardPile.push(card);
    return false;
  }
  state.hand.push(card);
  return true;
}

/**
 * Remove a specific card from hand. Returns the removed card or undefined.
 * Used by playCard, discardChoose, etc.
 */
export function removeFromHand(
  state: PlayerCombatState,
  instanceId: CardInstanceId,
): CardInstance | undefined {
  const idx = state.hand.findIndex(c => c.instanceId === instanceId);
  if (idx < 0) return undefined;
  return state.hand.splice(idx, 1)[0];
}

/**
 * Discard all of hand (used at end of turn for non-retain cards).
 * Caller is responsible for filtering out retain cards FIRST.
 */
export function discardHand(state: PlayerCombatState): CardInstance[] {
  const discarded = state.hand.splice(0, state.hand.length);
  state.discardPile.push(...discarded);
  return discarded;
}

/**
 * Total cards across all four piles. Useful for invariants
 * (total cards in deck shouldn't change without explicit add/remove).
 */
export function totalDeckSize(state: PlayerCombatState): number {
  return (
    state.hand.length +
    state.drawPile.length +
    state.discardPile.length +
    state.exhaustPile.length
  );
}

/**
 * Initialize a combat from the player's full deck.
 *
 * Empties all piles, places all deck cards into drawPile, shuffles.
 * Caller then draws the opening hand separately (e.g., draw(state, 4, rng, cap)).
 */
export function initFromDeck(
  state: PlayerCombatState,
  deck: ReadonlyArray<CardInstance>,
  rng: IRandom,
): void {
  state.hand.length = 0;
  state.drawPile.length = 0;
  state.discardPile.length = 0;
  state.exhaustPile.length = 0;
  state.drawPile.push(...rng.shuffle(deck));
}
