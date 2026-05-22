import type {
  CardDefId,
  CardPool,
  CardPoolId,
  StatusId,
} from '../../types/index.js';
import { applyBlockGain, applyTrueLoseHp } from '../combat/damage.js';
import { sampleCardsFromPool } from '../cards/pool-sampler.js';
import type { IRandom } from '../rng.js';
import type { CustomEffectHandler, ExecutionContext } from './executor.js';

/**
 * Built-in custom-effect handlers.
 *
 * Custom handlers extend the effect pipeline when the data-driven kinds
 * (damage/loseHp/applyStatus/etc.) can't express the desired semantics.
 * Each handler is keyed by a string id; the effect is invoked with
 *   { kind: 'custom'; handlerId: '<key>'; params?: {...} }.
 *
 * Currently registered:
 *   - tickStatusDamage  — periodic damage equal to the OWNER's current
 *                         stacks of a named status. Used by poison/bleed
 *                         turn-tick hooks. Bypasses block (true damage).
 *
 * Register more here as more periodic / dynamic effects show up.
 */

/**
 * tickStatusDamage — params: `{ statusId: <id> }`.
 *
 * Reads the source actor's stack count of `statusId` and applies
 * loseHp(stacks, ignoreBlock=true). Source is whatever the executor
 * was invoked with (typically the status owner via fireStatusHooks).
 */
export const tickStatusDamage: CustomEffectHandler = (params, ctx) => {
  const statusId = params?.['statusId'] as StatusId | undefined;
  if (!statusId) return;
  const owner = ctx.source;
  if (!owner) return;
  const s = owner.statuses.find(st => st.id === statusId);
  if (!s || s.stacks <= 0) return;
  applyTrueLoseHp(owner, s.stacks, { ignoreBlock: true });
};

/**
 * tickStatusBlock — params: `{ statusId: <id> }`.
 *
 * Owner gains `stacks` block from `applyBlockGain` (so dexterity etc.
 * still applies). Used by 판금 turn-end hook.
 *
 * (applyBlockGain isn't imported here — handler is constructed via a
 * factory that closes over the needed deps. See `tickStatusBlockFactory`.)
 */
export const tickStatusBlock: CustomEffectHandler = (params, ctx) => {
  const statusId = params?.['statusId'] as StatusId | undefined;
  if (!statusId) return;
  const owner = ctx.source;
  if (!owner) return;
  const s = owner.statuses.find(st => st.id === statusId);
  if (!s || s.stacks <= 0) return;
  // Add stacks block via applyBlockGain so dexterity etc. still applies.
  applyBlockGain(owner, s.stacks, ctx.statuses);
};

/**
 * Build the discoverFromPool handler with closure over the card-pool
 * registry + rng. Sets `run.activity.pendingDiscover` so the UI can
 * prompt the player to pick one of N sampled cards.
 *
 * params: `{ poolId: CardPoolId, count?: number, canSkip?: boolean }`
 *
 * Effect is synchronous at execution time — the actual card addition
 * happens later via `Game.combatPickDiscover()`.
 */
export function makeDiscoverFromPoolHandler(deps: {
  cardPools: { get(id: CardPoolId): CardPool | undefined };
  rng: IRandom;
}): CustomEffectHandler {
  return (params, ctx: ExecutionContext) => {
    const poolId = params?.['poolId'] as CardPoolId | undefined;
    if (!poolId) return;
    const count = (params?.['count'] as number | undefined) ?? 3;
    const canSkip = (params?.['canSkip'] as boolean | undefined) ?? false;
    const pool = deps.cardPools.get(poolId);
    if (!pool) return;
    const choices = sampleCardsFromPool(pool, count, deps.rng);
    // run.activity is RunActivity (inCombat | inMap | ...). Typed loose
    // here to set pendingDiscover when we're actually mid-combat.
    const run = ctx.run as { activity?: { kind: string; pendingDiscover?: { choices: CardDefId[]; canSkip: boolean } } };
    if (run.activity?.kind === 'inCombat') {
      run.activity.pendingDiscover = { choices, canSkip };
    }
  };
}

/**
 * Build the default handler registry, plus any user-supplied overrides.
 * Override entries replace built-ins with the same key.
 */
export function buildDefaultCustomHandlers(
  deps: {
    cardPools: { get(id: CardPoolId): CardPool | undefined };
    rng: IRandom;
  },
  overrides?: ReadonlyMap<string, CustomEffectHandler>,
): Map<string, CustomEffectHandler> {
  const m = new Map<string, CustomEffectHandler>();
  m.set('tickStatusDamage', tickStatusDamage);
  m.set('tickStatusBlock', tickStatusBlock);
  m.set('discoverFromPool', makeDiscoverFromPoolHandler(deps));
  if (overrides) {
    for (const [k, v] of overrides) m.set(k, v);
  }
  return m;
}
