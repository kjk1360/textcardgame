import type { ConditionExpr } from './condition.js';
import type { Effect } from './effect.js';
import type { EffectTag, StatusId } from './ids.js';

/**
 * StackingRule — what happens when the same status is applied again
 * while it's already present.
 *
 * Simplification vs. 01_engine_primitives.md spec: 'duration' rule
 * dropped. `stacks` is the universal magnitude; for "N turns" statuses
 * (e.g., vulnerable), stacks-as-duration is modeled by combining
 * stackingRule: 'sum' with decay: 'fixedPerTurn'.
 */
export type StackingRule = 'sum' | 'max';

/**
 * When decay reduces stacks automatically.
 */
export type DecayRule =
  /** Permanent (e.g., 근력). Stacks only change via explicit removeStatus. */
  | { kind: 'none' }
  /** Reduce stacks by N at each ownerTurnEnd (e.g., vulnerable -1/turn). */
  | { kind: 'fixedPerTurn'; amount: number }
  /** Zero stacks at ownerTurnEnd (e.g., block-style reset). */
  | { kind: 'allAtEndOfTurn' }
  /** Reduce stacks by 1 each time the status's own hook fires. */
  | { kind: 'oneStackPerTrigger' };

/**
 * When the engine triggers status-defined effects.
 *
 * - lifecycle events: onApplied, onRemoved
 * - turn boundaries: onOwnerTurnStart, onOwnerTurnEnd
 * - combat triggers: onTakeDamage, onDealDamage
 * - card hooks: onCardPlayed
 *
 * The same status can have multiple hooks for different events.
 */
export type StatusEventName =
  | 'onApplied'
  | 'onRemoved'
  | 'onOwnerTurnStart'
  | 'onOwnerTurnEnd'
  | 'onTakeDamage'
  | 'onDealDamage'
  | 'onCardPlayed';

export interface StatusHook {
  readonly on: StatusEventName;
  readonly effects: ReadonlyArray<Effect>;
  readonly condition?: ConditionExpr;
}

/**
 * StatusDefinition — declarative definition of a status effect kind.
 *
 * The engine treats status by its definition's rules; the same engine
 * handles vulnerable / weak / bleed / regen / custom statuses through
 * varying stackingRule + decay + hooks combinations.
 *
 * Doc: 01_engine_primitives.md §4
 */
export interface StatusDefinition {
  readonly id: StatusId;
  readonly name: string;
  readonly description: string;
  readonly stackingRule: StackingRule;
  readonly decay: DecayRule;
  readonly tags: ReadonlyArray<EffectTag>;
  readonly hooks: ReadonlyArray<StatusHook>;
  /**
   * Damage-pipeline participation. Implemented in the damage module
   * later — this metadata tells it which statuses to consult.
   *
   * - 'outgoingMul': source's outgoing damage × multiplier (e.g., weak)
   * - 'outgoingAdd': source's outgoing damage + N (e.g., strength)
   * - 'incomingMul': target's incoming damage × multiplier (e.g., vulnerable)
   * - 'incomingAdd': target's incoming damage + N
   */
  readonly damagePipeline?: ReadonlyArray<DamagePipelineRule>;
}

export type DamagePipelineRule =
  | { kind: 'outgoingMul'; multiplier: number }         // 약화 등 (source의 출력 데미지 ×)
  | { kind: 'outgoingAdd'; perStack: number }            // 근력 등 (source의 출력 데미지 + stacks×N)
  | { kind: 'incomingMul'; multiplier: number }          // 취약 등 (target의 입력 데미지 ×)
  | { kind: 'incomingAdd'; perStack: number }            // (target의 입력 데미지 + stacks×N)
  | { kind: 'blockGainAdd'; perStack: number }           // 민첩 등 (block 획득 + stacks×N)
  | { kind: 'blockGainMul'; multiplier: number };        // (block 획득 × multiplier)
