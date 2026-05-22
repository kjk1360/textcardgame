import { randomUUID } from 'node:crypto';
import type {
  CardDefId,
  CardInstanceId,
  CardPool,
  CardPoolId,
  StatusId,
} from '../../types/index.js';
import { applyBlockGain, applyDamage, applyTrueLoseHp } from '../combat/damage.js';
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
 * combatDamageBoostByTag — 단검술 숙련 등이 사용. params: { tag, delta }.
 * inCombat.activity.damageBoosts.byTag[tag] += delta.
 */
export const combatDamageBoostByTag: CustomEffectHandler = (params, ctx) => {
  const tag = params?.['tag'] as string | undefined;
  const delta = (params?.['delta'] as number | undefined) ?? 0;
  if (!tag || delta === 0) return;
  const run = ctx.run as { activity?: { kind: string; damageBoosts?: { byTag?: Record<string, number> } } };
  if (run.activity?.kind !== 'inCombat') return;
  if (!run.activity.damageBoosts) run.activity.damageBoosts = {};
  if (!run.activity.damageBoosts.byTag) run.activity.damageBoosts.byTag = {};
  run.activity.damageBoosts.byTag[tag] = (run.activity.damageBoosts.byTag[tag] ?? 0) + delta;
};

/**
 * boostCardDamage — 보석 건틀릿 등이 사용 (사용자 카드에서 핸들러로 호출
 * 가능 / 또는 자동 트리거). params: { defId, delta }.
 */
export const boostCardDamage: CustomEffectHandler = (params, ctx) => {
  const defId = params?.['defId'] as string | undefined;
  const delta = (params?.['delta'] as number | undefined) ?? 0;
  if (!defId || delta === 0) return;
  const run = ctx.run as { activity?: { kind: string; damageBoosts?: { byCardDefId?: Record<string, number> } } };
  if (run.activity?.kind !== 'inCombat') return;
  if (!run.activity.damageBoosts) run.activity.damageBoosts = {};
  if (!run.activity.damageBoosts.byCardDefId) run.activity.damageBoosts.byCardDefId = {};
  run.activity.damageBoosts.byCardDefId[defId] = (run.activity.damageBoosts.byCardDefId[defId] ?? 0) + delta;
};

/**
 * nextAttackRiderPoison — 독약병. 다음 공격 카드의 피해량만큼 대상에게
 * 중독 부여 (combatPlayCard에서 처리).
 */
export const nextAttackRiderPoison: CustomEffectHandler = (_params, ctx) => {
  const run = ctx.run as { activity?: { kind: string; pendingAttackRiders?: { poisonByDamage?: boolean } } };
  if (run.activity?.kind !== 'inCombat') return;
  if (!run.activity.pendingAttackRiders) run.activity.pendingAttackRiders = {};
  run.activity.pendingAttackRiders.poisonByDamage = true;
};

/**
 * cloneLastMagicToHand — 거울상. 마지막에 사용한 마법 카드를 손에 1장 복제.
 */
export const cloneLastMagicToHand: CustomEffectHandler = (_params, ctx) => {
  const run = ctx.run as { activity?: { kind: string; lastMagicCardId?: string } };
  if (run.activity?.kind !== 'inCombat') return;
  const lastId = run.activity.lastMagicCardId;
  if (!lastId || !ctx.cards) return;
  // 직접 addCardToPile 실행 — temporary 카드로.
  // executor의 addCardToPile case를 inline 호출하기 어려워 직접 push.
  // 임시: pile 직접 mutate.
  const def = ctx.cards.get(lastId as never);
  if (!def) return;
  const handLimit = ctx.constants.hand.hardLimit;
  if (ctx.piles.hand.length >= handLimit) return;
  ctx.piles.hand.push({
    instanceId: randomUUID() as CardInstanceId,
    defId: lastId as CardDefId,
    modifiers: [],
    acquired: { kind: 'event', contextId: 'mirror_image' },
    temporary: true,
  });
};

/**
 * nextTurnEnergyReserve — 메모라이즈. 다음 턴 시작 시 에너지 +N.
 */
export const nextTurnEnergyReserve: CustomEffectHandler = (params, ctx) => {
  const amount = (params?.['amount'] as number | undefined) ?? 0;
  if (amount <= 0) return;
  const run = ctx.run as { activity?: { kind: string; nextTurnEnergyBonus?: number } };
  if (run.activity?.kind !== 'inCombat') return;
  run.activity.nextTurnEnergyBonus = (run.activity.nextTurnEnergyBonus ?? 0) + amount;
};

/**
 * fireballAdjacent — 파이어볼. params: { baseAmount, sideAmount }.
 * 타겟 적에게 baseAmount, 인덱스±1 적에게 sideAmount.
 */
export const fireballAdjacent: CustomEffectHandler = (params, ctx) => {
  const baseAmount = (params?.['baseAmount'] as number | undefined) ?? 0;
  const sideAmount = (params?.['sideAmount'] as number | undefined) ?? 0;
  if (!ctx.target) return;
  const idx = ctx.enemies.indexOf(ctx.target);
  if (idx < 0) return;
  applyDamage(ctx.source, ctx.target, baseAmount, ctx.statuses);
  if (idx - 1 >= 0) {
    const left = ctx.enemies[idx - 1]!;
    if (left.hp > 0) applyDamage(ctx.source, left, sideAmount, ctx.statuses);
  }
  if (idx + 1 < ctx.enemies.length) {
    const right = ctx.enemies[idx + 1]!;
    if (right.hp > 0) applyDamage(ctx.source, right, sideAmount, ctx.statuses);
  }
};

/**
 * chainLightning — params: { initialAmount, falloff }.
 * 타겟 적에게 initialAmount, 우측(인덱스 높은) 살아있는 적에게 -falloff씩
 * 줄어들면서 재시전. amount가 0 이하 또는 우측 끝까지 가면 종료.
 */
export const chainLightning: CustomEffectHandler = (params, ctx) => {
  const initial = (params?.['initialAmount'] as number | undefined) ?? 0;
  const falloff = (params?.['falloff'] as number | undefined) ?? 1;
  if (!ctx.target) return;
  let idx = ctx.enemies.indexOf(ctx.target);
  if (idx < 0) return;
  let amount = initial;
  while (idx < ctx.enemies.length && amount > 0) {
    const tgt = ctx.enemies[idx]!;
    if (tgt.hp > 0) {
      applyDamage(ctx.source, tgt, amount, ctx.statuses);
    }
    amount -= falloff;
    idx += 1;
  }
};

/**
 * removeAllBuffs — 역산 장치. 대상의 모든 status 제거.
 */
export const removeAllBuffs: CustomEffectHandler = (params, ctx) => {
  const target = params?.['target'] as string | undefined;
  // 단일 enemy 만 지원 (역산 장치는 target: 'enemy' 카드 → ctx.target에 있음)
  if (target === 'enemy' && ctx.target) {
    ctx.target.statuses.length = 0;
  } else if (target === 'self') {
    ctx.player.statuses.length = 0;
  } else if (target === 'allEnemies') {
    for (const e of ctx.enemies) e.statuses.length = 0;
  }
};

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
  m.set('combatDamageBoostByTag', combatDamageBoostByTag);
  m.set('boostCardDamage', boostCardDamage);
  m.set('nextAttackRiderPoison', nextAttackRiderPoison);
  m.set('cloneLastMagicToHand', cloneLastMagicToHand);
  m.set('nextTurnEnergyReserve', nextTurnEnergyReserve);
  m.set('removeAllBuffs', removeAllBuffs);
  m.set('fireballAdjacent', fireballAdjacent);
  m.set('chainLightning', chainLightning);
  if (overrides) {
    for (const [k, v] of overrides) m.set(k, v);
  }
  return m;
}
