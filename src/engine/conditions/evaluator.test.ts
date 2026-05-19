import { describe, expect, it } from 'vitest';
import { evalCondition, type ConditionContext, type CustomPredicate } from './evaluator.js';
import { makeRng } from '../rng.js';
import type {
  CardDefId,
  CardDefinition,
  CardInstance,
  CardInstanceId,
  EffectTag,
  EventId,
  GlobalSnapshot,
  RunSnapshot,
  SkillId,
} from '../../types/index.js';

const id = <T extends string>(s: string): T => s as T;

// ---------- Fixtures ----------

function makeCardInstance(defIdStr: string): CardInstance {
  return {
    instanceId: id<CardInstanceId>(`i-${defIdStr}-${Math.random()}`),
    defId: id<CardDefId>(defIdStr),
    modifiers: [],
    acquired: { kind: 'starter' },
  };
}

function makeCardDef(idStr: string, tags: string[] = []): CardDefinition {
  return {
    id: id<CardDefId>(idStr),
    name: idStr,
    cost: { kind: 'fixed', value: 1 },
    type: 'attack',
    target: { kind: 'enemy' },
    rarity: 'common',
    tags: tags.map(t => id<EffectTag>(t)),
    keywords: [],
    baseDescription: '',
    baseEffects: [],
    modifierPoolRefs: [],
  };
}

function makeRun(overrides: Partial<RunSnapshot['player']> & { difficultyLevel?: number } = {}): RunSnapshot {
  return {
    difficultyLevel: overrides.difficultyLevel ?? 0,
    player: {
      hp: overrides.hp ?? 70,
      maxHp: overrides.maxHp ?? 70,
      gold: overrides.gold ?? 100,
      deck: overrides.deck ?? [],
      skillIds: overrides.skillIds ?? [],
    },
  };
}

function makeGlobal(overrides: Partial<GlobalSnapshot> = {}): GlobalSnapshot {
  return {
    gold: overrides.gold ?? 1000,
    inventory: overrides.inventory ?? { cards: [] },
    passiveSkills: overrides.passiveSkills ?? [],
    eventsCleared: overrides.eventsCleared ?? new Set(),
  };
}

// ---------- Tests ----------

describe('evalCondition — primitive', () => {
  it('always → true', () => {
    expect(evalCondition({ kind: 'always' }, {})).toBe(true);
  });
  it('never → false', () => {
    expect(evalCondition({ kind: 'never' }, {})).toBe(false);
  });
});

describe('evalCondition — combinators', () => {
  const T = { kind: 'always' as const };
  const F = { kind: 'never' as const };

  it('and: all true → true', () => {
    expect(evalCondition({ kind: 'and', of: [T, T, T] }, {})).toBe(true);
  });
  it('and: any false → false', () => {
    expect(evalCondition({ kind: 'and', of: [T, F, T] }, {})).toBe(false);
  });
  it('and: empty → true', () => {
    expect(evalCondition({ kind: 'and', of: [] }, {})).toBe(true);
  });

  it('or: any true → true', () => {
    expect(evalCondition({ kind: 'or', of: [F, F, T] }, {})).toBe(true);
  });
  it('or: all false → false', () => {
    expect(evalCondition({ kind: 'or', of: [F, F, F] }, {})).toBe(false);
  });
  it('or: empty → false', () => {
    expect(evalCondition({ kind: 'or', of: [] }, {})).toBe(false);
  });

  it('not: true → false, false → true', () => {
    expect(evalCondition({ kind: 'not', of: T }, {})).toBe(false);
    expect(evalCondition({ kind: 'not', of: F }, {})).toBe(true);
  });

  it('nested: not(and(or(F, T), not(F)))', () => {
    const nested = {
      kind: 'not' as const,
      of: {
        kind: 'and' as const,
        of: [
          { kind: 'or' as const, of: [F, T] },
          { kind: 'not' as const, of: F },
        ],
      },
    };
    expect(evalCondition(nested, {})).toBe(false); // not(and(true, true)) = false
  });
});

describe('evalCondition — gold', () => {
  it('hasGold: min satisfied', () => {
    const run = makeRun({ gold: 100 });
    expect(evalCondition({ kind: 'hasGold', min: 50 }, { run })).toBe(true);
  });
  it('hasGold: min not satisfied', () => {
    const run = makeRun({ gold: 30 });
    expect(evalCondition({ kind: 'hasGold', min: 50 }, { run })).toBe(false);
  });
  it('hasGold: range check', () => {
    const run = makeRun({ gold: 100 });
    expect(evalCondition({ kind: 'hasGold', min: 50, max: 200 }, { run })).toBe(true);
    expect(evalCondition({ kind: 'hasGold', min: 200, max: 300 }, { run })).toBe(false);
    expect(evalCondition({ kind: 'hasGold', max: 50 }, { run })).toBe(false);
  });
  it('hasGold without run → throws', () => {
    expect(() => evalCondition({ kind: 'hasGold', min: 1 }, {})).toThrow(
      /requires a RunSnapshot/,
    );
  });

  it('hasGoldMeta: default min = 0', () => {
    const global = makeGlobal({ gold: 0 });
    expect(evalCondition({ kind: 'hasGoldMeta' }, { global })).toBe(true);
  });
  it('hasGoldMeta: min check', () => {
    const global = makeGlobal({ gold: 500 });
    expect(evalCondition({ kind: 'hasGoldMeta', min: 1000 }, { global })).toBe(false);
    expect(evalCondition({ kind: 'hasGoldMeta', min: 100 }, { global })).toBe(true);
  });
});

describe('evalCondition — deck/inventory cards', () => {
  const cardRegistry = {
    get: (cardId: CardDefId) => {
      if (cardId === id<CardDefId>('strike')) return makeCardDef('strike', ['physical', 'attack']);
      if (cardId === id<CardDefId>('heal'))   return makeCardDef('heal', ['holy']);
      throw new Error('unknown ' + cardId);
    },
  };

  it('hasCardInDeck by defId — count', () => {
    const deck = [makeCardInstance('strike'), makeCardInstance('strike'), makeCardInstance('heal')];
    const run = makeRun({ deck });
    expect(evalCondition({ kind: 'hasCardInDeck', defId: id<CardDefId>('strike'), min: 2 }, { run })).toBe(true);
    expect(evalCondition({ kind: 'hasCardInDeck', defId: id<CardDefId>('strike'), min: 3 }, { run })).toBe(false);
  });

  it('hasCardInDeck by tag — needs card registry', () => {
    const deck = [makeCardInstance('strike'), makeCardInstance('strike'), makeCardInstance('heal')];
    const run = makeRun({ deck });
    expect(evalCondition({ kind: 'hasCardInDeck', tag: id<EffectTag>('physical'), min: 2 }, { run, cards: cardRegistry })).toBe(true);
    expect(evalCondition({ kind: 'hasCardInDeck', tag: id<EffectTag>('physical'), min: 3 }, { run, cards: cardRegistry })).toBe(false);
    expect(evalCondition({ kind: 'hasCardInDeck', tag: id<EffectTag>('holy'),     min: 1 }, { run, cards: cardRegistry })).toBe(true);
  });

  it('hasCardInDeck by tag without registry → throws', () => {
    const deck = [makeCardInstance('strike')];
    const run = makeRun({ deck });
    expect(() =>
      evalCondition({ kind: 'hasCardInDeck', tag: id<EffectTag>('physical') }, { run }),
    ).toThrow(/cards.*registry/);
  });

  it('hasCardInInventory — global cards', () => {
    const cards = [makeCardInstance('strike'), makeCardInstance('heal')];
    const global = makeGlobal({ inventory: { cards } });
    expect(evalCondition({ kind: 'hasCardInInventory', defId: id<CardDefId>('heal') }, { global })).toBe(true);
    expect(evalCondition({ kind: 'hasCardInInventory', defId: id<CardDefId>('unknown' as string) }, { global })).toBe(false);
  });
});

describe('evalCondition — skills / passives', () => {
  it('hasSkill', () => {
    const run = makeRun({ skillIds: [id<SkillId>('skill_a'), id<SkillId>('skill_b')] });
    expect(evalCondition({ kind: 'hasSkill', skillId: id<SkillId>('skill_a') }, { run })).toBe(true);
    expect(evalCondition({ kind: 'hasSkill', skillId: id<SkillId>('skill_x') }, { run })).toBe(false);
  });

  it('hasPassive', () => {
    const global = makeGlobal({ passiveSkills: [id<SkillId>('passive_a')] });
    expect(evalCondition({ kind: 'hasPassive', skillId: id<SkillId>('passive_a') }, { global })).toBe(true);
    expect(evalCondition({ kind: 'hasPassive', skillId: id<SkillId>('passive_x') }, { global })).toBe(false);
  });
});

describe('evalCondition — HP / difficulty / events', () => {
  it('hpPercent: range', () => {
    const run = makeRun({ hp: 35, maxHp: 70 }); // 50%
    expect(evalCondition({ kind: 'hpPercent', max: 50 }, { run })).toBe(true);
    expect(evalCondition({ kind: 'hpPercent', max: 49 }, { run })).toBe(false);
    expect(evalCondition({ kind: 'hpPercent', min: 25 }, { run })).toBe(true);
    expect(evalCondition({ kind: 'hpPercent', min: 75 }, { run })).toBe(false);
  });

  it('hpPercent: maxHp 0 → 0%', () => {
    const run = makeRun({ hp: 0, maxHp: 0 });
    expect(evalCondition({ kind: 'hpPercent', max: 1 }, { run })).toBe(true);
  });

  it('difficultyAtLeast', () => {
    const run = makeRun({ difficultyLevel: 5 });
    expect(evalCondition({ kind: 'difficultyAtLeast', level: 5 }, { run })).toBe(true);
    expect(evalCondition({ kind: 'difficultyAtLeast', level: 6 }, { run })).toBe(false);
  });

  it('eventCleared / eventNotCleared', () => {
    const global = makeGlobal({ eventsCleared: new Set([id<EventId>('e1')]) });
    expect(evalCondition({ kind: 'eventCleared',    eventId: id<EventId>('e1') }, { global })).toBe(true);
    expect(evalCondition({ kind: 'eventCleared',    eventId: id<EventId>('e2') }, { global })).toBe(false);
    expect(evalCondition({ kind: 'eventNotCleared', eventId: id<EventId>('e2') }, { global })).toBe(true);
  });
});

describe('evalCondition — random', () => {
  it('chance 0 → never', () => {
    const rng = makeRng('r-0');
    for (let i = 0; i < 50; i++) {
      expect(evalCondition({ kind: 'random', chance: 0 }, { rng })).toBe(false);
    }
  });

  it('chance 1 → always', () => {
    const rng = makeRng('r-1');
    for (let i = 0; i < 50; i++) {
      expect(evalCondition({ kind: 'random', chance: 1 }, { rng })).toBe(true);
    }
  });

  it('chance 0.5 → roughly half (200 trials)', () => {
    const rng = makeRng('r-half');
    let trues = 0;
    for (let i = 0; i < 200; i++) {
      if (evalCondition({ kind: 'random', chance: 0.5 }, { rng })) trues++;
    }
    expect(trues).toBeGreaterThan(60);
    expect(trues).toBeLessThan(140);
  });

  it('determinism: same seed → same sequence', () => {
    const rng1 = makeRng('det');
    const rng2 = makeRng('det');
    for (let i = 0; i < 30; i++) {
      const a = evalCondition({ kind: 'random', chance: 0.5 }, { rng: rng1 });
      const b = evalCondition({ kind: 'random', chance: 0.5 }, { rng: rng2 });
      expect(a).toBe(b);
    }
  });

  it('random without rng → throws', () => {
    expect(() => evalCondition({ kind: 'random', chance: 0.5 }, {})).toThrow(/IRandom/);
  });
});

describe('evalCondition — custom predicates', () => {
  it('registered predicate gets called with params + ctx', () => {
    let captured: { params: unknown; ctxKeys: string[] } | null = null;
    const fn: CustomPredicate = (params, ctx) => {
      captured = { params, ctxKeys: Object.keys(ctx) };
      return true;
    };
    const ctx: ConditionContext = {
      customPredicates: new Map([['my_pred', fn]]),
    };
    const result = evalCondition(
      { kind: 'custom', predicateId: 'my_pred', params: { foo: 1 } },
      ctx,
    );
    expect(result).toBe(true);
    expect(captured).not.toBeNull();
    expect(captured!.params).toEqual({ foo: 1 });
  });

  it('missing predicate → throws', () => {
    expect(() =>
      evalCondition({ kind: 'custom', predicateId: 'missing' }, {}),
    ).toThrow(/Custom condition predicate not registered/);
  });
});
