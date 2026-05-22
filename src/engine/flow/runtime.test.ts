import { describe, expect, it } from 'vitest';
import { FlowRuntime, type FlowRuntimeContext } from './runtime.js';
import { type ExecutionContext } from '../effects/executor.js';
import { type StatusRegistry } from '../statuses/engine.js';
import { makeRng } from '../rng.js';
import { DEFAULT_CONSTANTS } from '../constants.js';
import type {
  EventDefinition,
  EventId,
  FlowDefinition,
  GlobalSnapshot,
  PlayerActor,
  RunSnapshot,
  ScenarioId,
  SkillId,
} from '../../types/index.js';

const id = <T extends string>(s: string): T => s as T;

// ---------- Helpers ----------

function makePlayer(): PlayerActor {
  return {
    kind: 'player',
    hp: 50,
    maxHp: 70,
    block: 0,
    energy: 3,
    maxEnergy: 3,
    statuses: [],
  };
}

function makeRunSnap(p: PlayerActor, gold = 100): RunSnapshot {
  return {
    difficultyLevel: 0,
    player: { hp: p.hp, maxHp: p.maxHp, gold, deck: [], skillIds: [] },
  };
}

function makeGlobalSnap(opts: Partial<GlobalSnapshot> = {}): GlobalSnapshot {
  return {
    gold: opts.gold ?? 500,
    inventory: opts.inventory ?? { cards: [] },
    passiveSkills: opts.passiveSkills ?? [],
    eventsCleared: opts.eventsCleared ?? new Set(),
  };
}

const statusRegistry: StatusRegistry = {
  get() { throw new Error('no statuses in flow tests'); },
  has() { return false; },
};

function makeCtx(opts: { player?: PlayerActor; runGold?: number; globalGold?: number; rngSeed?: string } = {}): FlowRuntimeContext {
  const player = opts.player ?? makePlayer();
  const run = makeRunSnap(player, opts.runGold);
  const global = makeGlobalSnap({ gold: opts.globalGold });
  const rng = makeRng(opts.rngSeed ?? 'flow');

  const execution: ExecutionContext = {
    source: player,
    enemies: [],
    player,
    piles: { hand: [], drawPile: [], discardPile: [], exhaustPile: [] },
    statuses: statusRegistry,
    rng,
    constants: DEFAULT_CONSTANTS,
    run: { gold: run.player.gold },
  };
  return {
    condition: { run, global, rng },
    execution,
    rng,
  };
}

function makeEvent(flowId: string): EventDefinition {
  return {
    id: id<EventId>('e_test'),
    name: 'Test Event',
    nodeType: 'event_normal' as any,
    flowId: id<ScenarioId>(flowId),
  };
}

// ====================================================================
// dialogue
// ====================================================================

describe('FlowRuntime — dialogue', () => {
  it('shows text and waits for advance', () => {
    const flow: FlowDefinition = {
      id: id<ScenarioId>('f1'),
      entryStepId: 's1',
      steps: {
        s1: { kind: 'dialogue', text: 'Hello world', next: 's2' },
        s2: { kind: 'end', outcome: 'success' },
      },
    };
    const rt = new FlowRuntime();
    const ctx = makeCtx();
    const s1 = rt.start(makeEvent('f1'), flow, ctx);
    expect(s1.kind).toBe('awaitingDialogue');
    if (s1.kind === 'awaitingDialogue') {
      expect(s1.text).toBe('Hello world');
    }
    const s2 = rt.advance(ctx);
    expect(s2.kind).toBe('finished');
    if (s2.kind === 'finished') expect(s2.outcome).toBe('success');
  });

  it('substitutes {variable} references', () => {
    const flow: FlowDefinition = {
      id: id<ScenarioId>('f2'),
      entryStepId: 's1',
      steps: {
        s1: { kind: 'dialogue', text: 'You have {gold}G and meta {goldMeta}G. HP: {currentHp}/{maxHp}', next: 's2' },
        s2: { kind: 'end' },
      },
    };
    const player = makePlayer();
    player.hp = 42; player.maxHp = 70;
    const ctx = makeCtx({ player, runGold: 150, globalGold: 999 });
    const rt = new FlowRuntime();
    const s = rt.start(makeEvent('f2'), flow, ctx);
    if (s.kind === 'awaitingDialogue') {
      expect(s.text).toBe('You have 150G and meta 999G. HP: 42/70');
    } else { throw new Error('expected dialogue'); }
  });

  it('unknown variable left as-is (typo helper)', () => {
    const flow: FlowDefinition = {
      id: id<ScenarioId>('f3'),
      entryStepId: 's1',
      steps: {
        s1: { kind: 'dialogue', text: 'Hi {whoami}', next: 's2' },
        s2: { kind: 'end' },
      },
    };
    const rt = new FlowRuntime();
    const s = rt.start(makeEvent('f3'), flow, makeCtx());
    if (s.kind === 'awaitingDialogue') {
      expect(s.text).toBe('Hi {whoami}');
    }
  });
});

// ====================================================================
// choice
// ====================================================================

describe('FlowRuntime — choice', () => {
  function makeChoiceFlow(): FlowDefinition {
    return {
      id: id<ScenarioId>('cf'),
      entryStepId: 'q',
      steps: {
        q: {
          kind: 'choice',
          prompt: 'Pick one',
          options: [
            { label: 'Cheap (50G)', condition: { kind: 'hasGold', min: 50 }, effects: [{ kind: 'loseGold', amount: 50 }], next: 'cheap_end' },
            { label: 'Expensive (200G)', condition: { kind: 'hasGold', min: 200 }, effects: [{ kind: 'loseGold', amount: 200 }], next: 'exp_end' },
            { label: 'Hidden if rich', hidden: { kind: 'hasGold', min: 1000 }, next: 'common_end' },
            { label: 'Free leave', next: 'common_end' },
          ],
        },
        cheap_end: { kind: 'end', outcome: 'success' },
        exp_end:   { kind: 'end', outcome: 'success' },
        common_end: { kind: 'end', outcome: 'neutral' },
      },
    };
  }

  it('presents enabled and disabled options based on conditions', () => {
    const ctx = makeCtx({ runGold: 100 });
    const rt = new FlowRuntime();
    const s = rt.start(makeEvent('cf'), makeChoiceFlow(), ctx);
    expect(s.kind).toBe('awaitingChoice');
    if (s.kind !== 'awaitingChoice') return;
    expect(s.options).toHaveLength(4);  // none hidden at 100G
    expect(s.options[0]).toMatchObject({ enabled: true, label: 'Cheap (50G)' });
    expect(s.options[1]).toMatchObject({ enabled: false, label: 'Expensive (200G)' });
    expect(s.options[3]).toMatchObject({ enabled: true, label: 'Free leave' });
  });

  it('hides options when hidden condition matches', () => {
    const ctx = makeCtx({ runGold: 2000 });
    const rt = new FlowRuntime();
    const s = rt.start(makeEvent('cf'), makeChoiceFlow(), ctx);
    if (s.kind !== 'awaitingChoice') throw new Error('expected choice');
    expect(s.options).toHaveLength(3); // 'Hidden if rich' filtered out
    expect(s.options.find(o => o.label === 'Hidden if rich')).toBeUndefined();
  });

  it('choosing applies effects, then navigates next', () => {
    const ctx = makeCtx({ runGold: 100 });
    const rt = new FlowRuntime();
    rt.start(makeEvent('cf'), makeChoiceFlow(), ctx);
    const s = rt.choose(0, ctx);
    expect(s.kind).toBe('finished');
    expect(ctx.execution.run.gold).toBe(50); // 100 - 50
  });

  it('throws when picking a disabled option', () => {
    const ctx = makeCtx({ runGold: 100 });
    const rt = new FlowRuntime();
    rt.start(makeEvent('cf'), makeChoiceFlow(), ctx);
    expect(() => rt.choose(1, ctx)).toThrow(/disabled/);
  });

  it('throws when index is out of range', () => {
    const ctx = makeCtx({ runGold: 100 });
    const rt = new FlowRuntime();
    rt.start(makeEvent('cf'), makeChoiceFlow(), ctx);
    expect(() => rt.choose(99, ctx)).toThrow(/not in current choice/);
  });
});

// ====================================================================
// probabilistic
// ====================================================================

describe('FlowRuntime — probabilistic choice', () => {
  const flow: FlowDefinition = {
    id: id<ScenarioId>('pf'),
    entryStepId: 'q',
    steps: {
      q: {
        kind: 'choice',
        options: [
          { label: 'gamble', probabilistic: { chance: 0.5, successNext: 'win', failureNext: 'lose' } },
        ],
      },
      win:  { kind: 'end', outcome: 'success' },
      lose: { kind: 'end', outcome: 'failure' },
    },
  };

  it('chance=1 always succeeds', () => {
    const flow2 = structuredClone(flow);
    (flow2.steps.q as any).options[0].probabilistic.chance = 1;
    for (let i = 0; i < 10; i++) {
      const ctx = makeCtx({ rngSeed: `c1-${i}` });
      const rt = new FlowRuntime();
      rt.start(makeEvent('pf'), flow2, ctx);
      const s = rt.choose(0, ctx);
      expect(s.kind).toBe('finished');
      if (s.kind === 'finished') expect(s.outcome).toBe('success');
    }
  });

  it('chance=0 always fails', () => {
    const flow2 = structuredClone(flow);
    (flow2.steps.q as any).options[0].probabilistic.chance = 0;
    for (let i = 0; i < 10; i++) {
      const ctx = makeCtx({ rngSeed: `c0-${i}` });
      const rt = new FlowRuntime();
      rt.start(makeEvent('pf'), flow2, ctx);
      const s = rt.choose(0, ctx);
      if (s.kind === 'finished') expect(s.outcome).toBe('failure');
    }
  });

  it('chance=0.5 roughly half over many trials', () => {
    let wins = 0;
    for (let i = 0; i < 200; i++) {
      const ctx = makeCtx({ rngSeed: `c5-${i}` });
      const rt = new FlowRuntime();
      rt.start(makeEvent('pf'), flow, ctx);
      const s = rt.choose(0, ctx);
      if (s.kind === 'finished' && s.outcome === 'success') wins++;
    }
    expect(wins).toBeGreaterThan(60);
    expect(wins).toBeLessThan(140);
  });
});

// ====================================================================
// applyEffect / branch / goto / end
// ====================================================================

describe('FlowRuntime — auto-advancing steps', () => {
  it('applyEffect runs effects and continues', () => {
    const flow: FlowDefinition = {
      id: id<ScenarioId>('a'),
      entryStepId: 's1',
      steps: {
        s1: { kind: 'applyEffect', effects: [{ kind: 'gainGold', amount: 50 }, { kind: 'gainHp', amount: 5 }], next: 's2' },
        s2: { kind: 'end', outcome: 'success' },
      },
    };
    const ctx = makeCtx({ runGold: 100 });
    const rt = new FlowRuntime();
    const s = rt.start(makeEvent('a'), flow, ctx);
    expect(s.kind).toBe('finished');
    expect(ctx.execution.run.gold).toBe(150);
    expect(rt.getEffectLog()).toHaveLength(2);
  });

  it('branch picks first matching condition', () => {
    const flow: FlowDefinition = {
      id: id<ScenarioId>('b'),
      entryStepId: 'br',
      steps: {
        br: {
          kind: 'branch',
          branches: [
            { condition: { kind: 'hasGold', min: 1000 }, next: 'rich' },
            { condition: { kind: 'hasGold', min: 100 }, next: 'med' },
          ],
          defaultNext: 'poor',
        },
        rich: { kind: 'end', outcome: 'success' },
        med:  { kind: 'end', outcome: 'neutral' },
        poor: { kind: 'end', outcome: 'failure' },
      },
    };
    // 150G: med branch
    const ctx1 = makeCtx({ runGold: 150 });
    const rt1 = new FlowRuntime();
    const s1 = rt1.start(makeEvent('b'), flow, ctx1);
    if (s1.kind === 'finished') expect(s1.outcome).toBe('neutral');

    // 50G: defaultNext (poor)
    const ctx2 = makeCtx({ runGold: 50 });
    const rt2 = new FlowRuntime();
    const s2 = rt2.start(makeEvent('b'), flow, ctx2);
    if (s2.kind === 'finished') expect(s2.outcome).toBe('failure');

    // 2000G: rich branch
    const ctx3 = makeCtx({ runGold: 2000 });
    const rt3 = new FlowRuntime();
    const s3 = rt3.start(makeEvent('b'), flow, ctx3);
    if (s3.kind === 'finished') expect(s3.outcome).toBe('success');
  });

  it('goto jumps directly', () => {
    const flow: FlowDefinition = {
      id: id<ScenarioId>('g'),
      entryStepId: 's1',
      steps: {
        s1: { kind: 'goto', stepId: 's3' },
        s2: { kind: 'end', outcome: 'failure' },  // skipped
        s3: { kind: 'end', outcome: 'success' },
      },
    };
    const rt = new FlowRuntime();
    const s = rt.start(makeEvent('g'), flow, makeCtx());
    if (s.kind === 'finished') expect(s.outcome).toBe('success');
  });
});

// ====================================================================
// Host-driven step kinds
// ====================================================================

// Reusable mock host that records calls so tests can assert against it.
import type { FlowHost } from './host.js';
import type { CardDefId, CardInstance, CardInstanceId, EnemyGroupId, ModifierId } from '../../types/index.js';

function makeMockHost(opts: {
  poolCards?: ReadonlyArray<CardDefId>;
  skillsForOffer?: ReadonlyArray<SkillId>;
  upgradeCandidates?: ReadonlyArray<CardInstance>;
  modifierChoices?: ReadonlyArray<ModifierId>;
}): {
  host: FlowHost;
  log: {
    attachedCards: { defId: CardDefId; dest: string }[];
    skillsGiven: SkillId[];
    modifiersAttached: { card: CardInstanceId; mod: ModifierId }[];
    bulkAttach: { selector: string; mod: ModifierId }[];
    combatStarted: EnemyGroupId[];
  };
} {
  const log = {
    attachedCards: [] as { defId: CardDefId; dest: string }[],
    skillsGiven: [] as SkillId[],
    modifiersAttached: [] as { card: CardInstanceId; mod: ModifierId }[],
    bulkAttach: [] as { selector: string; mod: ModifierId }[],
    combatStarted: [] as EnemyGroupId[],
  };
  const host: FlowHost = {
    sampleCardsFromPool: (_poolId, n) => (opts.poolCards ?? []).slice(0, n),
    sampleCardsFromPools: (_poolIds, n) => (opts.poolCards ?? []).slice(0, n),
    sampleShopItems: ({ count }) => (opts.poolCards ?? []).slice(0, count).map(defId => ({ defId, priceGold: 50 })),
    getCurrentRunGold: () => 9999,
    buyShopCard: () => true,
    payEngraveCost: () => true,
    attachCardToDestination: (defId, dest) => {
      log.attachedCards.push({ defId, dest });
      const inst: CardInstance = {
        instanceId: id<CardInstanceId>(`inst-${defId}-${Math.random()}`),
        defId,
        modifiers: [],
        acquired: { kind: 'event' },
      };
      return { ok: true, cardInstance: inst };
    },
    sampleSkillsForOffer: ({ count }) => (opts.skillsForOffer ?? []).slice(0, count),
    addSkillToCharacter: (skillId) => { log.skillsGiven.push(skillId); },
    filterCardsForUpgrade: () => [...(opts.upgradeCandidates ?? [])],
    sampleModifierUpgrades: (_card, n) => (opts.modifierChoices ?? []).slice(0, n),
    attachModifierToCard: (cardId, modId) => {
      log.modifiersAttached.push({ card: cardId, mod: modId });
      return true;
    },
    forceAttachModifier: ({ selector, modifierId }) => {
      log.bulkAttach.push({ selector, mod: modifierId });
      return { matched: 1 };
    },
    beginCombat: (egId) => { log.combatStarted.push(egId); },
    getCurrentDeckSize: () => 0,
  };
  return { host, log };
}

describe('FlowRuntime — cardOffer', () => {
  function makeFlow(picks: number, iterations: number, dest: 'currentDeck' | 'inventory' = 'currentDeck'): FlowDefinition {
    return {
      id: id<ScenarioId>('co'),
      entryStepId: 's',
      steps: {
        s: {
          kind: 'cardOffer', poolId: 'pool_x',
          picksPerIteration: picks, iterations, destination: dest,
          allowSkip: true, next: 'end',
        },
        end: { kind: 'end', outcome: 'success' },
      },
    };
  }

  it('pickCard advances iterations and finishes', () => {
    const { host, log } = makeMockHost({
      poolCards: [id<CardDefId>('a'), id<CardDefId>('b'), id<CardDefId>('c')],
    });
    const ctx = { ...makeCtx(), host };
    const rt = new FlowRuntime();
    const s1 = rt.start(makeEvent('co'), makeFlow(3, 3), ctx);
    expect(s1.kind).toBe('awaitingCardPick');
    if (s1.kind !== 'awaitingCardPick') throw new Error();
    expect(s1.iteration).toBe(1);
    expect(s1.totalIterations).toBe(3);
    expect(s1.choices).toEqual([id<CardDefId>('a'), id<CardDefId>('b'), id<CardDefId>('c')]);

    const s2 = rt.pickCard(id<CardDefId>('a'), ctx);
    expect(s2.kind).toBe('awaitingCardPick');
    if (s2.kind === 'awaitingCardPick') expect(s2.iteration).toBe(2);

    rt.pickCard(id<CardDefId>('b'), ctx);
    const s4 = rt.pickCard(id<CardDefId>('c'), ctx);
    expect(s4.kind).toBe('finished');

    expect(log.attachedCards).toHaveLength(3);
    expect(log.attachedCards.every(a => a.dest === 'currentDeck')).toBe(true);
  });

  it('skipCardPick advances iteration without attaching', () => {
    const { host, log } = makeMockHost({ poolCards: [id<CardDefId>('a')] });
    const ctx = { ...makeCtx(), host };
    const rt = new FlowRuntime();
    rt.start(makeEvent('co'), makeFlow(1, 2), ctx);
    const s = rt.skipCardPick(ctx);
    expect(s.kind).toBe('awaitingCardPick');
    if (s.kind === 'awaitingCardPick') expect(s.iteration).toBe(2);
    rt.skipCardPick(ctx);
    expect(rt.getStatus().kind).toBe('finished');
    expect(log.attachedCards).toHaveLength(0);
  });

  it('throws when picking a card not in the offer', () => {
    const { host } = makeMockHost({ poolCards: [id<CardDefId>('a')] });
    const ctx = { ...makeCtx(), host };
    const rt = new FlowRuntime();
    rt.start(makeEvent('co'), makeFlow(1, 1), ctx);
    expect(() => rt.pickCard(id<CardDefId>('not_offered'), ctx)).toThrow(/not in current offer/);
  });

  it('requires host', () => {
    const ctx = makeCtx(); // no host
    const rt = new FlowRuntime();
    expect(() => rt.start(makeEvent('co'), makeFlow(1, 1), ctx)).toThrow(/host is required/);
  });
});

describe('FlowRuntime — skillOffer', () => {
  function makeFlow(canSkip: boolean = false): FlowDefinition {
    return {
      id: id<ScenarioId>('so'),
      entryStepId: 's',
      steps: {
        s: { kind: 'skillOffer', count: 3, allowSkip: canSkip, next: 'end' },
        end: { kind: 'end', outcome: 'success' },
      },
    };
  }

  it('presents candidates + pickSkill finishes', () => {
    const { host, log } = makeMockHost({
      skillsForOffer: [id<SkillId>('sa'), id<SkillId>('sb'), id<SkillId>('sc')],
    });
    const ctx = { ...makeCtx(), host };
    const rt = new FlowRuntime();
    const s = rt.start(makeEvent('so'), makeFlow(), ctx);
    expect(s.kind).toBe('awaitingSkillPick');
    if (s.kind === 'awaitingSkillPick') expect(s.choices).toHaveLength(3);
    const done = rt.pickSkill(id<SkillId>('sb'), ctx);
    expect(done.kind).toBe('finished');
    expect(log.skillsGiven).toEqual([id<SkillId>('sb')]);
  });

  it('skipSkillPick (when allowed) finishes without granting skill', () => {
    const { host, log } = makeMockHost({ skillsForOffer: [id<SkillId>('sa')] });
    const ctx = { ...makeCtx(), host };
    const rt = new FlowRuntime();
    rt.start(makeEvent('so'), makeFlow(true), ctx);
    const done = rt.skipSkillPick(ctx);
    expect(done.kind).toBe('finished');
    expect(log.skillsGiven).toHaveLength(0);
  });

  it('skipSkillPick when not allowed throws', () => {
    const { host } = makeMockHost({ skillsForOffer: [id<SkillId>('sa')] });
    const ctx = { ...makeCtx(), host };
    const rt = new FlowRuntime();
    rt.start(makeEvent('so'), makeFlow(false), ctx);
    expect(() => rt.skipSkillPick(ctx)).toThrow(/does not allow skip/);
  });
});

describe('FlowRuntime — cardUpgrade', () => {
  function makeFlow(count: number): FlowDefinition {
    return {
      id: id<ScenarioId>('cu'),
      entryStepId: 's',
      steps: {
        s: {
          kind: 'cardUpgrade', source: 'currentDeck',
          count, allowSkip: true, next: 'end',
        },
        end: { kind: 'end', outcome: 'success' },
      },
    };
  }

  function makeCard(n: string): CardInstance {
    return {
      instanceId: id<CardInstanceId>(`inst-${n}`),
      defId: id<CardDefId>('d'),
      modifiers: [],
      acquired: { kind: 'starter' },
    };
  }

  it('happy path: pick card → pick modifier → finish', () => {
    const card1 = makeCard('1');
    const { host, log } = makeMockHost({
      upgradeCandidates: [card1, makeCard('2')],
      modifierChoices: [id<ModifierId>('m1'), id<ModifierId>('m2'), id<ModifierId>('m3')],
    });
    const ctx = { ...makeCtx(), host };
    const rt = new FlowRuntime();
    const s1 = rt.start(makeEvent('cu'), makeFlow(1), ctx);
    expect(s1.kind).toBe('awaitingCardUpgradeTarget');

    const s2 = rt.pickCardToUpgrade(card1.instanceId, ctx);
    expect(s2.kind).toBe('awaitingModifierPick');

    const s3 = rt.pickModifier(id<ModifierId>('m2'), ctx);
    expect(s3.kind).toBe('finished');
    expect(log.modifiersAttached).toEqual([{ card: card1.instanceId, mod: id<ModifierId>('m2') }]);
  });

  it('forceModifierId skips modifier pick', () => {
    const card1 = makeCard('1');
    const { host, log } = makeMockHost({
      upgradeCandidates: [card1],
    });
    const ctx = { ...makeCtx(), host };
    const flow: FlowDefinition = {
      id: id<ScenarioId>('cuf'),
      entryStepId: 's',
      steps: {
        s: {
          kind: 'cardUpgrade', source: 'currentDeck', count: 1,
          forceModifierId: id<ModifierId>('m_forced'),
          next: 'end',
        },
        end: { kind: 'end', outcome: 'success' },
      },
    };
    const rt = new FlowRuntime();
    rt.start(makeEvent('cuf'), flow, ctx);
    const done = rt.pickCardToUpgrade(card1.instanceId, ctx);
    expect(done.kind).toBe('finished');
    expect(log.modifiersAttached).toEqual([
      { card: card1.instanceId, mod: id<ModifierId>('m_forced') },
    ]);
  });

  it('no candidates → auto-finishes', () => {
    const { host } = makeMockHost({ upgradeCandidates: [] });
    const ctx = { ...makeCtx(), host };
    const rt = new FlowRuntime();
    const s = rt.start(makeEvent('cu'), makeFlow(1), ctx);
    expect(s.kind).toBe('finished');
  });

  it('skipCardUpgrade jumps past all iterations', () => {
    const { host, log } = makeMockHost({
      upgradeCandidates: [makeCard('1')],
      modifierChoices: [id<ModifierId>('m1')],
    });
    const ctx = { ...makeCtx(), host };
    const rt = new FlowRuntime();
    rt.start(makeEvent('cu'), makeFlow(3), ctx);
    const done = rt.skipCardUpgrade(ctx);
    expect(done.kind).toBe('finished');
    expect(log.modifiersAttached).toHaveLength(0);
  });

  it('multiple iterations: pickCard → pickModifier → pickCard → pickModifier → finish', () => {
    const card1 = makeCard('1');
    const card2 = makeCard('2');
    const { host, log } = makeMockHost({
      upgradeCandidates: [card1, card2],
      modifierChoices: [id<ModifierId>('m1')],
    });
    const ctx = { ...makeCtx(), host };
    const rt = new FlowRuntime();
    rt.start(makeEvent('cu'), makeFlow(2), ctx);

    rt.pickCardToUpgrade(card1.instanceId, ctx);
    let s = rt.pickModifier(id<ModifierId>('m1'), ctx);
    expect(s.kind).toBe('awaitingCardUpgradeTarget'); // iter 2

    rt.pickCardToUpgrade(card2.instanceId, ctx);
    s = rt.pickModifier(id<ModifierId>('m1'), ctx);
    expect(s.kind).toBe('finished');
    expect(log.modifiersAttached).toHaveLength(2);
  });
});

describe('FlowRuntime — cardModifierAttach', () => {
  it('bulk allInDeck auto-applies and advances', () => {
    const { host, log } = makeMockHost({});
    const ctx = { ...makeCtx(), host };
    const flow: FlowDefinition = {
      id: id<ScenarioId>('cma'),
      entryStepId: 's',
      steps: {
        s: {
          kind: 'cardModifierAttach', cardInstanceSelector: 'allInDeck',
          modifierId: id<ModifierId>('curse'),
          next: 'end',
        },
        end: { kind: 'end', outcome: 'success' },
      },
    };
    const rt = new FlowRuntime();
    const s = rt.start(makeEvent('cma'), flow, ctx);
    expect(s.kind).toBe('finished');
    expect(log.bulkAttach).toEqual([{ selector: 'allInDeck', mod: id<ModifierId>('curse') }]);
  });

  it('choose variant awaits target then attaches forced mod', () => {
    const card1: CardInstance = {
      instanceId: id<CardInstanceId>('c1'),
      defId: id<CardDefId>('d'),
      modifiers: [],
      acquired: { kind: 'starter' },
    };
    const { host, log } = makeMockHost({ upgradeCandidates: [card1] });
    const ctx = { ...makeCtx(), host };
    const flow: FlowDefinition = {
      id: id<ScenarioId>('cmc'),
      entryStepId: 's',
      steps: {
        s: {
          kind: 'cardModifierAttach', cardInstanceSelector: 'choose',
          modifierId: id<ModifierId>('blessing'),
          next: 'end',
        },
        end: { kind: 'end', outcome: 'success' },
      },
    };
    const rt = new FlowRuntime();
    const s1 = rt.start(makeEvent('cmc'), flow, ctx);
    expect(s1.kind).toBe('awaitingCardUpgradeTarget');
    if (s1.kind === 'awaitingCardUpgradeTarget') {
      expect(s1.forcedModifierId).toBe(id<ModifierId>('blessing'));
    }
    const s2 = rt.pickCardForModifierAttach(card1.instanceId, ctx);
    expect(s2.kind).toBe('finished');
    expect(log.modifiersAttached).toEqual([
      { card: card1.instanceId, mod: id<ModifierId>('blessing') },
    ]);
  });
});

describe('FlowRuntime — combatStart', () => {
  function makeFlow(withDefeatPath: boolean = true): FlowDefinition {
    return {
      id: id<ScenarioId>('cs'),
      entryStepId: 's',
      steps: {
        s: {
          kind: 'combatStart',
          enemyGroupId: id<EnemyGroupId>('eg_test'),
          afterVictoryNext: 'win',
          afterDefeatNext: withDefeatPath ? 'lose' : undefined,
        },
        win:  { kind: 'end', outcome: 'success' },
        lose: { kind: 'end', outcome: 'failure' },
      },
    };
  }

  it('entering combatStart sets inCombat status and calls host.beginCombat', () => {
    const { host, log } = makeMockHost({});
    const ctx = { ...makeCtx(), host };
    const rt = new FlowRuntime();
    const s = rt.start(makeEvent('cs'), makeFlow(), ctx);
    expect(s.kind).toBe('inCombat');
    if (s.kind === 'inCombat') expect(s.enemyGroupId).toBe(id<EnemyGroupId>('eg_test'));
    expect(log.combatStarted).toEqual([id<EnemyGroupId>('eg_test')]);
  });

  it('combatResolved(won) jumps to afterVictoryNext', () => {
    const { host } = makeMockHost({});
    const ctx = { ...makeCtx(), host };
    const rt = new FlowRuntime();
    rt.start(makeEvent('cs'), makeFlow(), ctx);
    const s = rt.combatResolved('won', ctx);
    expect(s.kind).toBe('finished');
    if (s.kind === 'finished') expect(s.outcome).toBe('success');
  });

  it('combatResolved(lost) with defeat path jumps there', () => {
    const { host } = makeMockHost({});
    const ctx = { ...makeCtx(), host };
    const rt = new FlowRuntime();
    rt.start(makeEvent('cs'), makeFlow(true), ctx);
    const s = rt.combatResolved('lost', ctx);
    expect(s.kind).toBe('finished');
    if (s.kind === 'finished') expect(s.outcome).toBe('failure');
  });

  it('combatResolved(lost) without defeat path → flow finishes as failure', () => {
    const { host } = makeMockHost({});
    const ctx = { ...makeCtx(), host };
    const rt = new FlowRuntime();
    rt.start(makeEvent('cs'), makeFlow(false), ctx);
    const s = rt.combatResolved('lost', ctx);
    expect(s.kind).toBe('finished');
    if (s.kind === 'finished') expect(s.outcome).toBe('failure');
  });
});

// ====================================================================
// integration: 여정의 시작 (subset — no cardOffer/warehouse yet)
// ====================================================================

describe('FlowRuntime — integration: journey-start subset', () => {
  it('plays through opening dialogue → branch on warehouse → dialogue → end', () => {
    const flow: FlowDefinition = {
      id: id<ScenarioId>('js'),
      entryStepId: 'open',
      steps: {
        open: { kind: 'dialogue', speaker: '안내자', text: '환영하노라.', next: 'check' },
        check: {
          kind: 'branch',
          branches: [
            { condition: { kind: 'hasCardInInventory', min: 1 }, next: 'offer' },
          ],
          defaultNext: 'depart',
        },
        offer: {
          kind: 'choice',
          prompt: '창고를 보겠는가?',
          options: [
            { label: '본다', next: 'depart' },
            { label: '안 본다', next: 'depart' },
          ],
        },
        depart: { kind: 'dialogue', text: '행운을!', next: 'fin' },
        fin: { kind: 'end', outcome: 'success' },
      },
    };

    const player = makePlayer();
    const ctx = makeCtx({ player });
    const rt = new FlowRuntime();

    // Open dialogue
    const s1 = rt.start(makeEvent('js'), flow, ctx);
    expect(s1.kind).toBe('awaitingDialogue');

    // Advance → branch (inventory empty) → depart dialogue
    const s2 = rt.advance(ctx);
    expect(s2.kind).toBe('awaitingDialogue');
    if (s2.kind === 'awaitingDialogue') expect(s2.text).toBe('행운을!');

    // Advance → end
    const s3 = rt.advance(ctx);
    expect(s3.kind).toBe('finished');
    if (s3.kind === 'finished') expect(s3.outcome).toBe('success');
  });
});

// ====================================================================
// error paths
// ====================================================================

describe('FlowRuntime — errors', () => {
  it('throws on advance() before start', () => {
    const rt = new FlowRuntime();
    expect(() => rt.advance(makeCtx())).toThrow(/not started/);
  });

  it('throws on advance() during non-dialogue', () => {
    const flow: FlowDefinition = {
      id: id<ScenarioId>('e1'),
      entryStepId: 'q',
      steps: {
        q: { kind: 'choice', options: [{ label: 'go', next: 'end' }] },
        end: { kind: 'end' },
      },
    };
    const rt = new FlowRuntime();
    rt.start(makeEvent('e1'), flow, makeCtx());
    expect(() => rt.advance(makeCtx())).toThrow(/'choice'/);
  });

  it('throws on missing step transition', () => {
    const flow: FlowDefinition = {
      id: id<ScenarioId>('e2'),
      entryStepId: 's',
      steps: {
        s: { kind: 'dialogue', text: 'hi', next: 'missing' },
      },
    };
    const rt = new FlowRuntime();
    rt.start(makeEvent('e2'), flow, makeCtx());
    expect(() => rt.advance(makeCtx())).toThrow(/unknown step id/);
  });
});
