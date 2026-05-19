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
// deferred kinds
// ====================================================================

describe('FlowRuntime — deferred step kinds', () => {
  const deferredKinds: Array<[string, any]> = [
    ['cardOffer', { kind: 'cardOffer', poolId: 'p', picksPerIteration: 3, iterations: 1, destination: 'currentDeck', next: 'end' }],
    ['skillOffer', { kind: 'skillOffer', count: 3, next: 'end' }],
    ['cardUpgrade', { kind: 'cardUpgrade', source: 'currentDeck', count: 1, next: 'end' }],
    ['cardModifierAttach', { kind: 'cardModifierAttach', cardInstanceSelector: 'choose', modifierId: id<any>('m'), next: 'end' }],
    ['combatStart', { kind: 'combatStart', enemyGroupId: id<any>('eg'), afterVictoryNext: 'end' }],
  ];

  for (const [kindName, stepData] of deferredKinds) {
    it(`${kindName} → awaitingDeferred`, () => {
      const flow: FlowDefinition = {
        id: id<ScenarioId>('d-' + kindName),
        entryStepId: 's',
        steps: {
          s: stepData,
          end: { kind: 'end' },
        },
      };
      const rt = new FlowRuntime();
      const status = rt.start(makeEvent('d-' + kindName), flow, makeCtx());
      expect(status.kind).toBe('awaitingDeferred');
      if (status.kind === 'awaitingDeferred') {
        expect(status.stepKind).toBe(kindName);
      }
    });
  }
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
