import type {
  Actor,
  EnemyActor,
  Intent,
  IntentScript,
  PlayerActor,
  PlayerCombatState,
  StatusEventName,
} from '../../types/index.js';
import type { GameConstants } from '../constants.js';
import type { IRandom } from '../rng.js';
import { initFromDeck, draw, discardHand } from './piles.js';
import {
  collectHooks,
  decayAtTurnEnd,
  reduceStatusStacks,
  type StatusRegistry,
} from '../statuses/engine.js';
import { executeEffects, type CustomEffectHandler, type ExecutionContext } from '../effects/executor.js';

/**
 * Turn flow — orchestrates a combat encounter from start to end.
 *
 * Responsibilities:
 *   - Combat init: shuffle deck → draw opening hand → energy reset
 *   - startPlayerTurn: energy reset, draw, fire onOwnerTurnStart hooks,
 *     reset player.block (slay-the-spire-style: block expires)
 *   - endPlayerTurn: discard non-retain hand, fire onOwnerTurnEnd hooks,
 *     decay statuses
 *   - runEnemyTurn: each enemy acts on its intent, then picks next
 *   - isCombatOver: win/loss/in-progress
 *
 * Doc: 03_combat_system.md §"턴 흐름"
 *
 * Card retention: this slice does NOT honor 'retain' keyword yet
 * (rare keyword, no cards in the test fixtures use it). When retain is
 * implemented, the hand-discard step must filter out retain cards.
 */

export interface TurnFlowContext {
  player: PlayerActor;
  enemies: EnemyActor[];
  piles: PlayerCombatState;
  statuses: StatusRegistry;
  rng: IRandom;
  constants: GameConstants;
  run: { gold: number };
  /**
   * Custom effect handlers (poison/bleed tick, etc.). Forwarded to the
   * executor when status hooks fire, so { kind: 'custom' } effects in
   * status hooks resolve correctly.
   */
  customHandlers?: ReadonlyMap<string, CustomEffectHandler>;
}

export type CombatOutcome = 'inProgress' | 'won' | 'lost';

/**
 * Start a combat: initialize piles from the player's full deck, reset
 * combat-only state, set initial intents, draw opening hand.
 *
 * `intentScripts` maps enemy.instanceId → its IntentScript.
 * (Will move to a registry once EnemyDefinition is wired in a later slice.)
 */
export function startCombat(
  tfCtx: TurnFlowContext,
  deck: ReadonlyArray<import('../../types/index.js').CardInstance>,
  intentScripts: ReadonlyMap<string, IntentScript>,
): void {
  initFromDeck(tfCtx.piles, deck, tfCtx.rng);

  tfCtx.player.energy = tfCtx.constants.energy.base;
  tfCtx.player.block = 0;

  // Set initial intent for each enemy
  for (const enemy of tfCtx.enemies) {
    enemy.intentCursor = 0;
    enemy.block = 0;
    const script = intentScripts.get(enemy.instanceId);
    if (script) enemy.intent = decideNextIntent(enemy, script, tfCtx.rng);
  }

  // Opening hand
  draw(
    tfCtx.piles,
    tfCtx.constants.draw.perTurn + tfCtx.constants.draw.firstTurnAdditional,
    tfCtx.rng,
    tfCtx.constants.hand.hardLimit,
  );
}

/**
 * Player turn start: energy reset, draw, fire start-of-turn status hooks.
 */
export function startPlayerTurn(tfCtx: TurnFlowContext, drawCount?: number): void {
  tfCtx.player.energy = tfCtx.constants.energy.base + tfCtx.constants.energy.autoIncreasePerTurn;
  tfCtx.player.block = 0;

  fireStatusHooks(tfCtx.player, 'onOwnerTurnStart', tfCtx);

  // Draw — caller can override (e.g., skill grants +N)
  const count = drawCount ?? tfCtx.constants.draw.perTurn;
  if (count > 0) {
    draw(tfCtx.piles, count, tfCtx.rng, tfCtx.constants.hand.hardLimit);
  }
}

/**
 * Player turn end: fire end-of-turn hooks, discard hand (non-retain),
 * decay statuses, reset block? No — block resets at next player turn start.
 *
 * Per user spec: "내 턴 끝나면 손패는 전부 사용카드로 넘어가고" — discard
 * everything (retain support deferred).
 */
export function endPlayerTurn(tfCtx: TurnFlowContext): void {
  fireStatusHooks(tfCtx.player, 'onOwnerTurnEnd', tfCtx);
  discardHand(tfCtx.piles);
  decayAtTurnEnd(tfCtx.player, tfCtx.statuses);
}

/**
 * Run all alive enemies' intents in order, then advance intents.
 * Convenience loop over `runOneEnemyStep` — keep for engine-internal
 * "everything at once" paths (tests, autoResolveCombat).
 */
export function runEnemyTurn(
  tfCtx: TurnFlowContext,
  intentScripts: ReadonlyMap<string, IntentScript>,
): void {
  for (const enemy of tfCtx.enemies) {
    runOneEnemyStep(enemy, intentScripts, tfCtx);
  }
}

/**
 * Run a SINGLE enemy's turn (start-of-turn hooks → intent execution →
 * end-of-turn hooks → status decay → advance intent).
 *
 * Granular variant used by the UI to walk the enemy turn one enemy at
 * a time, with animations + Enter prompts between steps. No-op if the
 * enemy is already dead.
 */
export function runOneEnemyStep(
  enemy: EnemyActor,
  intentScripts: ReadonlyMap<string, IntentScript>,
  tfCtx: TurnFlowContext,
): void {
  if (enemy.hp <= 0) return;

  fireStatusHooks(enemy, 'onOwnerTurnStart', tfCtx);
  if (enemy.hp <= 0) return; // could die from bleed/poison etc.

  // Reset enemy block at start of its turn (block is per-turn for enemies too)
  enemy.block = 0;

  const intent = enemy.intent;
  if (intent) {
    const enemyCtx: ExecutionContext = {
      ...toExecutionContext(tfCtx),
      source: enemy,
      target: undefined, // not used when source is an enemy
    };
    executeEffects(intent.effects, enemyCtx);
    enemy.lastIntentId = intent.id;
  }

  fireStatusHooks(enemy, 'onOwnerTurnEnd', tfCtx);
  decayAtTurnEnd(enemy, tfCtx.statuses);

  // Pick next intent (even if dead — harmless)
  const script = intentScripts.get(enemy.instanceId);
  if (script) enemy.intent = decideNextIntent(enemy, script, tfCtx.rng);
}

export function isCombatOver(tfCtx: TurnFlowContext): CombatOutcome {
  if (tfCtx.player.hp <= 0) return 'lost';
  if (tfCtx.enemies.every(e => e.hp <= 0)) return 'won';
  return 'inProgress';
}

// ====================================================================
// Intent selection
// ====================================================================

export function decideNextIntent(
  enemy: EnemyActor,
  script: IntentScript,
  rng: IRandom,
): Intent | undefined {
  if (script.intents.length === 0) return undefined;

  switch (script.mode) {
    case 'cycle': {
      const cursor = enemy.intentCursor ?? 0;
      const idx = cursor % script.intents.length;
      enemy.intentCursor = (cursor + 1) % script.intents.length;
      return script.intents[idx];
    }
    case 'weighted': {
      const total = script.intents.reduce((s, i) => s + (i.weight ?? 1), 0);
      if (total <= 0) return script.intents[0];
      let r = rng.float() * total;
      for (const intent of script.intents) {
        r -= intent.weight ?? 1;
        if (r <= 0) return intent;
      }
      return script.intents[script.intents.length - 1];
    }
    case 'scripted': {
      const last = enemy.lastIntentId
        ? script.intents.find(i => i.id === enemy.lastIntentId)
        : undefined;
      const nextId = last?.nextIntentId;
      const next = nextId ? script.intents.find(i => i.id === nextId) : undefined;
      return next ?? script.intents[0];
    }
  }
}

// ====================================================================
// Hook firing — bridges status engine and effect executor.
// ====================================================================

/**
 * Fire all status hooks on `actor` for `event`. Effects run with the
 * status's owner as source (so loseHp etc. target the owner).
 *
 * Condition checks on hooks are NOT evaluated in this slice — the
 * ConditionEvaluator integration with status context is a follow-up.
 * Hooks fire unconditionally if condition is undefined; conditional
 * hooks are skipped with a TODO note. (None of the test fixtures use
 * conditional hooks yet.)
 */
export function fireStatusHooks(
  actor: Actor,
  event: StatusEventName,
  tfCtx: TurnFlowContext,
): void {
  const hooks = collectHooks(actor, event, tfCtx.statuses);
  for (const h of hooks) {
    const def = tfCtx.statuses.get(h.statusId);
    const hook = def.hooks[h.hookIndex]!;
    if (hook.condition) {
      // TODO: integrate ConditionEvaluator (needs RunSnapshot/GlobalSnapshot
      // projection from TurnFlowContext). Skip for now.
      continue;
    }
    const hookCtx: ExecutionContext = {
      ...toExecutionContext(tfCtx),
      source: actor,
      target: undefined,
    };
    executeEffects(hook.effects, hookCtx);
    if (h.decayOnFire) reduceStatusStacks(actor, h.statusId, 1);
  }
}

/** Convert TurnFlowContext to ExecutionContext (fill in source/target at use site). */
function toExecutionContext(tfCtx: TurnFlowContext): ExecutionContext {
  return {
    enemies: tfCtx.enemies,
    player: tfCtx.player,
    piles: tfCtx.piles,
    statuses: tfCtx.statuses,
    rng: tfCtx.rng,
    constants: tfCtx.constants,
    run: tfCtx.run,
    customHandlers: tfCtx.customHandlers,
  };
}
