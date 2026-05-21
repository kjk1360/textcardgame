import { describe, expect, it } from 'vitest';
import {
  cardSellPrice,
  DEFAULT_INVENTORY_UPGRADES,
  nextCapacityUpgrade,
} from './economy.js';
import {
  addCardToInventory,
  bulkSellCards,
  hasCapacity,
  sellCardFromInventory,
  snapshotInventory,
  takeCardFromInventory,
  upgradeInventoryCapacity,
  type MetaState,
} from './inventory.js';
import {
  affordableGrades,
  cheapestAffordableGrade,
  makeSkillBoxRegistry,
  purchaseSkillBox,
  type SkillBoxDefinition,
} from './skill-box.js';
import { makeRng } from '../rng.js';
import type {
  CardDefId,
  CardDefinition,
  CardInstance,
  CardInstanceId,
  SkillId,
} from '../../types/index.js';

const id = <T extends string>(s: string): T => s as T;

// ---------- Fixtures ----------

function makeCardDef(idStr: string, rarity: CardDefinition['rarity']): CardDefinition {
  return {
    id: id<CardDefId>(idStr),
    name: idStr,
    cost: { kind: 'fixed', value: 1 },
    type: 'attack',
    target: { kind: 'enemy' },
    rarity,
    tags: [],
    keywords: [],
    baseDescription: '',
    baseEffects: [],
    modifierPoolRefs: [],
  };
}

function makeCardInstance(defId: string, modCount: number = 0): CardInstance {
  return {
    instanceId: id<CardInstanceId>(`i-${defId}-${Math.random()}`),
    defId: id<CardDefId>(defId),
    modifiers: Array.from({ length: modCount }, (_, i) => ({
      id: id<any>(`m${i}`),
      appliedAt: 0,
      source: { kind: 'starter' },
    })),
    acquired: { kind: 'starter' },
  };
}

// 3-grade rarity table (common / rare / legendary). Base sell prices
// per `engine/meta/economy.ts`: 10 / 40 / 100.
const cardRegistry = {
  defs: new Map<CardDefId, CardDefinition>([
    [id<CardDefId>('strike'),       makeCardDef('strike', 'common')],
    [id<CardDefId>('common-1'),     makeCardDef('common-1', 'common')],
    [id<CardDefId>('rare-1'),       makeCardDef('rare-1', 'rare')],
    [id<CardDefId>('legendary-1'),  makeCardDef('legendary-1', 'legendary')],
  ]),
  get(cid: CardDefId) {
    const c = this.defs.get(cid);
    if (!c) throw new Error('card not found: ' + cid);
    return c;
  },
};

function makeMeta(opts: { gold?: number; capacity?: number; cards?: CardInstance[] } = {}): MetaState {
  return {
    gold: opts.gold ?? 0,
    inventory: {
      capacity: opts.capacity ?? 20,
      cards: opts.cards ?? [],
    },
  };
}

// ====================================================================
// economy
// ====================================================================

describe('economy: cardSellPrice', () => {
  it('rarity base values', () => {
    const cases: Array<[string, number]> = [
      ['common-1',    10],
      ['rare-1',      40],
      ['legendary-1', 100],
    ];
    for (const [defId, expected] of cases) {
      const card = makeCardInstance(defId);
      expect(cardSellPrice(card, cardRegistry.get(id<CardDefId>(defId)))).toBe(expected);
    }
  });

  it('per-modifier bonus stacks (+8 each)', () => {
    const c1 = makeCardInstance('rare-1', 1);
    expect(cardSellPrice(c1, cardRegistry.get(id<CardDefId>('rare-1')))).toBe(40 + 8);
    const c3 = makeCardInstance('rare-1', 3);
    expect(cardSellPrice(c3, cardRegistry.get(id<CardDefId>('rare-1')))).toBe(40 + 24);
  });
});

describe('economy: nextCapacityUpgrade', () => {
  it('returns next upgrade entry', () => {
    expect(nextCapacityUpgrade(20)).toMatchObject({ toCapacity: 25, costGold: 100 });
    expect(nextCapacityUpgrade(40)).toMatchObject({ toCapacity: 55, costGold: 1200 });
  });

  it('returns null at top of ladder', () => {
    const top = DEFAULT_INVENTORY_UPGRADES[DEFAULT_INVENTORY_UPGRADES.length - 1]!.toCapacity;
    expect(nextCapacityUpgrade(top)).toBeNull();
  });

  it('returns null for unknown intermediate capacity', () => {
    expect(nextCapacityUpgrade(23)).toBeNull(); // 23 isn't in fromCapacity column
  });
});

// ====================================================================
// inventory
// ====================================================================

describe('inventory: add / take / hasCapacity', () => {
  it('addCardToInventory under capacity → ok', () => {
    const meta = makeMeta({ capacity: 3 });
    const card = makeCardInstance('strike');
    expect(addCardToInventory(meta, card)).toEqual({ ok: true });
    expect(meta.inventory.cards).toContain(card);
  });

  it('addCardToInventory at capacity → rejected', () => {
    const meta = makeMeta({ capacity: 2, cards: [makeCardInstance('strike'), makeCardInstance('strike')] });
    const r = addCardToInventory(meta, makeCardInstance('strike'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('capacity-full');
    expect(meta.inventory.cards).toHaveLength(2);
  });

  it('takeCardFromInventory removes and returns', () => {
    const target = makeCardInstance('strike');
    const meta = makeMeta({ cards: [makeCardInstance('strike'), target, makeCardInstance('strike')] });
    const taken = takeCardFromInventory(meta, target.instanceId);
    expect(taken).toBe(target);
    expect(meta.inventory.cards).toHaveLength(2);
    expect(meta.inventory.cards).not.toContain(target);
  });

  it('takeCardFromInventory missing → undefined', () => {
    const meta = makeMeta();
    expect(takeCardFromInventory(meta, id<CardInstanceId>('nope'))).toBeUndefined();
  });

  it('hasCapacity reflects current load', () => {
    const meta = makeMeta({ capacity: 1 });
    expect(hasCapacity(meta)).toBe(true);
    addCardToInventory(meta, makeCardInstance('strike'));
    expect(hasCapacity(meta)).toBe(false);
  });

  it('snapshotInventory returns a copy (different array reference)', () => {
    const meta = makeMeta({ cards: [makeCardInstance('strike')] });
    const snap = snapshotInventory(meta);
    expect(snap.cards).not.toBe(meta.inventory.cards);
    expect(snap.cards).toEqual(meta.inventory.cards);
  });
});

describe('inventory: sell', () => {
  it('sellCardFromInventory removes and credits gold', () => {
    const card = makeCardInstance('rare-1', 1);
    const meta = makeMeta({ gold: 0, cards: [card] });
    const r = sellCardFromInventory(meta, card.instanceId, cardRegistry);
    expect(r).not.toBeNull();
    expect(r!.goldGained).toBe(40 + 8);
    expect(meta.gold).toBe(48);
    expect(meta.inventory.cards).toHaveLength(0);
  });

  it('sellCardFromInventory missing card → null, no gold change', () => {
    const meta = makeMeta({ gold: 100 });
    const r = sellCardFromInventory(meta, id<CardInstanceId>('nope'), cardRegistry);
    expect(r).toBeNull();
    expect(meta.gold).toBe(100);
  });

  it('bulkSellCards processes bundle, credits sum', () => {
    const bundle = [
      makeCardInstance('strike', 0),       // common 10 + 0 = 10
      makeCardInstance('common-1', 2),     // common 10 + 16 = 26
      makeCardInstance('rare-1', 1),       // rare 40 + 8 = 48
    ];
    const meta = makeMeta({ gold: 0 });
    const r = bulkSellCards(meta, bundle, cardRegistry);
    expect(r.sold).toHaveLength(3);
    expect(r.totalGold).toBe(10 + 26 + 48);
    expect(meta.gold).toBe(84);
    // bundle isn't in inventory, so inventory unchanged
    expect(meta.inventory.cards).toHaveLength(0);
  });
});

describe('inventory: upgradeInventoryCapacity', () => {
  it('upgrades when affordable', () => {
    const meta = makeMeta({ gold: 200, capacity: 20 });
    const r = upgradeInventoryCapacity(meta);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.newCapacity).toBe(25);
      expect(r.goldSpent).toBe(100);
    }
    expect(meta.inventory.capacity).toBe(25);
    expect(meta.gold).toBe(100);
  });

  it('rejects when insufficient gold', () => {
    const meta = makeMeta({ gold: 50, capacity: 20 });
    const r = upgradeInventoryCapacity(meta);
    expect(r.ok).toBe(false);
    if (!r.ok && 'needed' in r) {
      expect(r.reason).toBe('insufficient-gold');
      expect(r.needed).toBe(100);
      expect(r.have).toBe(50);
    }
    expect(meta.inventory.capacity).toBe(20);
    expect(meta.gold).toBe(50);
  });

  it('rejects when at top of ladder', () => {
    const top = DEFAULT_INVENTORY_UPGRADES[DEFAULT_INVENTORY_UPGRADES.length - 1]!.toCapacity;
    const meta = makeMeta({ gold: 1000000, capacity: top });
    const r = upgradeInventoryCapacity(meta);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('maxed');
  });
});

// ====================================================================
// skill box
// ====================================================================

describe('skill box', () => {
  // 3-grade ladder; same prices as the (former) 5-grade test, just
  // mapped down to the new grades.
  const boxes: SkillBoxDefinition[] = [
    {
      grade: 'common', priceGold: 50,
      entries: [
        { skillId: id<SkillId>('s_c1'), weight: 1 },
        { skillId: id<SkillId>('s_c2'), weight: 1 },
      ],
    },
    {
      grade: 'rare', priceGold: 400,
      entries: [{ skillId: id<SkillId>('s_rare'), weight: 1 }],
    },
    {
      grade: 'legendary', priceGold: 1000,
      entries: [{ skillId: id<SkillId>('s_legendary'), weight: 1 }],
    },
  ];
  const registry = makeSkillBoxRegistry(boxes);

  it('affordableGrades — empty when broke', () => {
    const meta = makeMeta({ gold: 10 });
    expect(affordableGrades(meta, registry)).toEqual([]);
  });

  it('affordableGrades — includes everything affordable', () => {
    const meta = makeMeta({ gold: 500 });
    const a = affordableGrades(meta, registry).sort();
    expect(a).toEqual(['common', 'rare'].sort());
  });

  it('cheapestAffordableGrade picks the cheapest', () => {
    expect(cheapestAffordableGrade(makeMeta({ gold: 10 }), registry)).toBeNull();
    expect(cheapestAffordableGrade(makeMeta({ gold: 100 }), registry)).toBe('common');
    expect(cheapestAffordableGrade(makeMeta({ gold: 999999 }), registry)).toBe('common');
  });

  it('purchaseSkillBox: success → returns skill + deducts gold', () => {
    const meta = makeMeta({ gold: 500 });
    const r = purchaseSkillBox(meta, 'rare', registry, makeRng('p'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.skillId).toBe('s_rare');
      expect(r.goldSpent).toBe(400);
    }
    expect(meta.gold).toBe(100);
  });

  it('purchaseSkillBox: unknown grade', () => {
    const meta = makeMeta({ gold: 10000 });
    const r = purchaseSkillBox(meta, 'wat' as any, registry, makeRng('u'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unknown-grade');
  });

  it('purchaseSkillBox: insufficient gold', () => {
    const meta = makeMeta({ gold: 30 });
    const r = purchaseSkillBox(meta, 'common', registry, makeRng('i'));
    expect(r.ok).toBe(false);
    if (!r.ok && 'needed' in r) {
      expect(r.reason).toBe('insufficient-gold');
      expect(r.needed).toBe(50);
      expect(r.have).toBe(30);
    }
    expect(meta.gold).toBe(30); // no deduction
  });

  it('purchaseSkillBox: empty pool', () => {
    const empty = makeSkillBoxRegistry([{ grade: 'common', priceGold: 10, entries: [] }]);
    const meta = makeMeta({ gold: 100 });
    const r = purchaseSkillBox(meta, 'common', empty, makeRng('e'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('empty-pool');
    expect(meta.gold).toBe(100); // no deduction
  });

  it('purchaseSkillBox: weighted distribution over many trials', () => {
    const weighted = makeSkillBoxRegistry([
      {
        grade: 'common', priceGold: 0,
        entries: [
          { skillId: id<SkillId>('common_skill'), weight: 10 },
          { skillId: id<SkillId>('rare_skill'),   weight: 1 },
        ],
      },
    ]);
    let common = 0, rare = 0;
    for (let i = 0; i < 200; i++) {
      const meta = makeMeta({ gold: 100 });
      const r = purchaseSkillBox(meta, 'common', weighted, makeRng(`t-${i}`));
      if (r.ok) {
        if (r.skillId === 'common_skill') common++;
        else rare++;
      }
    }
    // ~91% common
    expect(common).toBeGreaterThan(rare * 3);
  });
});

// ====================================================================
// Integration: rest hub flow
// ====================================================================

describe('integration: rest hub workflow', () => {
  it('return from dungeon → sell undeposited → buy upgrade → buy skill', () => {
    const meta = makeMeta({ gold: 0, capacity: 20 });
    const undeposited = [
      makeCardInstance('common-1', 0),    // common 10
      makeCardInstance('common-1', 1),    // common 10 + 8 = 18
      makeCardInstance('rare-1', 2),      // rare 40 + 16 = 56
      makeCardInstance('legendary-1', 0), // legendary 100
      makeCardInstance('legendary-1', 1), // legendary 100 + 8 = 108
    ];
    // Decision: keep nothing, sell all
    bulkSellCards(meta, undeposited, cardRegistry);
    expect(meta.gold).toBe(10 + 18 + 56 + 100 + 108);

    // Upgrade capacity
    const up = upgradeInventoryCapacity(meta);
    expect(up.ok).toBe(true);
    expect(meta.inventory.capacity).toBe(25);

    // Buy common skill box
    const boxes = makeSkillBoxRegistry([
      { grade: 'common', priceGold: 50, entries: [{ skillId: id<SkillId>('starter_skill'), weight: 1 }] },
    ]);
    const buy = purchaseSkillBox(meta, 'common', boxes, makeRng('buy'));
    expect(buy.ok).toBe(true);
    if (buy.ok) expect(buy.skillId).toBe('starter_skill');
    // 292 - 100 (upgrade) - 50 (skill) = 142
    expect(meta.gold).toBe(142);
  });
});
