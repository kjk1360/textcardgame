import { describe, expect, it } from 'vitest';
import { makeRng } from '../rng.js';
import {
  evalPoolCondition,
  isCompatibleWithAttached,
  resolvePoolIds,
  sampleModifierUpgrades,
  weightedSampleWithoutReplacement,
  type PoolLookup,
  type PoolSampleContext,
} from './sampler.js';
import type { ModifierLookup } from './resolver.js';
import type {
  CardDefId,
  CardDefinition,
  CardInstance,
  CardInstanceId,
  EffectTag,
  Modifier,
  ModifierId,
  ModifierPool,
  ModifierPoolId,
} from '../../types/index.js';

const id = <T extends string>(s: string): T => s as T;

// ---------- Fixtures ----------

function mod(opts: {
  id: string;
  weight?: number;
  conflictsWith?: string[];
  requires?: string[];
  tags?: string[];
}): Modifier {
  return {
    id: id<ModifierId>(opts.id),
    name: opts.id,
    descriptionTemplate: '',
    tags: (opts.tags ?? []).map(t => id<EffectTag>(t)),
    weight: opts.weight ?? 1,
    conflictsWith: opts.conflictsWith?.map(c => id<ModifierId>(c)),
    requires: opts.requires?.map(r => id<ModifierId>(r)),
    transforms: [],
  };
}

function pool(opts: {
  id: string;
  entries: Array<{ modifierId: string; weight: number; conditional?: import('../../types/index.js').PoolCondition }>;
}): ModifierPool {
  return {
    id: id<ModifierPoolId>(opts.id),
    name: opts.id,
    entries: opts.entries.map(e => ({
      modifierId: id<ModifierId>(e.modifierId),
      weight: e.weight,
      conditional: e.conditional,
    })),
  };
}

function cardDef(opts: {
  id: string;
  poolRefs: string[];
  tags?: string[];
  maxModifiers?: number;
}): CardDefinition {
  return {
    id: id<CardDefId>(opts.id),
    name: opts.id,
    cost: { kind: 'fixed', value: 1 },
    type: 'attack',
    target: { kind: 'enemy' },
    rarity: 'common',
    tags: (opts.tags ?? []).map(t => id<EffectTag>(t)),
    keywords: [],
    baseDescription: '',
    baseEffects: [{ kind: 'damage', amount: 10, target: 'enemy' }],
    modifierPoolRefs: opts.poolRefs.map(p => id<ModifierPoolId>(p)),
    maxModifiers: opts.maxModifiers,
  };
}

function instance(defIdStr: string, attached: string[]): CardInstance {
  return {
    instanceId: id<CardInstanceId>('inst-1'),
    defId: id<CardDefId>(defIdStr),
    modifiers: attached.map(a => ({
      id: id<ModifierId>(a),
      appliedAt: 0,
      source: { kind: 'starter' },
    })),
    acquired: { kind: 'starter' },
  };
}

function makeLookups(modList: Modifier[], poolList: ModifierPool[]): {
  modifiers: ModifierLookup;
  pools: PoolLookup;
} {
  return {
    modifiers: {
      get(mid) {
        const m = modList.find(x => x.id === mid);
        if (!m) throw new Error(`Modifier not found: ${mid}`);
        return m;
      },
    },
    pools: {
      get(pid) {
        const p = poolList.find(x => x.id === pid);
        if (!p) throw new Error(`Pool not found: ${pid}`);
        return p;
      },
    },
  };
}

// ---------- weightedSampleWithoutReplacement ----------

describe('weightedSampleWithoutReplacement', () => {
  it('picks the requested count when pool is large enough', () => {
    const rng = makeRng('w-1');
    const entries = [
      { id: id<ModifierId>('a'), weight: 1 },
      { id: id<ModifierId>('b'), weight: 1 },
      { id: id<ModifierId>('c'), weight: 1 },
      { id: id<ModifierId>('d'), weight: 1 },
    ];
    const picked = weightedSampleWithoutReplacement(entries, 3, rng);
    expect(picked).toHaveLength(3);
    expect(new Set(picked).size).toBe(3);
  });

  it('returns fewer when pool is smaller than count', () => {
    const rng = makeRng('w-2');
    const entries = [{ id: id<ModifierId>('a'), weight: 1 }];
    const picked = weightedSampleWithoutReplacement(entries, 5, rng);
    expect(picked).toEqual([id<ModifierId>('a')]);
  });

  it('returns empty for empty pool', () => {
    const rng = makeRng('w-3');
    expect(weightedSampleWithoutReplacement([], 3, rng)).toEqual([]);
  });

  it('is deterministic for the same seed', () => {
    const entries = [
      { id: id<ModifierId>('a'), weight: 1 },
      { id: id<ModifierId>('b'), weight: 2 },
      { id: id<ModifierId>('c'), weight: 3 },
      { id: id<ModifierId>('d'), weight: 4 },
    ];
    const r1 = weightedSampleWithoutReplacement(entries, 4, makeRng('det'));
    const r2 = weightedSampleWithoutReplacement(entries, 4, makeRng('det'));
    expect(r1).toEqual(r2);
  });
});

// ---------- resolvePoolIds ----------

describe('resolvePoolIds', () => {
  it('returns base when no override', () => {
    const base = [id<ModifierPoolId>('a'), id<ModifierPoolId>('b')];
    expect(resolvePoolIds(base)).toEqual(base);
  });

  it('removes overridden pools', () => {
    const base = [id<ModifierPoolId>('a'), id<ModifierPoolId>('b'), id<ModifierPoolId>('c')];
    const out = resolvePoolIds(base, { remove: [id<ModifierPoolId>('b')] });
    expect(out).toEqual([id<ModifierPoolId>('a'), id<ModifierPoolId>('c')]);
  });

  it('adds overridden pools (dedup)', () => {
    const base = [id<ModifierPoolId>('a')];
    const out = resolvePoolIds(base, { add: [id<ModifierPoolId>('a'), id<ModifierPoolId>('b')] });
    expect(out.sort()).toEqual([id<ModifierPoolId>('a'), id<ModifierPoolId>('b')]);
  });

  it('remove then add allows re-adding', () => {
    const base = [id<ModifierPoolId>('a')];
    const out = resolvePoolIds(base, {
      remove: [id<ModifierPoolId>('a')],
      add: [id<ModifierPoolId>('a')],
    });
    expect(out).toEqual([id<ModifierPoolId>('a')]);
  });
});

// ---------- isCompatibleWithAttached ----------

describe('isCompatibleWithAttached', () => {
  it('compatible when no constraints', () => {
    const m = mod({ id: 'm' });
    expect(isCompatibleWithAttached(m, new Set())).toBe(true);
  });

  it('rejects conflictsWith match', () => {
    const m = mod({ id: 'm', conflictsWith: ['x'] });
    const attached = new Set([id<ModifierId>('x')]);
    expect(isCompatibleWithAttached(m, attached)).toBe(false);
  });

  it('rejects when required missing', () => {
    const m = mod({ id: 'm', requires: ['x'] });
    expect(isCompatibleWithAttached(m, new Set())).toBe(false);
  });

  it('accepts when required present', () => {
    const m = mod({ id: 'm', requires: ['x'] });
    const attached = new Set([id<ModifierId>('x')]);
    expect(isCompatibleWithAttached(m, attached)).toBe(true);
  });
});

// ---------- evalPoolCondition ----------

describe('evalPoolCondition', () => {
  const baseCtx = (def: CardDefinition, level?: number): PoolSampleContext => ({
    cardDef: def,
    difficultyLevel: level,
  });

  it('hasTag matches card tags', () => {
    const def = cardDef({ id: 'c', poolRefs: [], tags: ['physical'] });
    expect(evalPoolCondition({ kind: 'hasTag', tag: id<EffectTag>('physical') }, baseCtx(def))).toBe(true);
    expect(evalPoolCondition({ kind: 'hasTag', tag: id<EffectTag>('holy') }, baseCtx(def))).toBe(false);
  });

  it('minLevel against difficulty', () => {
    const def = cardDef({ id: 'c', poolRefs: [] });
    expect(evalPoolCondition({ kind: 'minLevel', level: 3 }, baseCtx(def, 5))).toBe(true);
    expect(evalPoolCondition({ kind: 'minLevel', level: 3 }, baseCtx(def, 2))).toBe(false);
    expect(evalPoolCondition({ kind: 'minLevel', level: 1 }, baseCtx(def))).toBe(false); // undefined → 0
  });

  it('custom predicate via registry', () => {
    const def = cardDef({ id: 'c', poolRefs: [] });
    const preds = new Map<string, (p: any, c: PoolSampleContext) => boolean>([
      ['always_true', () => true],
      ['always_false', () => false],
    ]);
    const ctx: PoolSampleContext = { cardDef: def, customPredicates: preds };
    expect(evalPoolCondition({ kind: 'custom', predicateId: 'always_true' }, ctx)).toBe(true);
    expect(evalPoolCondition({ kind: 'custom', predicateId: 'always_false' }, ctx)).toBe(false);
  });

  it('custom predicate missing → throws', () => {
    const def = cardDef({ id: 'c', poolRefs: [] });
    const ctx: PoolSampleContext = { cardDef: def };
    expect(() =>
      evalPoolCondition({ kind: 'custom', predicateId: 'missing' }, ctx),
    ).toThrow(/Custom pool predicate not registered/);
  });
});

// ---------- sampleModifierUpgrades (integration) ----------

describe('sampleModifierUpgrades', () => {
  const mA = mod({ id: 'mod_a', weight: 10 });
  const mB = mod({ id: 'mod_b', weight: 5 });
  const mC = mod({ id: 'mod_c', weight: 3 });
  const mD = mod({ id: 'mod_d', weight: 1, conflictsWith: ['mod_a'] });
  const mE = mod({ id: 'mod_e', weight: 1, requires: ['mod_a'] });
  const mF = mod({ id: 'mod_f', weight: 2 });

  const poolP = pool({
    id: 'pool_p',
    entries: [
      { modifierId: 'mod_a', weight: 10 },
      { modifierId: 'mod_b', weight: 5 },
      { modifierId: 'mod_c', weight: 3 },
    ],
  });
  const poolQ = pool({
    id: 'pool_q',
    entries: [
      { modifierId: 'mod_b', weight: 4 },
      { modifierId: 'mod_d', weight: 2 },
      { modifierId: 'mod_e', weight: 1 },
    ],
  });
  const poolEvent = pool({
    id: 'pool_event_only',
    entries: [{ modifierId: 'mod_f', weight: 10 }],
  });

  const card = cardDef({ id: 'c', poolRefs: ['pool_p', 'pool_q'], tags: ['physical'] });

  const lookups = makeLookups([mA, mB, mC, mD, mE, mF], [poolP, poolQ, poolEvent]);
  const ctx: PoolSampleContext = { cardDef: card };

  it('samples from declared pools only', () => {
    const inst = instance('c', []);
    const picked = sampleModifierUpgrades(inst, 3, lookups.pools, lookups.modifiers, ctx, makeRng('s-1'));
    // All picks must be in pool_p ∪ pool_q (mod_a..e); mod_f never picked
    for (const p of picked) {
      expect([mA.id, mB.id, mC.id, mD.id, mE.id]).toContain(p);
    }
  });

  it('event override.add introduces extra pool', () => {
    const inst = instance('c', []);
    // With high enough weight (10) mod_f should appear if we sample many times
    let sawF = false;
    for (let trial = 0; trial < 30; trial++) {
      const picked = sampleModifierUpgrades(
        inst, 1, lookups.pools, lookups.modifiers, ctx, makeRng(`evt-${trial}`),
        { add: [id<ModifierPoolId>('pool_event_only')] },
      );
      if (picked.includes(mF.id)) { sawF = true; break; }
    }
    expect(sawF).toBe(true);
  });

  it('event override.remove suppresses a pool', () => {
    const inst = instance('c', []);
    const picked = sampleModifierUpgrades(
      inst, 5, lookups.pools, lookups.modifiers, ctx, makeRng('s-rem'),
      { remove: [id<ModifierPoolId>('pool_q')] },
    );
    // Only pool_p remains; mod_d / mod_e (only in pool_q) should not appear
    expect(picked).not.toContain(mD.id);
    expect(picked).not.toContain(mE.id);
  });

  it('already-attached modifiers excluded', () => {
    const inst = instance('c', ['mod_a']);
    const picked = sampleModifierUpgrades(
      inst, 5, lookups.pools, lookups.modifiers, ctx, makeRng('s-attached'),
    );
    expect(picked).not.toContain(mA.id);
  });

  it('conflictsWith excluded', () => {
    // mod_d conflicts with mod_a. Attach mod_a → mod_d not offered.
    const inst = instance('c', ['mod_a']);
    const picked = sampleModifierUpgrades(
      inst, 5, lookups.pools, lookups.modifiers, ctx, makeRng('s-conf'),
    );
    expect(picked).not.toContain(mD.id);
  });

  it('requires unmet excluded', () => {
    // mod_e requires mod_a. Without mod_a attached, mod_e not offered.
    const inst = instance('c', []);
    const picked = sampleModifierUpgrades(
      inst, 5, lookups.pools, lookups.modifiers, ctx, makeRng('s-req'),
    );
    expect(picked).not.toContain(mE.id);
  });

  it('requires satisfied → included', () => {
    const inst = instance('c', ['mod_a']);
    let sawE = false;
    for (let trial = 0; trial < 30; trial++) {
      const picked = sampleModifierUpgrades(
        inst, 5, lookups.pools, lookups.modifiers, ctx, makeRng(`s-req-${trial}`),
      );
      if (picked.includes(mE.id)) { sawE = true; break; }
    }
    expect(sawE).toBe(true);
  });

  it('maxModifiers reached → returns empty', () => {
    const cappedCard = cardDef({ id: 'c2', poolRefs: ['pool_p'], maxModifiers: 1 });
    const ctxCapped: PoolSampleContext = { cardDef: cappedCard };
    const cappedLookups = makeLookups([mA, mB, mC], [poolP]);
    const inst: CardInstance = {
      instanceId: id<CardInstanceId>('inst-2'),
      defId: id<CardDefId>('c2'),
      modifiers: [{ id: mA.id, appliedAt: 0, source: { kind: 'starter' } }],
      acquired: { kind: 'starter' },
    };
    const picked = sampleModifierUpgrades(
      inst, 3, cappedLookups.pools, cappedLookups.modifiers, ctxCapped, makeRng('cap'),
    );
    expect(picked).toEqual([]);
  });

  it('same seed → same picks (deterministic)', () => {
    const inst = instance('c', []);
    const r1 = sampleModifierUpgrades(
      inst, 3, lookups.pools, lookups.modifiers, ctx, makeRng('det'),
    );
    const r2 = sampleModifierUpgrades(
      inst, 3, lookups.pools, lookups.modifiers, ctx, makeRng('det'),
    );
    expect(r1).toEqual(r2);
  });

  it('weight summing across pools — mod_b in both pools', () => {
    // mod_b is in pool_p (weight 5) and pool_q (weight 4) → effective 9.
    // We can't easily assert exact weight, but can check it appears more
    // often than something with effective weight 3 (mod_c) over many trials.
    let bCount = 0, cCount = 0;
    const inst = instance('c', []);
    for (let trial = 0; trial < 200; trial++) {
      const picked = sampleModifierUpgrades(
        inst, 1, lookups.pools, lookups.modifiers, ctx, makeRng(`bvc-${trial}`),
      );
      if (picked.includes(mB.id)) bCount++;
      if (picked.includes(mC.id)) cCount++;
    }
    expect(bCount).toBeGreaterThan(cCount);
  });

  it('conditional pool entries: hasTag eligibility', () => {
    const conditionalPool = pool({
      id: 'pool_cond',
      entries: [
        { modifierId: 'mod_a', weight: 100, conditional: { kind: 'hasTag', tag: id<EffectTag>('holy') } },
      ],
    });
    const physical = cardDef({ id: 'phys', poolRefs: ['pool_cond'], tags: ['physical'] });
    const inst = instance('phys', []);
    const lk = makeLookups([mA], [conditionalPool]);
    const ctxPhys: PoolSampleContext = { cardDef: physical };
    const picked = sampleModifierUpgrades(inst, 1, lk.pools, lk.modifiers, ctxPhys, makeRng('cond'));
    // mod_a is gated by hasTag holy, card is physical → no candidates
    expect(picked).toEqual([]);
  });
});
