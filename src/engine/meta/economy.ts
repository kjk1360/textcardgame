import type { CardDefinition, CardInstance, Rarity } from '../../types/index.js';

/**
 * Economy — sell prices, inventory capacity upgrade ladder, and other
 * pure number tables.
 *
 * Doc: 06_meta_progression.md
 *
 * Defaults here mirror what's currently in the design doc. In Phase 4
 * they migrate to `authoring/economy/*.yaml` and become data-driven.
 * Migration note: docs/migration/01_ts_to_excel.md.
 */

// ====================================================================
// Sell pricing
// ====================================================================

const RARITY_BASE: Record<Rarity, number> = {
  common:    10,
  rare:      40,
  legendary: 100,
};

/** Per-modifier bonus added to base price. */
const PER_MODIFIER_BONUS = 8;

/**
 * Compute the gold a card sells for. Includes a flat bonus per attached
 * modifier (so heavily-upgraded cards are worth more — incentivizes
 * inventory management over hoarding).
 */
export function cardSellPrice(card: CardInstance, def: CardDefinition): number {
  return RARITY_BASE[def.rarity] + card.modifiers.length * PER_MODIFIER_BONUS;
}

// ====================================================================
// Inventory capacity upgrades
// ====================================================================

export interface CapacityUpgrade {
  readonly fromCapacity: number;
  readonly toCapacity: number;
  readonly costGold: number;
}

export const DEFAULT_INVENTORY_UPGRADES: ReadonlyArray<CapacityUpgrade> = [
  { fromCapacity: 20, toCapacity: 25,  costGold: 100 },
  { fromCapacity: 25, toCapacity: 30,  costGold: 250 },
  { fromCapacity: 30, toCapacity: 40,  costGold: 500 },
  { fromCapacity: 40, toCapacity: 55,  costGold: 1200 },
  { fromCapacity: 55, toCapacity: 75,  costGold: 2500 },
  { fromCapacity: 75, toCapacity: 100, costGold: 5000 },
];

/**
 * The next available upgrade for the given current capacity (or null if
 * at the top of the table).
 */
export function nextCapacityUpgrade(
  currentCapacity: number,
  table: ReadonlyArray<CapacityUpgrade> = DEFAULT_INVENTORY_UPGRADES,
): CapacityUpgrade | null {
  return table.find(u => u.fromCapacity === currentCapacity) ?? null;
}
