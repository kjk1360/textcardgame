import { beforeEach, describe, expect, it } from 'vitest';
import {
  decideNextIntent,
  endPlayerTurn,
  fireStatusHooks,
  isCombatOver,
  runEnemyTurn,
  startCombat,
  startPlayerTurn,
  type TurnFlowContext,
} from './turn-flow.js';
import { playCard } from './play-card.js';
import { makeRng } from '../rng.js';
import { DEFAULT_CONSTANTS } from '../constants.js';
import { applyStatus, type StatusRegistry } from '../statuses/engine.js';
import type { ModifierLookup } from '../modifiers/resolver.js';
import type {
  CardDefId,
  CardDefinition,
  CardInstance,
  CardInstanceId,
  EnemyActor,
  EnemyId,
  Intent,
  IntentScript,
  PlayerActor,
  PlayerCombatState,
  StatusDefinition,
  StatusId,
} from '../../types/index.js';

const id = <T extends string>(s: string): T => s as T;

// ---------- Status fixtures ----------

const VULNERABLE: StatusDefinition = {
  id: id<StatusId>('vulnerable'),
  name: '취약',
  description: '',
  stackingRule: 'sum',
  decay: { kind: 'fixedPerTurn', amount: 1 },
  tags: [],
  hooks: [],
  damagePipeline: [{ kind: 'incomingMul', multiplier: 1.5 }],
};

const BLEED: StatusDefinition = {
  id: id<StatusId>('bleed'),
  name: '출혈',
  description: '',
  stackingRule: 'sum',
  decay: { kind: 'oneStackPerTrigger' },
  tags: [],
  hooks: [
    {
      on: 'onOwnerTurnStart',
      effects: [{ kind: 'loseHp', amount: 1, ignoreBlock: true, target: 'self' } as any],
    },
  ],
};

const REGEN: StatusDefinition = {
  id: id<StatusId>('regen'),
  name: '재생',
  description: '',
  stackingRule: 'sum',
  decay: { kind: 'oneStackPerTrigger' },
  tags: [],
  hooks: [
    {
      on: 'onOwnerTurnEnd',
      effects: [{ kind: 'gainHp', amount: 1 } as any],
    },
  ],
};

const allStatuses = [VULNERABLE, BLEED, REGEN];

const statusRegistry: StatusRegistry = {
  get(sid) {
    const s = allStatuses.find(x => x.id === sid);
    if (!s) throw new Error(`status not found: ${sid}`);
    return s;
  },
  has(sid) {
    return allStatuses.some(x => x.id === sid);
  },
};

// ---------- Card defs ----------

const strike: CardDefinition = {
  id: id<CardDefId>('strike'),
  name: '타격',
  cost: { kind: 'fixed', value: 1 },
  type: 'attack',
  target: { kind: 'enemy' },
  rarity: 'starter',
  tags: [],
  keywords: [],
  baseDescription: '',
  baseEffects: [{ kind: 'damage', amount: 6, target: 'enemy' }],
  modifierPoolRefs: [],
};

const defend: CardDefinition = {
  id: id<CardDefId>('defend'),
  name: '수비',
  cost: { kind: 'fixed', value: 1 },
  type: 'skill',
  target: { kind: 'self' },
  rarity: 'starter',
  tags: [],
  keywords: [],
  baseDescription: '',
  baseEffects: [{ kind: 'gainBlock', amount: 5 }],
  modifierPoolRefs: [],
};

const cardRegistry = {
  get(cid: CardDefId) {
    const all = [strike, defend];
    const c = all.find(x => x.id === cid);
    if (!c) throw new Error('card not found: ' + cid);
    return c;
  },
};

const modLookup: ModifierLookup = { get() { throw new Error('no mods in this test'); } };

// ---------- Helpers ----------

function makeCard(defId: string): CardInstance {
  return {
    instanceId: id<CardInstanceId>(`inst-${defId}-${Math.random()}`),
    defId: id<CardDefId>(defId),
    modifiers: [],
    acquired: { kind: 'starter' },
  };
}

function makePlayer(opts: { hp?: number; maxHp?: number; energy?: number; block?: number } = {}): PlayerActor {
  return {
    kind: 'player',
    hp: opts.hp ?? 70,
    maxHp: opts.maxHp ?? 70,
    block: opts.block ?? 0,
    energy: opts.energy ?? 3,
    maxEnergy: 3,
    statuses: [],
  };
}

function makeEnemy(name: string, hp = 30): EnemyActor {
  return {
    kind: 'enemy',
    instanceId: name,
    defId: id<EnemyId>('e_test'),
    hp,
    maxHp: hp,
    block: 0,
    statuses: [],
    intentCursor: 0,
  };
}

function makeTfCtx(overrides: Partial<TurnFlowContext> = {}): TurnFlowContext {
  return {
    player: overrides.player ?? makePlayer(),
    enemies: overrides.enemies ?? [makeEnemy('e1')],
    piles: overrides.piles ?? { hand: [], drawPile: [], discardPile: [], exhaustPile: [] },
    statuses: overrides.statuses ?? statusRegistry,
    rng: overrides.rng ?? makeRng('tf'),
    constants: overrides.constants ?? DEFAULT_CONSTANTS,
    run: overrides.run ?? { gold: 0 },
  };
}

// ---------- Intent scripts ----------

function attackIntent(value: number): Intent {
  return {
    id: `atk${value}`,
    display: { kind: 'attack', value },
    effects: [{ kind: 'damage', amount: value, target: 'enemy' }],
  };
}

function defendIntent(value: number): Intent {
  return {
    id: `def${value}`,
    display: { kind: 'defend', value },
    effects: [{ kind: 'gainBlock', amount: value }],
  };
}

// ---------- Tests ----------

describe('startCombat', () => {
  it('shuffles deck into drawPile, draws opening hand, sets intents', () => {
    const tfCtx = makeTfCtx({ enemies: [makeEnemy('e1', 30)] });
    const scripts = new Map<string, IntentScript>([
      ['e1', { mode: 'cycle', intents: [attackIntent(8), defendIntent(5)] }],
    ]);
    const deck = [makeCard('strike'), makeCard('strike'), makeCard('defend'), makeCard('defend'), makeCard('strike')];
    startCombat(tfCtx, deck, scripts);
    expect(tfCtx.piles.hand).toHaveLength(4); // perTurn = 4
    expect(tfCtx.piles.drawPile).toHaveLength(1);
    expect(tfCtx.player.energy).toBe(3);
    expect(tfCtx.enemies[0]!.intent?.id).toBe('atk8');
  });
});

describe('startPlayerTurn / endPlayerTurn', () => {
  it('startPlayerTurn resets energy & block, draws cards', () => {
    const player = makePlayer({ energy: 0, block: 5 });
    const tfCtx = makeTfCtx({
      player,
      piles: { hand: [], drawPile: [makeCard('strike'), makeCard('strike'), makeCard('strike'), makeCard('strike')], discardPile: [], exhaustPile: [] },
    });
    startPlayerTurn(tfCtx);
    expect(player.energy).toBe(3);
    expect(player.block).toBe(0);
    expect(tfCtx.piles.hand).toHaveLength(4);
  });

  it('endPlayerTurn discards entire hand', () => {
    const tfCtx = makeTfCtx();
    tfCtx.piles.hand = [makeCard('strike'), makeCard('strike'), makeCard('defend')];
    endPlayerTurn(tfCtx);
    expect(tfCtx.piles.hand).toHaveLength(0);
    expect(tfCtx.piles.discardPile).toHaveLength(3);
  });

  it('endPlayerTurn decays statuses (vulnerable -1)', () => {
    const tfCtx = makeTfCtx();
    applyStatus(tfCtx.player, VULNERABLE.id, 3, statusRegistry);
    endPlayerTurn(tfCtx);
    expect(tfCtx.player.statuses[0]!.stacks).toBe(2);
  });
});

describe('status hook firing during turns', () => {
  it('bleed fires onOwnerTurnStart, damages player, decays one stack', () => {
    const player = makePlayer({ hp: 50, block: 0 });
    const tfCtx = makeTfCtx({ player });
    applyStatus(player, BLEED.id, 3, statusRegistry);
    startPlayerTurn(tfCtx, 0); // don't draw to avoid empty deck reshuffle issues
    expect(player.hp).toBe(49);            // -1 from bleed (ignoreBlock)
    expect(player.statuses[0]!.stacks).toBe(2); // -1 from oneStackPerTrigger
  });

  it('regen fires onOwnerTurnEnd, heals player, decays one stack', () => {
    const player = makePlayer({ hp: 40, maxHp: 70 });
    const tfCtx = makeTfCtx({ player });
    applyStatus(player, REGEN.id, 2, statusRegistry);
    endPlayerTurn(tfCtx);
    expect(player.hp).toBe(41);
    expect(player.statuses[0]!.stacks).toBe(1);
  });

  it('fireStatusHooks directly (manual invocation)', () => {
    const player = makePlayer({ hp: 30 });
    const tfCtx = makeTfCtx({ player });
    applyStatus(player, BLEED.id, 5, statusRegistry);
    fireStatusHooks(player, 'onOwnerTurnStart', tfCtx);
    expect(player.hp).toBe(29);
    expect(player.statuses[0]!.stacks).toBe(4);
  });
});

describe('runEnemyTurn', () => {
  it('enemy attacks the player, draws block from intent, advances intent', () => {
    const player = makePlayer({ hp: 50, block: 0 });
    const e1 = makeEnemy('e1', 30);
    const tfCtx = makeTfCtx({ player, enemies: [e1] });
    const scripts = new Map<string, IntentScript>([
      ['e1', { mode: 'cycle', intents: [attackIntent(8), defendIntent(5)] }],
    ]);
    // Simulate startCombat having already picked intents[0]: cursor moved to 1.
    e1.intent = attackIntent(8);
    e1.intentCursor = 1;

    runEnemyTurn(tfCtx, scripts);
    expect(player.hp).toBe(42);
    // After acting, runEnemyTurn picked next intent (intents[1]=def5),
    // cursor wraps back to 0.
    expect(e1.intent?.id).toBe('def5');
  });

  it('skips dead enemies', () => {
    const player = makePlayer();
    const dead = makeEnemy('dead', 30); dead.hp = 0;
    const alive = makeEnemy('alive', 30);
    alive.intent = attackIntent(5);
    const tfCtx = makeTfCtx({ player, enemies: [dead, alive] });
    const scripts = new Map<string, IntentScript>([
      ['alive', { mode: 'cycle', intents: [attackIntent(5)] }],
    ]);
    runEnemyTurn(tfCtx, scripts);
    expect(player.hp).toBe(65);
  });

  it('enemy with bleed: turn-start hook damages enemy before it acts', () => {
    const player = makePlayer({ hp: 70 });
    const e1 = makeEnemy('e1', 5);  // very low hp
    e1.intent = attackIntent(10);
    applyStatus(e1, BLEED.id, 5, statusRegistry);  // 5 ignoreBlock damage on turn start
    const tfCtx = makeTfCtx({ player, enemies: [e1] });
    const scripts = new Map<string, IntentScript>([
      ['e1', { mode: 'cycle', intents: [attackIntent(10)] }],
    ]);
    runEnemyTurn(tfCtx, scripts);
    expect(e1.hp).toBe(4);          // 5 - 1 from bleed
    expect(player.hp).toBe(60);     // enemy still acts after bleed (bleed=1 ≠ lethal)
  });
});

describe('intent decision', () => {
  it('cycle: iterates through intents in order, wraps', () => {
    const e = makeEnemy('e1');
    const script: IntentScript = { mode: 'cycle', intents: [attackIntent(1), attackIntent(2), attackIntent(3)] };
    const rng = makeRng('cyc');
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push(decideNextIntent(e, script, rng)!.id);
    expect(ids).toEqual(['atk1', 'atk2', 'atk3', 'atk1', 'atk2', 'atk3', 'atk1']);
  });

  it('weighted: high-weight intent dominates over many trials', () => {
    const e = makeEnemy('e1');
    const script: IntentScript = {
      mode: 'weighted',
      intents: [{ ...attackIntent(1), weight: 10 }, { ...attackIntent(2), weight: 1 }],
    };
    let atk1 = 0, atk2 = 0;
    const rng = makeRng('w-trials');
    for (let i = 0; i < 200; i++) {
      const id = decideNextIntent(e, script, rng)!.id;
      if (id === 'atk1') atk1++;
      else atk2++;
    }
    expect(atk1).toBeGreaterThan(atk2 * 3);
  });

  it("scripted: follows nextIntentId chain", () => {
    const e = makeEnemy('e1');
    const a: Intent = { id: 'A', display: { kind: 'attack', value: 1 }, effects: [], nextIntentId: 'B' };
    const b: Intent = { id: 'B', display: { kind: 'defend', value: 1 }, effects: [], nextIntentId: 'C' };
    const c: Intent = { id: 'C', display: { kind: 'buff' }, effects: [], nextIntentId: 'A' };
    const script: IntentScript = { mode: 'scripted', intents: [a, b, c] };
    const rng = makeRng('s');

    expect(decideNextIntent(e, script, rng)!.id).toBe('A'); // no last → first
    e.lastIntentId = 'A';
    expect(decideNextIntent(e, script, rng)!.id).toBe('B');
    e.lastIntentId = 'B';
    expect(decideNextIntent(e, script, rng)!.id).toBe('C');
    e.lastIntentId = 'C';
    expect(decideNextIntent(e, script, rng)!.id).toBe('A');
  });

  it('empty intents → undefined', () => {
    const e = makeEnemy('e1');
    const script: IntentScript = { mode: 'cycle', intents: [] };
    expect(decideNextIntent(e, script, makeRng('e'))).toBeUndefined();
  });
});

describe('isCombatOver', () => {
  it('inProgress when both sides alive', () => {
    const tfCtx = makeTfCtx({ player: makePlayer({ hp: 50 }), enemies: [makeEnemy('e1', 10)] });
    expect(isCombatOver(tfCtx)).toBe('inProgress');
  });
  it('won when all enemies dead', () => {
    const e1 = makeEnemy('e1'); e1.hp = 0;
    const tfCtx = makeTfCtx({ player: makePlayer({ hp: 50 }), enemies: [e1] });
    expect(isCombatOver(tfCtx)).toBe('won');
  });
  it('lost when player hp 0', () => {
    const tfCtx = makeTfCtx({ player: makePlayer({ hp: 0 }) });
    expect(isCombatOver(tfCtx)).toBe('lost');
  });
});

// ====================================================================
// End-to-end integration test
// ====================================================================

describe('END-TO-END: simulated 3-turn combat', () => {
  it('player vs single enemy: cards played, hooks fire, combat decides', () => {
    const player = makePlayer({ hp: 70, maxHp: 70, energy: 0, block: 0 });
    const enemy = makeEnemy('e1', 25);
    const tfCtx = makeTfCtx({ player, enemies: [enemy] });

    const scripts = new Map<string, IntentScript>([
      ['e1', {
        mode: 'cycle',
        intents: [attackIntent(8), defendIntent(4), attackIntent(8)],
      }],
    ]);

    // Build a deck of strike/strike/strike/defend/defend
    const deck: CardInstance[] = [
      makeCard('strike'), makeCard('strike'), makeCard('strike'),
      makeCard('defend'), makeCard('defend'),
    ];

    startCombat(tfCtx, deck, scripts);
    expect(tfCtx.piles.hand).toHaveLength(4);
    expect(enemy.intent?.id).toBe('atk8');

    // Turn 1: play whatever cards we have until energy runs out.
    let safety = 20;
    while (tfCtx.player.energy > 0 && safety-- > 0) {
      const playable = tfCtx.piles.hand.find(c => {
        const def = cardRegistry.get(c.defId);
        return def.cost.kind === 'fixed' && def.cost.value <= tfCtx.player.energy;
      });
      if (!playable) break;
      playCard(
        playable.instanceId,
        {
          source: tfCtx.player,
          target: enemy,
          enemies: tfCtx.enemies,
          player: tfCtx.player,
          piles: tfCtx.piles,
          statuses: tfCtx.statuses,
          rng: tfCtx.rng,
          constants: tfCtx.constants,
          run: tfCtx.run,
        },
        cardRegistry,
        modLookup,
        { target: enemy },
      );
    }

    endPlayerTurn(tfCtx);
    runEnemyTurn(tfCtx, scripts);
    if (isCombatOver(tfCtx) !== 'inProgress') return;

    startPlayerTurn(tfCtx);
    safety = 20;
    while (tfCtx.player.energy > 0 && safety-- > 0) {
      const playable = tfCtx.piles.hand.find(c => {
        const def = cardRegistry.get(c.defId);
        return def.cost.kind === 'fixed' && def.cost.value <= tfCtx.player.energy;
      });
      if (!playable) break;
      playCard(
        playable.instanceId,
        {
          source: tfCtx.player, target: enemy, enemies: tfCtx.enemies,
          player: tfCtx.player, piles: tfCtx.piles,
          statuses: tfCtx.statuses, rng: tfCtx.rng,
          constants: tfCtx.constants, run: tfCtx.run,
        },
        cardRegistry,
        modLookup,
        { target: enemy },
      );
    }

    endPlayerTurn(tfCtx);
    runEnemyTurn(tfCtx, scripts);
    if (isCombatOver(tfCtx) !== 'inProgress') return;

    startPlayerTurn(tfCtx);
    safety = 20;
    while (tfCtx.player.energy > 0 && safety-- > 0) {
      const playable = tfCtx.piles.hand.find(c => {
        const def = cardRegistry.get(c.defId);
        return def.cost.kind === 'fixed' && def.cost.value <= tfCtx.player.energy;
      });
      if (!playable) break;
      playCard(
        playable.instanceId,
        {
          source: tfCtx.player, target: enemy, enemies: tfCtx.enemies,
          player: tfCtx.player, piles: tfCtx.piles,
          statuses: tfCtx.statuses, rng: tfCtx.rng,
          constants: tfCtx.constants, run: tfCtx.run,
        },
        cardRegistry,
        modLookup,
        { target: enemy },
      );
    }

    // After 3 player turns of strike-heavy plays, enemy should be dead.
    // (Strike does 6/play. Several plays expected per turn with energy=3.)
    expect(enemy.hp).toBeLessThanOrEqual(0);
    expect(isCombatOver(tfCtx)).toBe('won');
  });
});
