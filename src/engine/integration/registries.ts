import type {
  CardDefId,
  CardDefinition,
  CardPool,
  CardPoolId,
  CardPoolRegistry,
  EnemyId,
  EnemyGroupId,
  EventDefinition,
  EventId,
  FlowDefinition,
  IntentScript,
  Modifier,
  ModifierId,
  ModifierPool,
  ModifierPoolId,
  ScenarioId,
  SkillDefinition,
  SkillId,
  StatusDefinition,
  StatusId,
} from '../../types/index.js';
import type { CardRegistryLookup } from '../combat/play-card.js';
import type { ModifierLookup } from '../modifiers/resolver.js';
import type { PoolLookup } from '../modifiers/sampler.js';
import type { StatusRegistry } from '../statuses/engine.js';
import type { SkillBoxRegistry, SkillBoxDefinition } from '../meta/skill-box.js';
import type { SkillRegistry } from '../skills/engine.js';

/**
 * Minimal definitions for entities we hadn't formalized in types/ yet.
 * Promoted here so the integration layer has stable shapes to consume.
 */

export interface EnemyDefinition {
  readonly id: EnemyId;
  readonly name: string;
  readonly tier: 'normal' | 'elite' | 'boss' | 'finalBoss';
  readonly hpRange: [number, number];
  readonly intentScript: IntentScript;
  readonly rewards?: { goldRange: [number, number] };
}

export interface EnemyGroupDefinition {
  readonly id: EnemyGroupId;
  readonly intro?: string;
  readonly members: ReadonlyArray<EnemyId>;
}

export interface EnemyRegistry {
  get(id: EnemyId): EnemyDefinition;
  has(id: EnemyId): boolean;
  all(): ReadonlyArray<EnemyDefinition>;
}
export interface EnemyGroupRegistry {
  get(id: EnemyGroupId): EnemyGroupDefinition;
  has(id: EnemyGroupId): boolean;
  all(): ReadonlyArray<EnemyGroupDefinition>;
}
export interface EventRegistry {
  get(id: EventId): EventDefinition;
  has(id: EventId): boolean;
  all(): ReadonlyArray<EventDefinition>;
}
export interface FlowRegistry {
  get(id: ScenarioId): FlowDefinition;
  has(id: ScenarioId): boolean;
}

/**
 * One-stop bag of all the registries the engine integration needs.
 * Concrete implementations live in tests + the data pipeline (Phase 4).
 */
export interface GameRegistries {
  readonly cards: CardRegistryLookup;
  readonly cardPools: CardPoolRegistry;
  readonly modifiers: ModifierLookup;
  readonly modifierPools: PoolLookup;
  readonly statuses: StatusRegistry;
  readonly skills: SkillRegistry;
  readonly skillBoxes: SkillBoxRegistry;
  readonly enemies: EnemyRegistry;
  readonly enemyGroups: EnemyGroupRegistry;
  readonly events: EventRegistry;
  readonly flows: FlowRegistry;
}

// ====================================================================
// Simple Map-backed registry builders (helpful for tests + simple data)
// ====================================================================

export function makeMapRegistry<K, V>(
  entries: ReadonlyArray<[K, V]>,
): { get(id: K): V; has(id: K): boolean; all(): ReadonlyArray<V> } {
  const map = new Map(entries);
  const list = entries.map(([, v]) => v);
  return {
    get(id) {
      const v = map.get(id);
      if (v === undefined) throw new Error(`Registry: id not found: ${String(id)}`);
      return v;
    },
    has(id) { return map.has(id); },
    all() { return list; },
  };
}

export function makeCardRegistry(defs: ReadonlyArray<CardDefinition>): CardRegistryLookup {
  return makeMapRegistry(defs.map(d => [d.id, d] as const));
}

export function makeCardPoolRegistry(pools: ReadonlyArray<CardPool>): CardPoolRegistry {
  const map = new Map(pools.map(p => [p.id, p]));
  return {
    get(id: CardPoolId) { return map.get(id); },
    has(id: CardPoolId) { return map.has(id); },
  };
}

export function makeModifierRegistry(defs: ReadonlyArray<Modifier>): ModifierLookup {
  return makeMapRegistry(defs.map(d => [d.id, d] as const));
}

export function makeModifierPoolRegistry(pools: ReadonlyArray<ModifierPool>): PoolLookup {
  return makeMapRegistry(pools.map(p => [p.id, p] as const));
}

export function makeStatusRegistry(defs: ReadonlyArray<StatusDefinition>): StatusRegistry {
  const map = new Map(defs.map(d => [d.id, d]));
  return {
    get(id: StatusId) {
      const v = map.get(id);
      if (!v) throw new Error(`Status not found: ${id}`);
      return v;
    },
    has(id: StatusId) { return map.has(id); },
  };
}

export function makeSkillRegistry(defs: ReadonlyArray<SkillDefinition>): SkillRegistry {
  const map = new Map(defs.map(d => [d.id, d]));
  return {
    get(id: SkillId) {
      const v = map.get(id);
      if (!v) throw new Error(`Skill not found: ${id}`);
      return v;
    },
    has(id: SkillId) { return map.has(id); },
  };
}

export function makeEnemyRegistry(defs: ReadonlyArray<EnemyDefinition>): EnemyRegistry {
  return makeMapRegistry(defs.map(d => [d.id, d] as const));
}

export function makeEnemyGroupRegistry(defs: ReadonlyArray<EnemyGroupDefinition>): EnemyGroupRegistry {
  return makeMapRegistry(defs.map(d => [d.id, d] as const));
}

export function makeEventRegistry(defs: ReadonlyArray<EventDefinition>): EventRegistry {
  return makeMapRegistry(defs.map(d => [d.id, d] as const));
}

export function makeFlowRegistry(defs: ReadonlyArray<FlowDefinition>): FlowRegistry {
  return makeMapRegistry(defs.map(d => [d.id, d] as const));
}

export function makeSkillBoxRegistryFromList(
  boxes: ReadonlyArray<SkillBoxDefinition>,
): SkillBoxRegistry {
  const map = new Map(boxes.map(b => [b.grade, b]));
  return {
    get: g => map.get(g),
    all: () => [...map.values()],
  };
}
