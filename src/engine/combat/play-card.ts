import type {
  CardDefId,
  CardDefinition,
  CardInstance,
  CardInstanceId,
  EnemyActor,
  ResolvedCard,
} from '../../types/index.js';
import { resolveCardEffects, type ModifierLookup } from '../modifiers/resolver.js';
import { addToDiscard, addToExhaust, removeFromHand } from './piles.js';
import {
  executeEffects,
  type EffectResult,
  type ExecutionContext,
} from '../effects/executor.js';

/**
 * Card Play Integration — the vertical slice that ties together:
 *   modifier resolver → cost check → target check → effect execution →
 *   pile placement (discard / exhaust based on resolved keywords).
 *
 * Doc: 03_combat_system.md §"카드 사용 흐름"
 *
 * Failure modes throw — UI layer is responsible for preventing illegal
 * plays (no-energy, no-target). The errors are belt-and-suspenders for
 * mis-routed actions.
 *
 * This slice does NOT handle:
 *   - Mid-effect awaitInput (discardChoose etc. return 'unimplemented')
 *   - Hook firing (onCardPlayed) — wired in turn-flow slice
 *   - Card preview / cost-check API for UI gating (separate helper)
 */

export interface CardRegistryLookup {
  get(id: CardDefId): CardDefinition;
}

export interface PlayCardOptions {
  /** Player-picked target enemy (required when resolved card target is 'enemy'). */
  target?: EnemyActor;
}

export type PlayCardOutcome =
  | {
      kind: 'played';
      resolved: ResolvedCard;
      energySpent: number;
      destination: 'discard' | 'exhaust';
      results: EffectResult[];
    }
  | {
      kind: 'rejected';
      reason: 'not-in-hand' | 'insufficient-energy' | 'missing-target' | 'unplayable';
      details?: string;
    };

/**
 * Attempt to play a card from the player's hand.
 * Mutates ctx.player, ctx.piles, ctx.enemies, ctx.run as effects fire.
 */
export function playCard(
  cardInstanceId: CardInstanceId,
  ctx: ExecutionContext,
  cards: CardRegistryLookup,
  modifiers: ModifierLookup,
  opts?: PlayCardOptions,
): PlayCardOutcome {
  // 1. Find card in hand
  const card = ctx.piles.hand.find(c => c.instanceId === cardInstanceId);
  if (!card) return { kind: 'rejected', reason: 'not-in-hand' };

  const def = cards.get(card.defId);
  const resolved = resolveCardEffects(def, card, modifiers);

  // 2. Cost check
  if (resolved.cost.kind === 'unplayable') {
    return { kind: 'rejected', reason: 'unplayable' };
  }
  const costValue = resolved.cost.kind === 'fixed' ? resolved.cost.value : 0;
  if (resolved.cost.kind === 'fixed' && ctx.player.energy < costValue) {
    return {
      kind: 'rejected',
      reason: 'insufficient-energy',
      details: `need ${costValue}, have ${ctx.player.energy}`,
    };
  }
  // 'x' cost spends all available energy (handled later — for now use 0 as base)

  // 3. Target check (only enemy-target cards require a picked target)
  if (resolved.target.kind === 'enemy' && !opts?.target) {
    return { kind: 'rejected', reason: 'missing-target' };
  }

  // 4. Spend energy
  let energySpent = 0;
  if (resolved.cost.kind === 'fixed') {
    ctx.player.energy -= costValue;
    energySpent = costValue;
  } else if (resolved.cost.kind === 'x') {
    energySpent = ctx.player.energy;
    ctx.player.energy = 0;
    // X-cost effects: stack the spent energy into damage / hits / etc.
    // Not implemented in this slice — needs effect parameterization.
  }

  // 5. Remove from hand (cards are in transit while effects fire)
  removeFromHand(ctx.piles, cardInstanceId);

  // 6. Execute effects with the resolved (modifier-applied) list
  //    Build a per-play context view: source = player, target = picked enemy
  const playCtx: ExecutionContext = {
    ...ctx,
    source: ctx.player,
    target: opts?.target,
  };
  const results = executeEffects(resolved.effects, playCtx);

  // 7. Place card in destination pile
  const destination: 'discard' | 'exhaust' = resolved.keywords.includes('exhaust')
    ? 'exhaust'
    : 'discard';
  if (destination === 'exhaust') addToExhaust(ctx.piles, card);
  else                            addToDiscard(ctx.piles, card);

  return {
    kind: 'played',
    resolved,
    energySpent,
    destination,
    results,
  };
}

/**
 * Convenience: can the card be played right now? Used by UI to gray out
 * unplayable cards without actually attempting.
 */
export function canPlayCard(
  cardInstanceId: CardInstanceId,
  ctx: ExecutionContext,
  cards: CardRegistryLookup,
  modifiers: ModifierLookup,
  opts?: PlayCardOptions,
): { ok: true; resolved: ResolvedCard } | { ok: false; reason: string } {
  const card = ctx.piles.hand.find(c => c.instanceId === cardInstanceId);
  if (!card) return { ok: false, reason: 'not-in-hand' };
  const def = cards.get(card.defId);
  const resolved = resolveCardEffects(def, card, modifiers);
  if (resolved.cost.kind === 'unplayable') return { ok: false, reason: 'unplayable' };
  if (resolved.cost.kind === 'fixed' && ctx.player.energy < resolved.cost.value) {
    return { ok: false, reason: 'insufficient-energy' };
  }
  if (resolved.target.kind === 'enemy' && !opts?.target) {
    return { ok: false, reason: 'missing-target' };
  }
  return { ok: true, resolved };
}
