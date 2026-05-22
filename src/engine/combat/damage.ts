import type { Actor } from '../../types/index.js';
import type { StatusRegistry } from '../statuses/engine.js';

/**
 * Damage pipeline — the rules for how raw damage / block-gain values
 * are transformed by source and target statuses, then applied.
 *
 * Doc: 03_combat_system.md §"데미지 계산 파이프라인"
 *
 * Pipeline order (slay-the-spire-conventional, confirmed by user):
 *
 *   raw
 *    │
 *    ├─ source's outgoing modifiers (e.g., weak ×0.75, strength +N×stacks)
 *    │
 *    ├─ target's incoming modifiers (e.g., vulnerable ×1.5)
 *    │
 *    ├─ floor to integer, clamp >=0
 *    │
 *    ├─ absorbed by target.block (unless ignoreBlock)
 *    │
 *    ├─ remainder → target.hp -= ...
 *    │
 *    └─ if target.hp <= 0 → killed flag
 *
 * The functions in this module are pure-ish: they mutate the passed
 * target actor's hp/block but return an outcome record. They do NOT
 * fire game-event hooks (onDamageDealt, onDamageTaken, onKilled) —
 * the EffectExecutor will do that after damage is applied, using the
 * outcome to populate the event payload.
 */

export interface DamageOutcome {
  /** Raw input value before pipeline. */
  readonly attempted: number;
  /** After outgoing+incoming status modifiers, floored, clamped >=0. */
  readonly calculated: number;
  /** How much of target.block was consumed. */
  readonly blockConsumed: number;
  /** How much hp was actually lost (block-absorbed damage doesn't count). */
  readonly hpLost: number;
  /** True if target's hp reached 0 due to this damage. */
  readonly killed: boolean;
  /** True if target.block went from >0 to 0 on this damage event. */
  readonly blockBroken: boolean;
}

export interface ApplyDamageOptions {
  /** Skip block absorption — damage goes directly to hp. */
  ignoreBlock?: boolean;
}

/**
 * Pure calculation — does NOT mutate.
 * Useful for previewing intent damage in UI.
 */
export function calculateDamage(
  source: Actor | undefined,
  target: Actor,
  raw: number,
  registry: StatusRegistry,
): number {
  let amount = raw;

  // Outgoing modifiers (only if source provided — bleed/poison have no source)
  if (source) {
    for (const status of source.statuses) {
      if (!registry.has(status.id)) continue;
      const def = registry.get(status.id);
      if (!def.damagePipeline) continue;
      for (const rule of def.damagePipeline) {
        if (rule.kind === 'outgoingMul') amount = amount * rule.multiplier;
        else if (rule.kind === 'outgoingAdd') amount = amount + rule.perStack * status.stacks;
      }
    }
  }

  // Incoming modifiers from target
  for (const status of target.statuses) {
    if (!registry.has(status.id)) continue;
    const def = registry.get(status.id);
    if (!def.damagePipeline) continue;
    for (const rule of def.damagePipeline) {
      if (rule.kind === 'incomingMul') amount = amount * rule.multiplier;
      else if (rule.kind === 'incomingAdd') amount = amount + rule.perStack * status.stacks;
    }
  }

  return Math.max(0, Math.floor(amount));
}

/**
 * Apply damage to target. Mutates target.hp and target.block.
 *
 * - `source` is optional: undefined for true damage with no attacker
 *   (e.g., bleed tick, poison tick, environmental).
 * - Dead target (hp<=0) is a silent no-op.
 */
export function applyDamage(
  source: Actor | undefined,
  target: Actor,
  raw: number,
  registry: StatusRegistry,
  opts?: ApplyDamageOptions,
): DamageOutcome {
  // Dead target → no-op
  if (target.hp <= 0) {
    return {
      attempted: raw,
      calculated: 0,
      blockConsumed: 0,
      hpLost: 0,
      killed: false,
      blockBroken: false,
    };
  }

  const calculated = calculateDamage(source, target, raw, registry);

  let remaining = calculated;
  let blockConsumed = 0;
  let blockBroken = false;

  if (!opts?.ignoreBlock && target.block > 0 && remaining > 0) {
    const absorbed = Math.min(remaining, target.block);
    target.block -= absorbed;
    remaining -= absorbed;
    blockConsumed = absorbed;
    blockBroken = target.block === 0;
  }

  target.hp -= remaining;
  const hpLost = remaining;
  let killed = false;
  if (target.hp <= 0) {
    target.hp = 0;
    killed = true;
  }

  // 가시 (Thorns) — 공격받을 때 공격자에게 stack만큼 피해 반사.
  // source가 있어야 하고 (status tick은 source 없음) 자기 자신 반사는 안 함.
  // 반사 피해는 true damage (block 무시) — 게시판 일반 룰.
  if (source && source !== target && source.hp > 0 && hpLost > 0) {
    const thorns = target.statuses.find(s => s.id === 'thorns');
    if (thorns && thorns.stacks > 0) {
      // 직접 hp 차감 (재귀 applyDamage 호출 시 무한루프 위험 — 둘 다 thorns
      // 가지면 핑퐁). 단순 true damage로 처리.
      const refl = thorns.stacks;
      source.hp = Math.max(0, source.hp - refl);
    }
  }

  return { attempted: raw, calculated, blockConsumed, hpLost, killed, blockBroken };
}

export interface BlockGainOutcome {
  /** Raw input before pipeline. */
  readonly attempted: number;
  /** After status pipeline (blockGainAdd / blockGainMul), floored, >=0. */
  readonly gained: number;
}

/**
 * Calculate block gain after status modifiers (e.g., dexterity).
 * Pure — does NOT mutate.
 */
export function calculateBlockGain(
  target: Actor,
  raw: number,
  registry: StatusRegistry,
): number {
  let amount = raw;
  for (const status of target.statuses) {
    if (!registry.has(status.id)) continue;
    const def = registry.get(status.id);
    if (!def.damagePipeline) continue;
    for (const rule of def.damagePipeline) {
      if (rule.kind === 'blockGainAdd') amount = amount + rule.perStack * status.stacks;
      else if (rule.kind === 'blockGainMul') amount = amount * rule.multiplier;
    }
  }
  return Math.max(0, Math.floor(amount));
}

/**
 * Apply block gain. Mutates target.block.
 */
export function applyBlockGain(
  target: Actor,
  raw: number,
  registry: StatusRegistry,
): BlockGainOutcome {
  const gained = calculateBlockGain(target, raw, registry);
  target.block += gained;
  return { attempted: raw, gained };
}

/**
 * Direct HP loss bypassing all damage modifiers (true damage from effects
 * like `loseHp`). Still respects ignoreBlock semantics.
 *
 * For loseHp effects, `ignoreBlock: true` is the common case (bleed
 * triggering on the actor itself, "1 의 진짜 피해").
 */
export function applyTrueLoseHp(
  target: Actor,
  amount: number,
  opts?: ApplyDamageOptions,
): DamageOutcome {
  if (target.hp <= 0 || amount <= 0) {
    return {
      attempted: amount,
      calculated: amount,
      blockConsumed: 0,
      hpLost: 0,
      killed: false,
      blockBroken: false,
    };
  }
  let remaining = Math.floor(amount);
  let blockConsumed = 0;
  let blockBroken = false;
  if (!opts?.ignoreBlock && target.block > 0) {
    const absorbed = Math.min(remaining, target.block);
    target.block -= absorbed;
    remaining -= absorbed;
    blockConsumed = absorbed;
    blockBroken = target.block === 0;
  }
  target.hp -= remaining;
  const hpLost = remaining;
  let killed = false;
  if (target.hp <= 0) {
    target.hp = 0;
    killed = true;
  }
  return { attempted: amount, calculated: amount, blockConsumed, hpLost, killed, blockBroken };
}

/**
 * Direct HP gain (capped at maxHp).
 * Returns the amount actually healed (could be less than `amount` if at max).
 */
export function applyHeal(target: Actor, amount: number): number {
  if (amount <= 0 || target.hp <= 0) return 0;
  const before = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + Math.floor(amount));
  return target.hp - before;
}
