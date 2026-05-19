import { beforeEach, describe, expect, it } from 'vitest';
import { executeEffect, executeEffects, type ExecutionContext } from './executor.js';
import { makeRng } from '../rng.js';
import { DEFAULT_CONSTANTS } from '../constants.js';
import { applyStatus, type StatusRegistry } from '../statuses/engine.js';
import type {
  CardDefId,
  CardInstance,
  CardInstanceId,
  Effect,
  EnemyActor,
  EnemyId,
  PlayerActor,
  PlayerCombatState,
  StatusDefinition,
  StatusId,
} from '../../types/index.js';

const id = <T extends string>(s: string): T => s as T;

// ---------- Status fixtures (needed by some effects) ----------

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
  hooks: [],
};

const STRENGTH: StatusDefinition = {
  id: id<StatusId>('strength'),
  name: '근력',
  description: '',
  stackingRule: 'sum',
  decay: { kind: 'none' },
  tags: [],
  hooks: [],
  damagePipeline: [{ kind: 'outgoingAdd', perStack: 1 }],
};

const registry: StatusRegistry = {
  get(id) {
    const all = [VULNERABLE, BLEED, STRENGTH];
    const s = all.find(x => x.id === id);
    if (!s) throw new Error(`Status not found: ${id}`);
    return s;
  },
  has(id) {
    return [VULNERABLE.id, BLEED.id, STRENGTH.id].includes(id);
  },
};

// ---------- Fixtures ----------

function makeCard(name: string): CardInstance {
  return {
    instanceId: id<CardInstanceId>(`c-${name}`),
    defId: id<CardDefId>(`d-${name}`),
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

function makeEnemy(name: string, opts: { hp?: number; block?: number } = {}): EnemyActor {
  return {
    kind: 'enemy',
    instanceId: name,
    defId: id<EnemyId>('e_test'),
    hp: opts.hp ?? 30,
    maxHp: opts.hp ?? 30,
    block: opts.block ?? 0,
    statuses: [],
  };
}

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  const player = overrides.player ?? makePlayer();
  const enemies = overrides.enemies ?? [makeEnemy('e1')];
  return {
    source: overrides.source ?? player,
    target: overrides.target,
    enemies,
    player,
    piles: overrides.piles ?? { hand: [], drawPile: [], discardPile: [], exhaustPile: [] },
    statuses: overrides.statuses ?? registry,
    rng: overrides.rng ?? makeRng('test'),
    constants: overrides.constants ?? DEFAULT_CONSTANTS,
    run: overrides.run ?? { gold: 0 },
    customHandlers: overrides.customHandlers,
  };
}

// ---------- Tests: damage ----------

describe('damage effects', () => {
  it('basic damage on single enemy target', () => {
    const enemy = makeEnemy('e1', { hp: 20 });
    const ctx = makeCtx({ target: enemy, enemies: [enemy] });
    const eff: Effect = { kind: 'damage', amount: 10, target: 'enemy' };
    const res = executeEffect(eff, ctx);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ kind: 'damage' });
    expect(enemy.hp).toBe(10);
  });

  it('allEnemies damages everyone alive', () => {
    const a = makeEnemy('a', { hp: 10 });
    const b = makeEnemy('b', { hp: 20 });
    const c = makeEnemy('c', { hp: 0 }); // dead
    const ctx = makeCtx({ enemies: [a, b, c] });
    const res = executeEffect({ kind: 'damage', amount: 5, target: 'allEnemies' }, ctx);
    expect(res).toHaveLength(2);
    expect(a.hp).toBe(5);
    expect(b.hp).toBe(15);
    expect(c.hp).toBe(0);
  });

  it('randomEnemy picks one', () => {
    const a = makeEnemy('a', { hp: 100 });
    const b = makeEnemy('b', { hp: 100 });
    const ctx = makeCtx({ enemies: [a, b], rng: makeRng('rand') });
    const res = executeEffect({ kind: 'damage', amount: 10, target: 'randomEnemy' }, ctx);
    expect(res).toHaveLength(1);
    // Exactly one of them takes damage
    const damaged = [a, b].filter(e => e.hp < 100);
    expect(damaged).toHaveLength(1);
  });

  it('no target specified → noTarget result', () => {
    const ctx = makeCtx({ target: undefined, enemies: [] });
    const res = executeEffect({ kind: 'damage', amount: 5, target: 'enemy' }, ctx);
    expect(res[0]?.kind).toBe('noTarget');
  });

  it('integrates with status pipeline (vulnerable doubles path)', () => {
    const enemy = makeEnemy('e1', { hp: 30 });
    applyStatus(enemy, VULNERABLE.id, 1, registry);
    const ctx = makeCtx({ target: enemy, enemies: [enemy] });
    executeEffect({ kind: 'damage', amount: 10, target: 'enemy' }, ctx);
    expect(enemy.hp).toBe(15); // 10 × 1.5 = 15
  });

  it('damageMultiHit applies amount per hit until dead', () => {
    const enemy = makeEnemy('e1', { hp: 15 });
    const ctx = makeCtx({ target: enemy, enemies: [enemy] });
    const res = executeEffect(
      { kind: 'damageMultiHit', amount: 6, hits: 5, target: 'enemy' },
      ctx,
    );
    // 6, 6, 3-effective (kills) → 3 results before stop
    expect(res.length).toBeGreaterThanOrEqual(1);
    expect(res.length).toBeLessThanOrEqual(5);
    expect(enemy.hp).toBe(0);
  });
});

// ---------- Tests: gainBlock ----------

describe('gainBlock', () => {
  it('player gains block from card', () => {
    const player = makePlayer({ block: 0 });
    const ctx = makeCtx({ player, source: player });
    const res = executeEffect({ kind: 'gainBlock', amount: 7 }, ctx);
    expect(player.block).toBe(7);
    expect(res[0]).toMatchObject({ kind: 'gainBlock', gained: 7 });
  });

  it('enemy can gain block via gainBlock effect from its intent', () => {
    const enemy = makeEnemy('e1', { hp: 50, block: 0 });
    const ctx = makeCtx({ source: enemy, enemies: [enemy] });
    executeEffect({ kind: 'gainBlock', amount: 5 }, ctx);
    expect(enemy.block).toBe(5);
  });
});

// ---------- Tests: applyStatus / removeStatus ----------

describe('applyStatus / removeStatus', () => {
  it('applyStatus on single enemy target', () => {
    const enemy = makeEnemy('e1');
    const ctx = makeCtx({ target: enemy, enemies: [enemy] });
    executeEffect(
      { kind: 'applyStatus', status: VULNERABLE.id, stacks: 2, target: 'enemy' },
      ctx,
    );
    expect(enemy.statuses).toHaveLength(1);
    expect(enemy.statuses[0]!.stacks).toBe(2);
  });

  it('applyStatus on allEnemies', () => {
    const a = makeEnemy('a');
    const b = makeEnemy('b');
    const ctx = makeCtx({ enemies: [a, b] });
    executeEffect(
      { kind: 'applyStatus', status: BLEED.id, stacks: 3, target: 'allEnemies' },
      ctx,
    );
    expect(a.statuses[0]!.stacks).toBe(3);
    expect(b.statuses[0]!.stacks).toBe(3);
  });

  it('applyStatus on self (source = player)', () => {
    const player = makePlayer();
    const ctx = makeCtx({ player, source: player });
    executeEffect(
      { kind: 'applyStatus', status: STRENGTH.id, stacks: 2, target: 'self' },
      ctx,
    );
    expect(player.statuses[0]!.stacks).toBe(2);
  });

  it('removeStatus reports whether it was present', () => {
    const enemy = makeEnemy('e1');
    applyStatus(enemy, BLEED.id, 5, registry);
    const ctx = makeCtx({ target: enemy, enemies: [enemy] });
    const r1 = executeEffect(
      { kind: 'removeStatus', status: BLEED.id, target: 'enemy' },
      ctx,
    );
    expect((r1[0] as any).removed).toBe(true);
    const r2 = executeEffect(
      { kind: 'removeStatus', status: BLEED.id, target: 'enemy' },
      ctx,
    );
    expect((r2[0] as any).removed).toBe(false);
  });
});

// ---------- Tests: energy / hp / gold ----------

describe('energy', () => {
  it('gainEnergy increases', () => {
    const player = makePlayer({ energy: 3 });
    const ctx = makeCtx({ player });
    executeEffect({ kind: 'gainEnergy', amount: 2 }, ctx);
    expect(player.energy).toBe(5);
  });

  it('loseEnergy clamps to 0', () => {
    const player = makePlayer({ energy: 2 });
    const ctx = makeCtx({ player });
    const r = executeEffect({ kind: 'loseEnergy', amount: 10 }, ctx);
    expect(player.energy).toBe(0);
    expect(r[0]).toMatchObject({ kind: 'loseEnergy', amount: 2 });
  });
});

describe('hp', () => {
  it('gainHp heals up to max', () => {
    const player = makePlayer({ hp: 60, maxHp: 70 });
    const ctx = makeCtx({ player, source: player });
    executeEffect({ kind: 'gainHp', amount: 100 }, ctx);
    expect(player.hp).toBe(70);
  });

  it('loseHp respects block by default', () => {
    const player = makePlayer({ hp: 50, block: 5 });
    const ctx = makeCtx({ player, source: player });
    executeEffect({ kind: 'loseHp', amount: 8 }, ctx);
    expect(player.block).toBe(0);
    expect(player.hp).toBe(47); // 5 absorbed, 3 to hp
  });

  it('loseHp with ignoreBlock', () => {
    const player = makePlayer({ hp: 50, block: 5 });
    const ctx = makeCtx({ player, source: player });
    executeEffect({ kind: 'loseHp', amount: 4, ignoreBlock: true }, ctx);
    expect(player.block).toBe(5);
    expect(player.hp).toBe(46);
  });
});

describe('gold', () => {
  it('gainGold increases run gold', () => {
    const ctx = makeCtx({ run: { gold: 50 } });
    executeEffect({ kind: 'gainGold', amount: 25 }, ctx);
    expect(ctx.run.gold).toBe(75);
  });

  it('loseGold clamps to 0', () => {
    const ctx = makeCtx({ run: { gold: 10 } });
    const r = executeEffect({ kind: 'loseGold', amount: 50 }, ctx);
    expect(ctx.run.gold).toBe(0);
    expect((r[0] as any).amount).toBe(10);
  });
});

// ---------- Tests: draw ----------

describe('draw', () => {
  it('draws from draw pile', () => {
    const piles: PlayerCombatState = {
      hand: [],
      drawPile: [makeCard('a'), makeCard('b'), makeCard('c')],
      discardPile: [],
      exhaustPile: [],
    };
    const ctx = makeCtx({ piles });
    const r = executeEffect({ kind: 'draw', count: 2 }, ctx);
    expect((r[0] as any).count).toBe(2);
    expect(piles.hand).toHaveLength(2);
  });

  it('returns reshuffled flag when pile auto-reshuffled', () => {
    const piles: PlayerCombatState = {
      hand: [],
      drawPile: [makeCard('a')],
      discardPile: [makeCard('b'), makeCard('c')],
      exhaustPile: [],
    };
    const ctx = makeCtx({ piles });
    const r = executeEffect({ kind: 'draw', count: 3 }, ctx);
    expect((r[0] as any).count).toBe(3);
    expect((r[0] as any).reshuffled).toBe(true);
  });
});

// ---------- Tests: executeEffects sequence ----------

describe('executeEffects', () => {
  it('runs effects in order, returns flattened results', () => {
    const enemy = makeEnemy('e1', { hp: 30 });
    const player = makePlayer();
    const ctx = makeCtx({ player, source: player, target: enemy, enemies: [enemy] });
    const effects: Effect[] = [
      { kind: 'damage', amount: 5, target: 'enemy' },
      { kind: 'gainBlock', amount: 3 },
      { kind: 'applyStatus', status: VULNERABLE.id, stacks: 1, target: 'enemy' },
    ];
    const results = executeEffects(effects, ctx);
    expect(results).toHaveLength(3);
    expect(enemy.hp).toBe(25);
    expect(player.block).toBe(3);
    expect(enemy.statuses[0]?.id).toBe(VULNERABLE.id);
  });

  it('expands multi-target effects into multiple results', () => {
    const a = makeEnemy('a');
    const b = makeEnemy('b');
    const ctx = makeCtx({ enemies: [a, b] });
    const results = executeEffects(
      [{ kind: 'damage', amount: 5, target: 'allEnemies' }],
      ctx,
    );
    expect(results).toHaveLength(2);
  });
});

// ---------- Tests: custom handler ----------

describe('custom handler', () => {
  it('invokes registered handler with params and ctx', () => {
    let called = false;
    let receivedParams: any = null;
    const handlers = new Map([
      ['my_custom', (params: any, ctx: ExecutionContext) => {
        called = true;
        receivedParams = params;
        ctx.player.energy += 100;
      }],
    ]);
    const player = makePlayer({ energy: 3 });
    const ctx = makeCtx({ player, customHandlers: handlers });
    executeEffect(
      { kind: 'custom', handlerId: 'my_custom', params: { foo: 1 } },
      ctx,
    );
    expect(called).toBe(true);
    expect(receivedParams).toEqual({ foo: 1 });
    expect(player.energy).toBe(103);
  });

  it('throws when handler not registered', () => {
    const ctx = makeCtx();
    expect(() =>
      executeEffect({ kind: 'custom', handlerId: 'nope' }, ctx),
    ).toThrow(/not registered/);
  });
});

// ---------- Tests: deferred effects ----------

describe('deferred effects (Phase 2.3.5 scope)', () => {
  it('discardChoose returns unimplemented marker', () => {
    const ctx = makeCtx();
    const r = executeEffect({ kind: 'discardChoose', count: 1 }, ctx);
    expect(r[0]?.kind).toBe('unimplemented');
  });

  it('addCardToPile returns unimplemented marker', () => {
    const ctx = makeCtx();
    const r = executeEffect(
      { kind: 'addCardToPile', cardDefId: id<CardDefId>('foo'), pile: 'hand' },
      ctx,
    );
    expect(r[0]?.kind).toBe('unimplemented');
  });
});
