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

// All mod IDs are deliberately ordered alphabetically so the canonical
// sort matches the order in which they're listed here. This makes test
// expectations easier to reason about.

const modA_DamagePlus5: Modifier = {
  id: id<ModifierId>('mod_a_damage_plus_5'),
  name: '예리함',
  descriptionTemplate: '피해 +5.',
  tags: [],
  weight: 10,
  transforms: [
    { op: 'modifyEffect', match: { kind: 'damage' }, set: { amount: { delta: 5 } } },
  ],
};

const modB_DamageTimes2: Modifier = {
  id: id<ModifierId>('mod_b_damage_times_2'),
  name: '압도',
  descriptionTemplate: '피해 ×2.',
  tags: [],
  weight: 3,
  transforms: [
    { op: 'modifyEffect', match: { kind: 'damage' }, set: { amount: { mul: 2 } } },
  ],
};

const modC_DamageAbs8: Modifier = {
  id: id<ModifierId>('mod_c_damage_abs_8'),
  name: '고정 8',
  descriptionTemplate: '피해를 8로.',
  tags: [],
  weight: 1,
  transforms: [
    { op: 'modifyEffect', match: { kind: 'damage' }, set: { amount: 8 } },
  ],
};

const modD_DamageAbs15: Modifier = {
  id: id<ModifierId>('mod_d_damage_abs_15'),
  name: '고정 15',
  descriptionTemplate: '피해를 15로.',
  tags: [],
  weight: 1,
  transforms: [
    { op: 'modifyEffect', match: { kind: 'damage' }, set: { amount: 15 } },
  ],
};

const modE_TargetAll: Modifier = {
  id: id<ModifierId>('mod_e_target_all'),
  name: '확산',
  descriptionTemplate: '단일 → 전체.',
  tags: [],
  weight: 3,
  transforms: [
    { op: 'modifyEffect', match: { target: 'enemy' }, set: { target: 'allEnemies' } },
  ],
};

const modF_BleedOnHit: Modifier = {
  id: id<ModifierId>('mod_f_bleed_on_hit'),
  name: '출혈 부여',
  descriptionTemplate: '명중한 적에게 출혈(5).',
  tags: [],
  weight: 5,
  transforms: [
    {
      op: 'appendEffect',
      effect: { kind: 'applyStatus', status: id<StatusId>('bleed'), stacks: 5, target: 'enemy' },
    },
  ],
};

const modG_PrependBlock: Modifier = {
  id: id<ModifierId>('mod_g_prepend_block'),
  name: '선공 방어',
  descriptionTemplate: '카드 효과 전에 방어 5.',
  tags: [],
  weight: 1,
  transforms: [
    { op: 'prependEffect', effect: { kind: 'gainBlock', amount: 5 } },
  ],
};

const modH_WrapWeak: Modifier = {
  id: id<ModifierId>('mod_h_wrap_weak'),
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

const modI_RemoveDamage: Modifier = {
  id: id<ModifierId>('mod_i_remove_damage'),
  name: '평화주의',
  descriptionTemplate: '데미지 제거.',
  tags: [],
  weight: 1,
  transforms: [{ op: 'removeEffect', match: { kind: 'damage' } }],
};

const modJ_ReplaceDamageWithHeal: Modifier = {
  id: id<ModifierId>('mod_j_replace_damage_heal'),
  name: '회복으로 변환',
  descriptionTemplate: '데미지를 회복으로.',
  tags: [],
  weight: 1,
  transforms: [
    { op: 'replaceEffect', match: { kind: 'damage' }, with: { kind: 'gainHp', amount: 5 } },
  ],
};

const modK_Exhaust: Modifier = {
  id: id<ModifierId>('mod_k_exhaust'),
  name: '일회성',
  descriptionTemplate: '사용 시 소멸.',
  tags: [],
  weight: 1,
  transforms: [{ op: 'addKeyword', keyword: 'exhaust' }],
};

const modL_CostMinusOne: Modifier = {
  id: id<ModifierId>('mod_l_cost_minus_one'),
  name: '비용 -1',
  descriptionTemplate: '비용 -1.',
  tags: [],
  weight: 1,
  transforms: [{ op: 'modifyCost', delta: -1 }],
};

const modM_TradeDamageForBlock: Modifier = {
  id: id<ModifierId>('mod_m_trade_damage_for_block'),
  name: '방어 자세',
  descriptionTemplate: '피해 -5, 방어 +10.',
  tags: [],
  weight: 5,
  transforms: [
    { op: 'modifyEffect', match: { kind: 'damage' }, set: { amount: { delta: -5 } } },
    { op: 'appendEffect', effect: { kind: 'gainBlock', amount: 10 } },
  ],
};

const modN_RemoveExhaust: Modifier = {
  id: id<ModifierId>('mod_n_remove_exhaust'),
  name: '안 사라짐',
  descriptionTemplate: '소멸 제거.',
  tags: [],
  weight: 1,
  transforms: [{ op: 'removeKeyword', keyword: 'exhaust' }],
};

const allMods = [
  modA_DamagePlus5,
  modB_DamageTimes2,
  modC_DamageAbs8,
  modD_DamageAbs15,
  modE_TargetAll,
  modF_BleedOnHit,
  modG_PrependBlock,
  modH_WrapWeak,
  modI_RemoveDamage,
  modJ_ReplaceDamageWithHeal,
  modK_Exhaust,
  modL_CostMinusOne,
  modM_TradeDamageForBlock,
  modN_RemoveExhaust,
];

const modLookup: ModifierLookup = {
  get(id) {
    const m = allMods.find(m => m.id === id);
    if (!m) throw new Error(`Modifier not found: ${id}`);
    return m;
  },
};

function makeInstance(mods: Modifier[]): CardInstance {
  return {
    instanceId: id<CardInstanceId>('test-instance-1'),
    defId: daggerThrow.id,
    modifiers: mods.map(m => ({
      id: m.id,
      appliedAt: 0,
      source: { kind: 'starter' },
    })),
    acquired: { kind: 'starter' },
  };
}

// ---------- Tests ----------

describe('resolveCardEffects — basic', () => {
  it('returns base effects unchanged with no modifiers', () => {
    const r = resolveCardEffects(daggerThrow, makeInstance([]), modLookup);
    expect(r.effects).toEqual([{ kind: 'damage', amount: 10, target: 'enemy' }]);
    expect(r.cost).toEqual({ kind: 'fixed', value: 1 });
    expect(r.keywords).toEqual([]);
  });

  it('does not mutate base definition', () => {
    const original = structuredClone(daggerThrow.baseEffects);
    resolveCardEffects(daggerThrow, makeInstance([modA_DamagePlus5]), modLookup);
    expect(daggerThrow.baseEffects).toEqual(original);
  });
});

describe('numeric — abs / delta / mul accumulation', () => {
  it('delta adds', () => {
    const r = resolveCardEffects(daggerThrow, makeInstance([modA_DamagePlus5]), modLookup);
    expect(r.effects[0]).toMatchObject({ kind: 'damage', amount: 15 });
  });

  it('mul multiplies (floor)', () => {
    const r = resolveCardEffects(daggerThrow, makeInstance([modB_DamageTimes2]), modLookup);
    expect(r.effects[0]).toMatchObject({ kind: 'damage', amount: 20 });
  });

  it('abs replaces base', () => {
    const r = resolveCardEffects(daggerThrow, makeInstance([modC_DamageAbs8]), modLookup);
    expect(r.effects[0]).toMatchObject({ kind: 'damage', amount: 8 });
  });

  it('delta + mul together: (base + Σdelta) × Πmul', () => {
    // base 10 + 5 = 15, × 2 = 30
    const r = resolveCardEffects(
      daggerThrow,
      makeInstance([modA_DamagePlus5, modB_DamageTimes2]),
      modLookup,
    );
    expect(r.effects[0]).toMatchObject({ amount: 30 });
  });

  it('abs + delta + mul: (abs + Σdelta) × Πmul', () => {
    // abs 8 + delta 5 = 13, × 2 = 26
    const r = resolveCardEffects(
      daggerThrow,
      makeInstance([modA_DamagePlus5, modB_DamageTimes2, modC_DamageAbs8]),
      modLookup,
    );
    expect(r.effects[0]).toMatchObject({ amount: 26 });
  });

  it('multiple abs on same field: alphabetically-latest mod ID wins', () => {
    // modC sets abs=8, modD sets abs=15. modD has greater ID.
    const r = resolveCardEffects(
      daggerThrow,
      makeInstance([modC_DamageAbs8, modD_DamageAbs15]),
      modLookup,
    );
    expect(r.effects[0]).toMatchObject({ amount: 15 });
  });
});

describe('order independence — same SET produces same RESULT', () => {
  it('delta + mul — order swap', () => {
    const r1 = resolveCardEffects(
      daggerThrow,
      makeInstance([modA_DamagePlus5, modB_DamageTimes2]),
      modLookup,
    );
    const r2 = resolveCardEffects(
      daggerThrow,
      makeInstance([modB_DamageTimes2, modA_DamagePlus5]),
      modLookup,
    );
    expect(r1.effects).toEqual(r2.effects);
    expect(r1.cost).toEqual(r2.cost);
    expect(r1.keywords).toEqual(r2.keywords);
  });

  it('abs override — order swap', () => {
    // Regardless of attach order, alphabetic-max abs (modD) should win.
    const r1 = resolveCardEffects(
      daggerThrow,
      makeInstance([modC_DamageAbs8, modD_DamageAbs15]),
      modLookup,
    );
    const r2 = resolveCardEffects(
      daggerThrow,
      makeInstance([modD_DamageAbs15, modC_DamageAbs8]),
      modLookup,
    );
    expect(r1.effects).toEqual(r2.effects);
    expect(r1.effects[0]).toMatchObject({ amount: 15 });
  });

  it('append + prepend + modify — order swap', () => {
    const r1 = resolveCardEffects(
      daggerThrow,
      makeInstance([modA_DamagePlus5, modF_BleedOnHit, modG_PrependBlock]),
      modLookup,
    );
    const r2 = resolveCardEffects(
      daggerThrow,
      makeInstance([modG_PrependBlock, modF_BleedOnHit, modA_DamagePlus5]),
      modLookup,
    );
    expect(r1.effects).toEqual(r2.effects);
  });

  it('large modifier set — every permutation gives same result', () => {
    const mods = [
      modA_DamagePlus5,
      modB_DamageTimes2,
      modE_TargetAll,
      modF_BleedOnHit,
      modG_PrependBlock,
      modK_Exhaust,
      modL_CostMinusOne,
    ];
    const baseline = resolveCardEffects(daggerThrow, makeInstance(mods), modLookup);
    // Try several shuffles
    const shuffles: Modifier[][] = [
      [...mods].reverse(),
      [mods[3]!, mods[0]!, mods[6]!, mods[1]!, mods[5]!, mods[2]!, mods[4]!],
      [mods[6]!, mods[5]!, mods[4]!, mods[3]!, mods[2]!, mods[1]!, mods[0]!],
    ];
    for (const s of shuffles) {
      const r = resolveCardEffects(daggerThrow, makeInstance(s), modLookup);
      expect(r.effects).toEqual(baseline.effects);
      expect(r.cost).toEqual(baseline.cost);
      expect([...r.keywords].sort()).toEqual([...baseline.keywords].sort());
    }
  });
});

describe('non-numeric (target) field', () => {
  it('changes target from enemy to allEnemies', () => {
    const r = resolveCardEffects(daggerThrow, makeInstance([modE_TargetAll]), modLookup);
    expect(r.effects[0]).toMatchObject({ kind: 'damage', target: 'allEnemies' });
  });
});

describe('structural ops', () => {
  it('appendEffect adds to end', () => {
    const r = resolveCardEffects(daggerThrow, makeInstance([modF_BleedOnHit]), modLookup);
    expect(r.effects).toHaveLength(2);
    expect(r.effects[1]).toMatchObject({ kind: 'applyStatus', status: 'bleed', stacks: 5 });
  });

  it('prependEffect adds to start', () => {
    const r = resolveCardEffects(daggerThrow, makeInstance([modG_PrependBlock]), modLookup);
    expect(r.effects).toHaveLength(2);
    expect(r.effects[0]).toMatchObject({ kind: 'gainBlock', amount: 5 });
    expect(r.effects[1]).toMatchObject({ kind: 'damage' });
  });

  it('removeEffect strips matching', () => {
    const r = resolveCardEffects(daggerThrow, makeInstance([modI_RemoveDamage]), modLookup);
    expect(r.effects).toHaveLength(0);
  });

  it('replaceEffect swaps matching', () => {
    const r = resolveCardEffects(
      daggerThrow,
      makeInstance([modJ_ReplaceDamageWithHeal]),
      modLookup,
    );
    expect(r.effects).toHaveLength(1);
    expect(r.effects[0]).toMatchObject({ kind: 'gainHp', amount: 5 });
  });

  it('wrapEffect inserts before+after matched', () => {
    const r = resolveCardEffects(daggerThrow, makeInstance([modH_WrapWeak]), modLookup);
    expect(r.effects).toHaveLength(3);
    expect(r.effects[0]).toMatchObject({ kind: 'applyStatus', status: 'weak' });
    expect(r.effects[1]).toMatchObject({ kind: 'damage' });
    expect(r.effects[2]).toMatchObject({ kind: 'gainBlock', amount: 3 });
  });

  it('phase order: remove wins over replace (designer should use conflictsWith)', () => {
    // Both target damage. Remove (phase 2) runs before replace (phase 3).
    const r = resolveCardEffects(
      daggerThrow,
      makeInstance([modI_RemoveDamage, modJ_ReplaceDamageWithHeal]),
      modLookup,
    );
    expect(r.effects).toHaveLength(0);
  });
});

describe('cost', () => {
  it('subtracts cost via delta', () => {
    const r = resolveCardEffects(daggerThrow, makeInstance([modL_CostMinusOne]), modLookup);
    expect(r.cost).toEqual({ kind: 'fixed', value: 0 });
  });

  it('clamps cost to zero (no negative)', () => {
    const r = resolveCardEffects(
      daggerThrow,
      makeInstance([modL_CostMinusOne, modL_CostMinusOne]),
      modLookup,
    );
    expect(r.cost).toEqual({ kind: 'fixed', value: 0 });
  });
});

describe('keywords', () => {
  it('addKeyword adds', () => {
    const r = resolveCardEffects(daggerThrow, makeInstance([modK_Exhaust]), modLookup);
    expect(r.keywords).toContain('exhaust');
  });

  it('removeKeyword wins over addKeyword (regardless of order)', () => {
    const r1 = resolveCardEffects(
      daggerThrow,
      makeInstance([modK_Exhaust, modN_RemoveExhaust]),
      modLookup,
    );
    const r2 = resolveCardEffects(
      daggerThrow,
      makeInstance([modN_RemoveExhaust, modK_Exhaust]),
      modLookup,
    );
    expect(r1.keywords).not.toContain('exhaust');
    expect(r2.keywords).not.toContain('exhaust');
  });
});

describe('combined', () => {
  it('trade-damage-for-block: reduces damage and appends block', () => {
    const r = resolveCardEffects(
      daggerThrow,
      makeInstance([modM_TradeDamageForBlock]),
      modLookup,
    );
    expect(r.effects).toHaveLength(2);
    expect(r.effects[0]).toMatchObject({ kind: 'damage', amount: 5 });
    expect(r.effects[1]).toMatchObject({ kind: 'gainBlock', amount: 10 });
  });

  it('sharpness + spread + bleed', () => {
    const r = resolveCardEffects(
      daggerThrow,
      makeInstance([modA_DamagePlus5, modE_TargetAll, modF_BleedOnHit]),
      modLookup,
    );
    expect(r.effects).toHaveLength(2);
    expect(r.effects[0]).toMatchObject({
      kind: 'damage',
      amount: 15,
      target: 'allEnemies',
    });
    expect(r.effects[1]).toMatchObject({ kind: 'applyStatus', status: 'bleed', stacks: 5 });
  });
});

describe('bookkeeping', () => {
  it('modifierIdsApplied is sorted (canonical order)', () => {
    const r = resolveCardEffects(
      daggerThrow,
      makeInstance([modF_BleedOnHit, modA_DamagePlus5, modG_PrependBlock]),
      modLookup,
    );
    expect(r.modifierIdsApplied).toEqual([
      modA_DamagePlus5.id,
      modF_BleedOnHit.id,
      modG_PrependBlock.id,
    ]);
  });
});
