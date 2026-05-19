import { describe, expect, it } from 'vitest';
import { resolveCardEffects, type ModifierLookup } from './resolver.js';
import type {
  CardDefId,
  CardDefinition,
  CardInstance,
  CardInstanceId,
  Modifier,
  ModifierId,
  StatusId,
} from '../../types/index.js';

// ---------- Test fixtures ----------

const id = <T extends string>(s: string): T => s as T;

const daggerThrow: CardDefinition = {
  id: id<CardDefId>('dagger_throw'),
  name: '단검투척',
  cost: { kind: 'fixed', value: 1 },
  type: 'attack',
  target: { kind: 'enemy' },
  rarity: 'common',
  tags: [],
  keywords: [],
  baseDescription: '적에게 {damage}의 피해.',
  baseEffects: [
    { kind: 'damage', amount: 10, target: 'enemy' },
  ],
  modifierPoolRefs: [],
};

const modSharpness: Modifier = {
  id: id<ModifierId>('mod_sharpness'),
  name: '예리함',
  descriptionTemplate: '피해량 +5.',
  tags: [],
  weight: 10,
  transforms: [
    { op: 'modifyEffect', match: { kind: 'damage' }, set: { amount: { delta: 5 } } },
  ],
};

const modOverwhelm: Modifier = {
  id: id<ModifierId>('mod_overwhelm'),
  name: '압도',
  descriptionTemplate: '피해량 ×2.',
  tags: [],
  weight: 3,
  transforms: [
    { op: 'modifyEffect', match: { kind: 'damage' }, set: { amount: { mul: 2 } } },
  ],
};

const modAbsoluteEight: Modifier = {
  id: id<ModifierId>('mod_abs_8'),
  name: '고정 피해',
  descriptionTemplate: '피해량을 8로 고정.',
  tags: [],
  weight: 1,
  transforms: [
    { op: 'modifyEffect', match: { kind: 'damage' }, set: { amount: 8 } },
  ],
};

const modSpread: Modifier = {
  id: id<ModifierId>('mod_spread'),
  name: '확산',
  descriptionTemplate: '단일 → 전체.',
  tags: [],
  weight: 3,
  transforms: [
    { op: 'modifyEffect', match: { target: 'enemy' }, set: { target: 'allEnemies' } },
  ],
};

const modBleedOnHit: Modifier = {
  id: id<ModifierId>('mod_bleed_on_hit'),
  name: '출혈 부여',
  descriptionTemplate: '명중한 적에게 출혈(5).',
  tags: [],
  weight: 5,
  transforms: [
    {
      op: 'appendEffect',
      effect: {
        kind: 'applyStatus',
        status: id<StatusId>('bleed'),
        stacks: 5,
        target: 'enemy',
      },
    },
  ],
};

const modExhaust: Modifier = {
  id: id<ModifierId>('mod_exhaust'),
  name: '일회성',
  descriptionTemplate: '사용 시 소멸.',
  tags: [],
  weight: 1,
  transforms: [{ op: 'addKeyword', keyword: 'exhaust' }],
};

const modCostMinusOne: Modifier = {
  id: id<ModifierId>('mod_cost_minus_one'),
  name: '비용 감소',
  descriptionTemplate: '비용 -1.',
  tags: [],
  weight: 1,
  transforms: [{ op: 'modifyCost', delta: -1 }],
};

const modTradeDamageForBlock: Modifier = {
  id: id<ModifierId>('mod_trade_damage_for_block'),
  name: '방어 자세',
  descriptionTemplate: '피해 -5, 방어도 +10.',
  tags: [],
  weight: 5,
  transforms: [
    { op: 'modifyEffect', match: { kind: 'damage' }, set: { amount: { delta: -5 } } },
    { op: 'appendEffect', effect: { kind: 'gainBlock', amount: 10 } },
  ],
};

const modPrependBlock: Modifier = {
  id: id<ModifierId>('mod_prepend_block'),
  name: '선공 방어',
  descriptionTemplate: '카드 효과 전에 방어 5.',
  tags: [],
  weight: 1,
  transforms: [
    { op: 'prependEffect', effect: { kind: 'gainBlock', amount: 5 } },
  ],
};

const modWrapWeak: Modifier = {
  id: id<ModifierId>('mod_wrap_weak'),
  name: '약화 두름',
  descriptionTemplate: '데미지 전 약화, 후 방어.',
  tags: [],
  weight: 1,
  transforms: [
    {
      op: 'wrapEffect',
      match: { kind: 'damage' },
      before: { kind: 'applyStatus', status: id<StatusId>('weak'), stacks: 1, target: 'enemy' },
      after:  { kind: 'gainBlock', amount: 3 },
    },
  ],
};

const modRemoveDamage: Modifier = {
  id: id<ModifierId>('mod_remove_damage'),
  name: '평화주의',
  descriptionTemplate: '데미지 제거.',
  tags: [],
  weight: 1,
  transforms: [{ op: 'removeEffect', match: { kind: 'damage' } }],
};

const modReplaceDamageWithHeal: Modifier = {
  id: id<ModifierId>('mod_replace_damage_heal'),
  name: '회복으로 변환',
  descriptionTemplate: '데미지를 회복으로.',
  tags: [],
  weight: 1,
  transforms: [
    { op: 'replaceEffect', match: { kind: 'damage' }, with: { kind: 'gainHp', amount: 5 } },
  ],
};

// ---------- Registry ----------

const allMods = [
  modSharpness,
  modOverwhelm,
  modAbsoluteEight,
  modSpread,
  modBleedOnHit,
  modExhaust,
  modCostMinusOne,
  modTradeDamageForBlock,
  modPrependBlock,
  modWrapWeak,
  modRemoveDamage,
  modReplaceDamageWithHeal,
];

const modLookup: ModifierLookup = {
  get(id) {
    const m = allMods.find(m => m.id === id);
    if (!m) throw new Error(`Modifier not found: ${id}`);
    return m;
  },
};

// ---------- Helpers ----------

function makeInstance(modIds: ModifierId[]): CardInstance {
  return {
    instanceId: id<CardInstanceId>('test-instance-1'),
    defId: daggerThrow.id,
    modifiers: modIds.map(mid => ({
      id: mid,
      appliedAt: 0,
      source: { kind: 'starter' },
    })),
    acquired: { kind: 'starter' },
  };
}

// ---------- Tests ----------

describe('resolveCardEffects', () => {
  it('returns base effects unchanged when no modifiers', () => {
    const resolved = resolveCardEffects(daggerThrow, makeInstance([]), modLookup);

    expect(resolved.effects).toEqual([
      { kind: 'damage', amount: 10, target: 'enemy' },
    ]);
    expect(resolved.cost).toEqual({ kind: 'fixed', value: 1 });
    expect(resolved.keywords).toEqual([]);
    expect(resolved.modifierIdsApplied).toEqual([]);
  });

  it('does not mutate base definition (deep clone)', () => {
    const original = structuredClone(daggerThrow.baseEffects);
    resolveCardEffects(daggerThrow, makeInstance([modSharpness.id]), modLookup);
    expect(daggerThrow.baseEffects).toEqual(original);
  });

  describe('modifyEffect — numeric patches', () => {
    it('delta adds to current value', () => {
      const r = resolveCardEffects(daggerThrow, makeInstance([modSharpness.id]), modLookup);
      expect(r.effects[0]).toMatchObject({ kind: 'damage', amount: 15 });
    });

    it('mul multiplies and floors', () => {
      const r = resolveCardEffects(daggerThrow, makeInstance([modOverwhelm.id]), modLookup);
      expect(r.effects[0]).toMatchObject({ kind: 'damage', amount: 20 });
    });

    it('absolute number replaces', () => {
      const r = resolveCardEffects(daggerThrow, makeInstance([modAbsoluteEight.id]), modLookup);
      expect(r.effects[0]).toMatchObject({ kind: 'damage', amount: 8 });
    });

    it('sequential: delta then mul = (base+delta) * mul', () => {
      const r = resolveCardEffects(
        daggerThrow,
        makeInstance([modSharpness.id, modOverwhelm.id]),
        modLookup,
      );
      // 10 + 5 = 15, then *2 = 30
      expect(r.effects[0]).toMatchObject({ kind: 'damage', amount: 30 });
    });

    it('sequential: mul then delta = (base * mul) + delta', () => {
      const r = resolveCardEffects(
        daggerThrow,
        makeInstance([modOverwhelm.id, modSharpness.id]),
        modLookup,
      );
      // 10 * 2 = 20, then +5 = 25
      expect(r.effects[0]).toMatchObject({ kind: 'damage', amount: 25 });
    });

    it('sequential: abs overrides earlier modifiers', () => {
      const r = resolveCardEffects(
        daggerThrow,
        makeInstance([modSharpness.id, modOverwhelm.id, modAbsoluteEight.id]),
        modLookup,
      );
      // 10 → 15 → 30 → 8 (abs always wins as latest)
      expect(r.effects[0]).toMatchObject({ kind: 'damage', amount: 8 });
    });
  });

  describe('modifyEffect — non-numeric patches', () => {
    it('changes target from enemy to allEnemies', () => {
      const r = resolveCardEffects(daggerThrow, makeInstance([modSpread.id]), modLookup);
      expect(r.effects[0]).toMatchObject({ kind: 'damage', target: 'allEnemies' });
    });
  });

  describe('appendEffect / prependEffect', () => {
    it('appendEffect adds to end', () => {
      const r = resolveCardEffects(daggerThrow, makeInstance([modBleedOnHit.id]), modLookup);
      expect(r.effects).toHaveLength(2);
      expect(r.effects[0]).toMatchObject({ kind: 'damage' });
      expect(r.effects[1]).toMatchObject({ kind: 'applyStatus', status: 'bleed', stacks: 5 });
    });

    it('prependEffect adds to start', () => {
      const r = resolveCardEffects(daggerThrow, makeInstance([modPrependBlock.id]), modLookup);
      expect(r.effects).toHaveLength(2);
      expect(r.effects[0]).toMatchObject({ kind: 'gainBlock', amount: 5 });
      expect(r.effects[1]).toMatchObject({ kind: 'damage' });
    });
  });

  describe('removeEffect / replaceEffect', () => {
    it('removeEffect strips matching', () => {
      const r = resolveCardEffects(daggerThrow, makeInstance([modRemoveDamage.id]), modLookup);
      expect(r.effects).toHaveLength(0);
    });

    it('replaceEffect swaps matching', () => {
      const r = resolveCardEffects(
        daggerThrow,
        makeInstance([modReplaceDamageWithHeal.id]),
        modLookup,
      );
      expect(r.effects).toHaveLength(1);
      expect(r.effects[0]).toMatchObject({ kind: 'gainHp', amount: 5 });
    });
  });

  describe('wrapEffect', () => {
    it('inserts before and after matched effects', () => {
      const r = resolveCardEffects(daggerThrow, makeInstance([modWrapWeak.id]), modLookup);
      expect(r.effects).toHaveLength(3);
      expect(r.effects[0]).toMatchObject({ kind: 'applyStatus', status: 'weak' });
      expect(r.effects[1]).toMatchObject({ kind: 'damage' });
      expect(r.effects[2]).toMatchObject({ kind: 'gainBlock', amount: 3 });
    });
  });

  describe('modifyCost', () => {
    it('subtracts cost', () => {
      const r = resolveCardEffects(daggerThrow, makeInstance([modCostMinusOne.id]), modLookup);
      expect(r.cost).toEqual({ kind: 'fixed', value: 0 });
    });

    it('clamps cost to zero (no negative)', () => {
      // cost is 1, apply -1 twice
      const r = resolveCardEffects(
        daggerThrow,
        makeInstance([modCostMinusOne.id, modCostMinusOne.id]),
        modLookup,
      );
      expect(r.cost).toEqual({ kind: 'fixed', value: 0 });
    });
  });

  describe('addKeyword / removeKeyword', () => {
    it('adds keyword', () => {
      const r = resolveCardEffects(daggerThrow, makeInstance([modExhaust.id]), modLookup);
      expect(r.keywords).toContain('exhaust');
    });
  });

  describe('combined: trade damage for block', () => {
    it('reduces damage and appends block', () => {
      const r = resolveCardEffects(
        daggerThrow,
        makeInstance([modTradeDamageForBlock.id]),
        modLookup,
      );
      expect(r.effects).toHaveLength(2);
      expect(r.effects[0]).toMatchObject({ kind: 'damage', amount: 5 }); // 10 - 5
      expect(r.effects[1]).toMatchObject({ kind: 'gainBlock', amount: 10 });
    });
  });

  describe('combined: sharpness + spread + bleed', () => {
    it('all transforms applied correctly', () => {
      const r = resolveCardEffects(
        daggerThrow,
        makeInstance([modSharpness.id, modSpread.id, modBleedOnHit.id]),
        modLookup,
      );
      expect(r.effects).toHaveLength(2);
      expect(r.effects[0]).toMatchObject({
        kind: 'damage',
        amount: 15,           // 10 + 5
        target: 'allEnemies', // changed by spread
      });
      expect(r.effects[1]).toMatchObject({
        kind: 'applyStatus',
        status: 'bleed',
        stacks: 5,
      });
    });
  });

  describe('modifierIdsApplied bookkeeping', () => {
    it('lists all applied modifier IDs in order', () => {
      const r = resolveCardEffects(
        daggerThrow,
        makeInstance([modSharpness.id, modBleedOnHit.id]),
        modLookup,
      );
      expect(r.modifierIdsApplied).toEqual([modSharpness.id, modBleedOnHit.id]);
    });
  });
});
