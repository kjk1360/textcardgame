/**
 * Branded ID newtypes.
 *
 * They compile to plain `string` but TypeScript treats them as distinct,
 * preventing mix-ups like passing a CardDefId where a ModifierId is expected.
 *
 * Usage:
 *   const id = 'dagger_throw' as CardDefId;
 *   const id2: ModifierId = 'mod_x' as ModifierId;
 */

declare const __brand: unique symbol;
type Brand<K, T> = K & { readonly [__brand]: T };

export type CardDefId       = Brand<string, 'CardDefId'>;
export type CardInstanceId  = Brand<string, 'CardInstanceId'>;
export type ModifierId      = Brand<string, 'ModifierId'>;
export type ModifierPoolId  = Brand<string, 'ModifierPoolId'>;
export type CardPoolId      = Brand<string, 'CardPoolId'>;
export type StatusId        = Brand<string, 'StatusId'>;
export type EnemyId         = Brand<string, 'EnemyId'>;
export type EnemyGroupId    = Brand<string, 'EnemyGroupId'>;
export type SkillId         = Brand<string, 'SkillId'>;
export type EventId         = Brand<string, 'EventId'>;
export type ScenarioId      = Brand<string, 'ScenarioId'>;
export type NodeTypeId      = Brand<string, 'NodeTypeId'>;
export type EffectTag       = Brand<string, 'EffectTag'>;

/** Helper to brand a plain string. Use this at registry/data-load boundaries. */
export function asId<T extends Brand<string, any>>(s: string): T {
  return s as T;
}
