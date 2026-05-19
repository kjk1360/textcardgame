import type { CardDefId, CardPoolId } from './ids.js';
import type { PoolCondition } from './modifier.js';

/**
 * CardPool — weighted bag of CardDefIds. Used by cardOffer flow steps,
 * shop generation, transmute events, etc.
 *
 * Mirrors ModifierPool structurally — separate concept for type clarity.
 *
 * Doc: 04_event_flow_system.md §"카드 풀 (CardPool)"
 */

export interface CardPoolEntry {
  readonly cardDefId: CardDefId;
  readonly weight: number;
  readonly conditional?: PoolCondition;
}

export interface CardPool {
  readonly id: CardPoolId;
  readonly name: string;
  readonly entries: ReadonlyArray<CardPoolEntry>;
}

/** Registry abstraction — the engine never touches the concrete map shape. */
export interface CardPoolRegistry {
  get(id: CardPoolId): CardPool | undefined;
  has(id: CardPoolId): boolean;
}
