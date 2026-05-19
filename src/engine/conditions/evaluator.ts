import type {
  CardDefId,
  CardDefinition,
  CardInstance,
  ConditionExpr,
  EffectTag,
  EventId,
  GlobalSnapshot,
  RunSnapshot,
  SkillId,
} from '../../types/index.js';
import type { IRandom } from '../rng.js';

/**
 * ConditionEvaluator — evaluates ConditionExpr trees.
 *
 * Used by: ChoiceOption gating, BranchStep, StatusHook, SkillHook,
 * (some) PoolCondition kinds.
 *
 * Doc: 01_engine_primitives.md §8, 04_event_flow_system.md
 *
 * Missing-dependency policy: if a condition references data not in the
 * supplied context (e.g., `hasGold` with no `run`), we THROW with a
 * descriptive message rather than silently returning false. That catches
 * misuse early — production calls should always supply the full context.
 *
 * `random`: each evaluation rolls a fresh dice. Callers must ensure they
 * evaluate at the right cardinality (once per decision, not once per
 * UI re-render). Cache the result outside the evaluator if needed.
 */

export interface CardRegistryLookup {
  get(id: CardDefId): CardDefinition;
}

export type CustomPredicate = (
  params: Record<string, unknown> | undefined,
  ctx: ConditionContext,
) => boolean;

export interface ConditionContext {
  readonly run?: RunSnapshot;
  readonly global?: GlobalSnapshot;
  readonly rng?: IRandom;
  readonly cards?: CardRegistryLookup;
  readonly customPredicates?: ReadonlyMap<string, CustomPredicate>;
}

export function evalCondition(c: ConditionExpr, ctx: ConditionContext): boolean {
  switch (c.kind) {
    case 'always': return true;
    case 'never':  return false;

    case 'and': return c.of.every(x => evalCondition(x, ctx));
    case 'or':  return c.of.some (x => evalCondition(x, ctx));
    case 'not': return !evalCondition(c.of, ctx);

    case 'hasGold': {
      const g = requireRun(ctx, 'hasGold').player.gold;
      if (c.min !== undefined && g < c.min) return false;
      if (c.max !== undefined && g > c.max) return false;
      return true;
    }

    case 'hasGoldMeta': {
      const g = requireGlobal(ctx, 'hasGoldMeta').gold;
      return g >= (c.min ?? 0);
    }

    case 'hasCardInDeck': {
      const deck = requireRun(ctx, 'hasCardInDeck').player.deck;
      return countCards(deck, c.defId, c.tag, ctx) >= (c.min ?? 1);
    }

    case 'hasCardInInventory': {
      const cards = requireGlobal(ctx, 'hasCardInInventory').inventory.cards;
      return countCards(cards, c.defId, c.tag, ctx) >= (c.min ?? 1);
    }

    case 'hasSkill': {
      const run = requireRun(ctx, 'hasSkill');
      return runHasSkill(run, c.skillId);
    }

    case 'hasPassive': {
      const g = requireGlobal(ctx, 'hasPassive');
      return g.passiveSkills.includes(c.skillId);
    }

    case 'hpPercent': {
      const player = requireRun(ctx, 'hpPercent').player;
      const pct = player.maxHp > 0 ? (player.hp / player.maxHp) * 100 : 0;
      if (c.min !== undefined && pct < c.min) return false;
      if (c.max !== undefined && pct > c.max) return false;
      return true;
    }

    case 'difficultyAtLeast': {
      const run = requireRun(ctx, 'difficultyAtLeast');
      return run.difficultyLevel >= c.level;
    }

    case 'eventCleared': {
      const g = requireGlobal(ctx, 'eventCleared');
      return g.eventsCleared.has(c.eventId);
    }

    case 'eventNotCleared': {
      const g = requireGlobal(ctx, 'eventNotCleared');
      return !g.eventsCleared.has(c.eventId);
    }

    case 'random': {
      const rng = requireRng(ctx, 'random');
      return rng.float() < c.chance;
    }

    case 'custom': {
      const fn = ctx.customPredicates?.get(c.predicateId);
      if (!fn) {
        throw new Error(`Custom condition predicate not registered: ${c.predicateId}`);
      }
      return fn(c.params, ctx);
    }
  }
}

// ====================================================================
// Helpers
// ====================================================================

function countCards(
  cards: ReadonlyArray<CardInstance>,
  defId: CardDefId | undefined,
  tag: EffectTag | undefined,
  ctx: ConditionContext,
): number {
  if (defId !== undefined && tag === undefined) {
    let n = 0;
    for (const c of cards) if (c.defId === defId) n++;
    return n;
  }
  if (tag !== undefined) {
    if (!ctx.cards) {
      throw new Error('Condition evaluation requires `cards` registry for tag-based counts');
    }
    let n = 0;
    for (const c of cards) {
      if (defId !== undefined && c.defId !== defId) continue;
      const def = ctx.cards.get(c.defId);
      if (def.tags.includes(tag)) n++;
    }
    return n;
  }
  // Neither defId nor tag specified → total
  return cards.length;
}

function runHasSkill(run: RunSnapshot, id: SkillId): boolean {
  return run.player.skillIds.includes(id);
}

function requireRun(ctx: ConditionContext, kind: string): RunSnapshot {
  if (!ctx.run) {
    throw new Error(`Condition '${kind}' requires a RunSnapshot in context`);
  }
  return ctx.run;
}

function requireGlobal(ctx: ConditionContext, kind: string): GlobalSnapshot {
  if (!ctx.global) {
    throw new Error(`Condition '${kind}' requires a GlobalSnapshot in context`);
  }
  return ctx.global;
}

function requireRng(ctx: ConditionContext, kind: string): IRandom {
  if (!ctx.rng) {
    throw new Error(`Condition '${kind}' requires an IRandom in context`);
  }
  return ctx.rng;
}

// Re-export for callers that build event/branch evaluations and need the
// custom-predicate signature directly.
export type { ConditionExpr } from '../../types/index.js';
// Re-export types for clarity at call sites.
export type { EventId } from '../../types/index.js';
