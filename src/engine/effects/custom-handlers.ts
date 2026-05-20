import type { StatusId } from '../../types/index.js';
import { applyTrueLoseHp } from '../combat/damage.js';
import type { CustomEffectHandler } from './executor.js';

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
 * Build the default handler registry, plus any user-supplied overrides.
 * Override entries replace built-ins with the same key.
 */
export function buildDefaultCustomHandlers(
  overrides?: ReadonlyMap<string, CustomEffectHandler>,
): Map<string, CustomEffectHandler> {
  const m = new Map<string, CustomEffectHandler>();
  m.set('tickStatusDamage', tickStatusDamage);
  if (overrides) {
    for (const [k, v] of overrides) m.set(k, v);
  }
  return m;
}
