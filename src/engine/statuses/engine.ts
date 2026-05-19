import type {
  Actor,
  StatusDefinition,
  StatusEventName,
  StatusId,
  StatusInstance,
} from '../../types/index.js';

/**
 * Status engine — manages status instances on actors.
 *
 * Responsibilities:
 *   - Apply / remove status with stacking rules
 *   - Query stacks (for damage pipeline + UI)
 *   - Decay statuses at turn boundaries
 *   - Provide hook dispatch entry points (effect execution itself is in
 *     the Effect Executor — this module just gathers the eligible hooks)
 *
 * Doc: 03_combat_system.md §"상태 효과 시스템"
 *
 * The engine is intentionally PASSIVE about hook firing — it doesn't
 * execute effects. Instead, `collectHooks()` returns the (status, hook)
 * pairs that should fire for a given event, and the calling code (likely
 * EffectExecutor) runs them with proper context. This keeps the status
 * engine free of dependencies on game-wide effect execution.
 */

export interface StatusRegistry {
  get(id: StatusId): StatusDefinition;
  has(id: StatusId): boolean;
}

/**
 * Apply N stacks of `statusId` to `actor`.
 * Honors the status's stackingRule.
 */
export function applyStatus(
  actor: Actor,
  statusId: StatusId,
  stacks: number,
  registry: StatusRegistry,
): void {
  if (stacks <= 0) return;
  const def = registry.get(statusId);
  const existing = actor.statuses.find(s => s.id === statusId);

  if (existing) {
    switch (def.stackingRule) {
      case 'sum':
        existing.stacks += stacks;
        break;
      case 'max':
        existing.stacks = Math.max(existing.stacks, stacks);
        break;
    }
  } else {
    actor.statuses.push({ id: statusId, stacks });
  }
}

/**
 * Remove a status entirely.
 */
export function removeStatus(actor: Actor, statusId: StatusId): boolean {
  const idx = actor.statuses.findIndex(s => s.id === statusId);
  if (idx < 0) return false;
  actor.statuses.splice(idx, 1);
  return true;
}

/**
 * Reduce stacks by N (clamped at 0; removes status if it hits 0).
 * Used by `oneStackPerTrigger` decay and `fixedPerTurn` decay.
 */
export function reduceStatusStacks(
  actor: Actor,
  statusId: StatusId,
  amount: number,
): void {
  if (amount <= 0) return;
  const status = actor.statuses.find(s => s.id === statusId);
  if (!status) return;
  status.stacks -= amount;
  if (status.stacks <= 0) {
    removeStatus(actor, statusId);
  }
}

/**
 * Current stacks of a status (0 if not present).
 */
export function getStacks(actor: Actor, statusId: StatusId): number {
  const s = actor.statuses.find(x => x.id === statusId);
  return s?.stacks ?? 0;
}

export function hasStatus(actor: Actor, statusId: StatusId): boolean {
  return getStacks(actor, statusId) > 0;
}

/**
 * Apply turn-end decay to all statuses on `actor`.
 *
 * - `fixedPerTurn` reduces stacks by `amount`
 * - `allAtEndOfTurn` zeroes stacks
 * - `oneStackPerTrigger` decays via trigger path, NOT here
 * - `none` is unchanged
 */
export function decayAtTurnEnd(actor: Actor, registry: StatusRegistry): void {
  // Snapshot ids to avoid mutation-during-iteration weirdness.
  const ids = actor.statuses.map(s => s.id);
  for (const id of ids) {
    if (!registry.has(id)) continue;
    const def = registry.get(id);
    switch (def.decay.kind) {
      case 'none':
      case 'oneStackPerTrigger':
        break;
      case 'fixedPerTurn':
        reduceStatusStacks(actor, id, def.decay.amount);
        break;
      case 'allAtEndOfTurn':
        removeStatus(actor, id);
        break;
    }
  }
}

/**
 * Returned by collectHooks — the caller (EffectExecutor) iterates and
 * runs the effects with proper context (source, target, etc.).
 *
 * `decayOnFire` flag: when true the caller should call
 * `reduceStatusStacks(actor, status.id, 1)` AFTER executing the effects.
 * Reflects the `oneStackPerTrigger` decay rule.
 */
export interface CollectedHook {
  readonly statusId: StatusId;
  readonly stacks: number;
  readonly hookIndex: number;          // which hook in def.hooks
  readonly decayOnFire: boolean;
}

/**
 * Find all status hooks on `actor` that respond to `event`.
 * Caller is responsible for evaluating each hook's `condition` (if any)
 * via the ConditionEvaluator before executing — this engine doesn't
 * import condition evaluation to keep it dependency-free.
 */
export function collectHooks(
  actor: Actor,
  event: StatusEventName,
  registry: StatusRegistry,
): CollectedHook[] {
  const result: CollectedHook[] = [];
  for (const inst of actor.statuses) {
    if (!registry.has(inst.id)) continue;
    const def = registry.get(inst.id);
    for (let i = 0; i < def.hooks.length; i++) {
      const hook = def.hooks[i]!;
      if (hook.on !== event) continue;
      result.push({
        statusId: inst.id,
        stacks: inst.stacks,
        hookIndex: i,
        decayOnFire: def.decay.kind === 'oneStackPerTrigger',
      });
    }
  }
  return result;
}
