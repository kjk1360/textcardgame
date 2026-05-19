import type {
  Actor,
  Effect,
  EnemyActor,
  PlayerActor,
  PlayerCombatState,
  StatusId,
  TargetKind,
} from '../../types/index.js';
import type { GameConstants } from '../constants.js';
import {
  applyBlockGain,
  applyDamage,
  applyHeal,
  applyTrueLoseHp,
  type DamageOutcome,
} from '../combat/damage.js';
import { draw } from '../combat/piles.js';
import { applyStatus, removeStatus, type StatusRegistry } from '../statuses/engine.js';
import type { IRandom } from '../rng.js';

/**
 * Effect executor — applies Effect[] from card play / status hooks /
 * skill hooks against combat state.
 *
 * Doc: 03_combat_system.md §"효과 실행"
 *
 * What's IN this slice (Phase 2.3.5):
 *   - Dispatcher + per-kind handlers for the "core" combat effects:
 *     damage, damageMultiHit, gainBlock, applyStatus, removeStatus,
 *     gainEnergy, loseEnergy, gainHp, loseHp, draw, gainGold, loseGold
 *   - Target resolution (self / enemy / allEnemies / randomEnemy / none)
 *   - Custom effect handler registry (for code-mode modifiers etc.)
 *   - Per-effect DamageOutcome accumulation
 *
 * What's DEFERRED to later slices:
 *   - awaitInput pause/resume for choose-type effects
 *     (discardChoose, exhaustChoose, etc.)
 *   - Hook firing (onCardPlayed / onDamageDealt / onDamageTaken / onKilled)
 *   - Meta-progression effects (gainCardToInventory, gainSkill, etc.)
 *   - addCardToPile / upgradeCardInDeck (need card registry coupling)
 *
 * Handlers throw on missing required context — defensive programming
 * against misuse from incorrect call sites.
 */

export type CustomEffectHandler = (
  params: Record<string, unknown> | undefined,
  ctx: ExecutionContext,
) => void;

export interface RunMutableState {
  /** Gold accumulated during this run (resets on character death). */
  gold: number;
}

export interface ExecutionContext {
  /** Who's playing the card / triggering the effect. Player or enemy. */
  source?: Actor;
  /** Player-picked single-target enemy (for `target: 'enemy'` effects). */
  target?: EnemyActor;
  /** All enemies in this combat (for allEnemies / randomEnemy). */
  enemies: EnemyActor[];
  /** The player actor (for `target: 'self'` when source is the player). */
  player: PlayerActor;
  /** Player's pile state (draw/discard/exhaust/hand). */
  piles: PlayerCombatState;
  /** Status definitions registry. */
  statuses: StatusRegistry;
  /** RNG seeded by combat. */
  rng: IRandom;
  /** Tunable game constants. */
  constants: GameConstants;
  /** Run-level mutable state (gold). */
  run: RunMutableState;
  /** Map of registered custom effect handlers by handlerId. */
  customHandlers?: ReadonlyMap<string, CustomEffectHandler>;
}

/**
 * Per-effect result emitted by the executor. Useful for the calling
 * layer to know what happened (animation, hook firing, log).
 */
export type EffectResult =
  | { kind: 'damage';      target: Actor; outcome: DamageOutcome }
  | { kind: 'gainBlock';   target: Actor; gained: number }
  | { kind: 'applyStatus'; target: Actor; statusId: StatusId; stacks: number }
  | { kind: 'removeStatus';target: Actor; statusId: StatusId; removed: boolean }
  | { kind: 'gainEnergy';  amount: number }
  | { kind: 'loseEnergy';  amount: number }
  | { kind: 'gainHp';      target: Actor; healed: number }
  | { kind: 'loseHp';      target: Actor; outcome: DamageOutcome }
  | { kind: 'draw';        count: number; reshuffled: boolean; overflowed: number }
  | { kind: 'gainGold';    amount: number }
  | { kind: 'loseGold';    amount: number }
  | { kind: 'custom';      handlerId: string }
  | { kind: 'noTarget';    effectKind: Effect['kind'] }   // resolved 0 targets
  | { kind: 'unimplemented'; effectKind: Effect['kind'] }; // not yet in this slice

/**
 * Execute a sequence of effects. Returns per-effect results in order.
 */
export function executeEffects(
  effects: ReadonlyArray<Effect>,
  ctx: ExecutionContext,
): EffectResult[] {
  const results: EffectResult[] = [];
  for (const eff of effects) {
    const subResults = executeEffect(eff, ctx);
    results.push(...subResults);
  }
  return results;
}

/**
 * Execute a single effect against context. May produce multiple results
 * when the effect resolves to multiple targets (e.g., allEnemies damage).
 */
export function executeEffect(effect: Effect, ctx: ExecutionContext): EffectResult[] {
  switch (effect.kind) {
    case 'damage': {
      const targets = resolveTargets(effect.target, ctx);
      if (targets.length === 0) return [{ kind: 'noTarget', effectKind: effect.kind }];
      return targets.map(t => ({
        kind: 'damage',
        target: t,
        outcome: applyDamage(ctx.source, t, effect.amount, ctx.statuses),
      } as EffectResult));
    }

    case 'damageMultiHit': {
      const targets = resolveTargets(effect.target, ctx);
      if (targets.length === 0) return [{ kind: 'noTarget', effectKind: effect.kind }];
      const out: EffectResult[] = [];
      for (const t of targets) {
        for (let h = 0; h < effect.hits; h++) {
          if (t.hp <= 0) break;       // stop hitting a dead target
          out.push({
            kind: 'damage',
            target: t,
            outcome: applyDamage(ctx.source, t, effect.amount, ctx.statuses),
          });
        }
      }
      return out;
    }

    case 'gainBlock': {
      // target field on gainBlock is 'self' | 'ally' | undefined
      // 'self' = the actor gaining block. If source is the player → player.
      // If source is an enemy → that enemy.
      const target = effect.target === 'ally'
        ? null  // not yet
        : (ctx.source ?? ctx.player);
      if (!target) return [{ kind: 'noTarget', effectKind: effect.kind }];
      const out = applyBlockGain(target, effect.amount, ctx.statuses);
      return [{ kind: 'gainBlock', target, gained: out.gained }];
    }

    case 'applyStatus': {
      const targets = resolveTargets(effect.target, ctx);
      if (targets.length === 0) return [{ kind: 'noTarget', effectKind: effect.kind }];
      return targets.map(t => {
        applyStatus(t, effect.status, effect.stacks, ctx.statuses);
        return {
          kind: 'applyStatus',
          target: t,
          statusId: effect.status,
          stacks: effect.stacks,
        } as EffectResult;
      });
    }

    case 'removeStatus': {
      const targets = resolveTargets(effect.target, ctx);
      if (targets.length === 0) return [{ kind: 'noTarget', effectKind: effect.kind }];
      return targets.map(t => ({
        kind: 'removeStatus',
        target: t,
        statusId: effect.status,
        removed: removeStatus(t, effect.status),
      } as EffectResult));
    }

    case 'gainEnergy': {
      ctx.player.energy += effect.amount;
      return [{ kind: 'gainEnergy', amount: effect.amount }];
    }

    case 'loseEnergy': {
      const lost = Math.min(effect.amount, ctx.player.energy);
      ctx.player.energy = Math.max(0, ctx.player.energy - effect.amount);
      return [{ kind: 'loseEnergy', amount: lost }];
    }

    case 'gainHp': {
      const target = ctx.source ?? ctx.player;
      const healed = applyHeal(target, effect.amount);
      return [{ kind: 'gainHp', target, healed }];
    }

    case 'loseHp': {
      const target = ctx.source ?? ctx.player;
      const outcome = applyTrueLoseHp(target, effect.amount, {
        ignoreBlock: effect.ignoreBlock,
      });
      return [{ kind: 'loseHp', target, outcome }];
    }

    case 'draw': {
      const r = draw(ctx.piles, effect.count, ctx.rng, ctx.constants.hand.hardLimit);
      return [{
        kind: 'draw',
        count: r.drawn.length,
        reshuffled: r.reshuffled,
        overflowed: r.overflowed.length,
      }];
    }

    case 'gainGold': {
      ctx.run.gold += effect.amount;
      return [{ kind: 'gainGold', amount: effect.amount }];
    }

    case 'loseGold': {
      const lost = Math.min(effect.amount, ctx.run.gold);
      ctx.run.gold = Math.max(0, ctx.run.gold - effect.amount);
      return [{ kind: 'loseGold', amount: lost }];
    }

    case 'custom': {
      const fn = ctx.customHandlers?.get(effect.handlerId);
      if (!fn) {
        throw new Error(`Custom effect handler not registered: ${effect.handlerId}`);
      }
      fn(effect.params, ctx);
      return [{ kind: 'custom', handlerId: effect.handlerId }];
    }

    // ---- Deferred to later slices ----
    case 'discardRandom':
    case 'discardChoose':
    case 'exhaustChoose':
    case 'addCardToPile':
    case 'upgradeCardInDeck':
    case 'gainCardToInventory':
    case 'gainSkill':
    case 'gainGoldMeta':
      return [{ kind: 'unimplemented', effectKind: effect.kind }];
  }
}

// ====================================================================
// Internals
// ====================================================================

/**
 * Resolve targets symmetrically based on `ctx.source`:
 *   - When source is the PLAYER: 'enemy' = ctx.target (picked from enemies),
 *     'allEnemies' = all alive enemies, 'randomEnemy' = random alive enemy.
 *   - When source is an ENEMY: 'enemy' = the player, 'allEnemies' = [player],
 *     'randomEnemy' = the player (only opponent).
 *   - 'self' = source.
 *   - 'ally' = not yet implemented (returns []).
 *   - 'none' / undefined = [].
 */
function resolveTargets(
  targetKind: TargetKind | undefined,
  ctx: ExecutionContext,
): Actor[] {
  const src = ctx.source;
  switch (targetKind) {
    case 'self':
      if (!src) throw new Error("Effect target 'self' requires ExecutionContext.source");
      return [src];
    case 'enemy': {
      if (src?.kind === 'enemy') {
        // From enemy POV the "enemy" is the player.
        return ctx.player.hp > 0 ? [ctx.player] : [];
      }
      if (!ctx.target) return [];
      if (ctx.target.hp <= 0) return [];
      return [ctx.target];
    }
    case 'allEnemies': {
      if (src?.kind === 'enemy') {
        return ctx.player.hp > 0 ? [ctx.player] : [];
      }
      return ctx.enemies.filter(e => e.hp > 0);
    }
    case 'randomEnemy': {
      const opponents: Actor[] =
        src?.kind === 'enemy'
          ? (ctx.player.hp > 0 ? [ctx.player] : [])
          : ctx.enemies.filter(e => e.hp > 0);
      if (opponents.length === 0) return [];
      return [ctx.rng.pick(opponents)];
    }
    case 'ally':
      return [];
    case 'none':
    case undefined:
      return [];
  }
}
