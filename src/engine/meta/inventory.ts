import type {
  CardDefId,
  CardDefinition,
  CardInstance,
  CardInstanceId,
  InventorySnapshot,
} from '../../types/index.js';
import {
  cardSellPrice,
  nextCapacityUpgrade,
  type CapacityUpgrade,
  DEFAULT_INVENTORY_UPGRADES,
} from './economy.js';

/**
 * Inventory management — shared global storage that survives character
 * death. Provides:
 *
 *   - add / remove by instance
 *   - sell (remove + convert to gold)
 *   - bulk sell (e.g., undeposited cards at "탐사 시작")
 *   - capacity upgrades (spends gold)
 *
 * Doc: 06_meta_progression.md §"차원 창고 (Shared Inventory)"
 *
 * Operates on a mutable holder shape. The MetaState passed in is
 * intentionally minimal — the SaveStore is the persistence layer; this
 * module is pure logic over in-memory state.
 */

export interface InventoryState {
  capacity: number;
  cards: CardInstance[];
}

export interface MetaState {
  gold: number;
  inventory: InventoryState;
}

export interface CardRegistry {
  get(id: CardDefId): CardDefinition;
}

// ====================================================================
// Basic operations
// ====================================================================

export type AddResult =
  | { ok: true }
  | { ok: false; reason: 'capacity-full'; capacity: number; used: number };

export function addCardToInventory(meta: MetaState, card: CardInstance): AddResult {
  if (meta.inventory.cards.length >= meta.inventory.capacity) {
    return {
      ok: false,
      reason: 'capacity-full',
      capacity: meta.inventory.capacity,
      used: meta.inventory.cards.length,
    };
  }
  meta.inventory.cards.push(card);
  return { ok: true };
}

/**
 * Remove and return a card by instance id (or undefined if missing).
 */
export function takeCardFromInventory(
  meta: MetaState,
  instanceId: CardInstanceId,
): CardInstance | undefined {
  const idx = meta.inventory.cards.findIndex(c => c.instanceId === instanceId);
  if (idx < 0) return undefined;
  return meta.inventory.cards.splice(idx, 1)[0];
}

export function hasCapacity(meta: MetaState): boolean {
  return meta.inventory.cards.length < meta.inventory.capacity;
}

export function snapshotInventory(meta: MetaState): InventorySnapshot {
  return { cards: [...meta.inventory.cards] };
}

// ====================================================================
// Sell
// ====================================================================

export interface SellResult {
  readonly instanceId: CardInstanceId;
  readonly goldGained: number;
}

export function sellCardFromInventory(
  meta: MetaState,
  instanceId: CardInstanceId,
  cards: CardRegistry,
): SellResult | null {
  const card = takeCardFromInventory(meta, instanceId);
  if (!card) return null;
  const price = cardSellPrice(card, cards.get(card.defId));
  meta.gold += price;
  return { instanceId, goldGained: price };
}

/**
 * Sell every card in `bundle` (typically the player's undeposited
 * run-end deck). Returns the per-card sale list AND adds total gold
 * to meta.
 *
 * Does not touch `meta.inventory` — these cards never made it there.
 */
export function bulkSellCards(
  meta: MetaState,
  bundle: ReadonlyArray<CardInstance>,
  cards: CardRegistry,
): { sold: SellResult[]; totalGold: number } {
  const sold: SellResult[] = [];
  let total = 0;
  for (const card of bundle) {
    const price = cardSellPrice(card, cards.get(card.defId));
    sold.push({ instanceId: card.instanceId, goldGained: price });
    total += price;
  }
  meta.gold += total;
  return { sold, totalGold: total };
}

// ====================================================================
// Capacity upgrades
// ====================================================================

export type UpgradeResult =
  | { ok: true; newCapacity: number; goldSpent: number }
  | { ok: false; reason: 'maxed' }
  | { ok: false; reason: 'insufficient-gold'; needed: number; have: number };

export function upgradeInventoryCapacity(
  meta: MetaState,
  table: ReadonlyArray<CapacityUpgrade> = DEFAULT_INVENTORY_UPGRADES,
): UpgradeResult {
  const next = nextCapacityUpgrade(meta.inventory.capacity, table);
  if (!next) return { ok: false, reason: 'maxed' };
  if (meta.gold < next.costGold) {
    return { ok: false, reason: 'insufficient-gold', needed: next.costGold, have: meta.gold };
  }
  meta.gold -= next.costGold;
  meta.inventory.capacity = next.toCapacity;
  return { ok: true, newCapacity: next.toCapacity, goldSpent: next.costGold };
}
