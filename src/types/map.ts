import type { EnemyGroupId, EventId, NodeTypeId } from './ids.js';

/**
 * Grid map types — the dungeon's spatial structure.
 *
 * - Nodes are cells on a width × height grid.
 * - Edges connect orthogonally-adjacent nodes (4-neighbor).
 * - Each edge can be traversed once (consumed on use).
 * - Visited nodes can be re-entered (via a different edge) but the
 *   node's event does NOT re-fire — re-entry only enables further movement.
 *
 * Doc: 01_engine_primitives.md §9, 05_map_system.md
 */

export interface MapNode {
  /** "x,y" — globally unique key inside this map. */
  readonly key: string;
  readonly x: number;
  readonly y: number;

  /** Mutable: dead-end recovery can flip a node to combat_elite. */
  nodeType: NodeTypeId;

  /** Set on first event-bearing nodes during generation. */
  eventId?: EventId;
  /** Set on combat nodes during generation. */
  enemyGroupId?: EnemyGroupId;

  /** Open-ended bag for designer notes / per-node overrides. */
  meta?: Record<string, unknown>;
}

export interface EdgeState {
  /** edgeKey() output — canonical (sorted endpoint join). */
  readonly id: string;
  readonly nodeAKey: string;
  readonly nodeBKey: string;
  /** True once a player has traversed this edge. */
  consumed: boolean;
  /** Set true when dead-end recovery revives a previously-consumed edge. */
  revived?: boolean;
}

export interface MapState {
  readonly width: number;
  readonly height: number;

  /** key → node */
  readonly nodes: Record<string, MapNode>;
  /** edgeId → edge */
  readonly edges: Record<string, EdgeState>;

  currentNodeKey: string;
  /** Nodes whose event has fired (or whose initial type ran). */
  visitedNodeKeys: Set<string>;

  /** Seed used for generation. Save / load reproduces. */
  readonly rngSeed: string;
}

/**
 * MapGenParams — knobs for one map's procedural generation.
 * Sizing and ratios default at the call site; this type is the contract.
 */
export interface MapGenParams {
  readonly width: number;
  readonly height: number;
  /** Where the player spawns. Typically a corner / edge midpoint. */
  readonly startKey: string;
  /** The "rest hub" exit. Reaching this ends the run. */
  readonly restKey: string;
  /** Fraction of possible adjacency edges to retain. [0, 1]. */
  readonly edgeKeepRatio?: number;
  /** Weighted distribution of types for non-start, non-rest nodes. */
  readonly nodeDistribution: NodeDistribution;
  /** Seed string. Same seed + same params → same map. */
  readonly seed: string;
}

export interface NodeDistribution {
  readonly combat_normal: number;
  readonly combat_elite: number;
  readonly shop: number;
  readonly treasure: number;
  readonly event_normal: number;
  readonly event_trigger: number;
}

/**
 * Canonical edge id — deterministic regardless of argument order.
 * Used in both `EdgeState.id` and `MapState.edges` keys.
 */
export function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
