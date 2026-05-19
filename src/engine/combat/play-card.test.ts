import { beforeEach, describe, expect, it } from 'vitest';
import { canPlayCard, playCard } from './play-card.js';
import { type ExecutionContext } from '../effects/executor.js';
import { type ModifierLookup } from '../modifiers/resolver.js';
import { type StatusRegistry } from '../statuses/engine.js';
import { makeRng } from '../rng.js';
import { DEFAULT_CONSTANTS } from '../constants.js';
import type {
  CardDefId,
  CardDefinition,
  CardInstance,
  CardInstanceId,
  EnemyActor,
  EnemyId,
  Modifier,
  ModifierId,
  PlayerActor,
  PlayerCombatState,
  StatusDefinition,
  StatusId,
} from '../../types/index.js';

const id = <T extends string>(s: string): T => s as T;

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

const reaper: CardDefinition = {
  id: id<CardDefId>('reaper'),
  name: '수확자',
  cost: { kind: 'fixed', value: 2 },
  type: 'attack',
  target: { kind: 'allEnemies' },
  rarity: 'rare',
  tags: [],
  keywords: ['exhaust'],
  baseDescription: '',
  baseEffects: [{ kind: 'damage', amount: 4, target: 'allEnemies' }],
  modifierPoolRefs: [],
};

const cleanse: CardDefinition = {
  id: id<CardDefId>('cleanse'),
  name: '정화',
  cost: { kind: 'fixed', value: 0 },
  type: 'skill',
  target: { kind: 'none' },
  rarity: 'special',
  tags: [],
  keywords: ['exhaust'],
  baseDescription: '',
  baseEffects: [{ kind: 'draw', count: 2 }],
  modifierPoolRefs: [],
};

const wound: CardDefinition = {
  id: id<CardDefId>('wound'),
  name: '상처',
  cost: { kind: 'unplayable' },
  type: 'status',
  target: { kind: 'none' },
  rarity: 'special',
  tags: [],
  keywords: [],
  baseDescription: '',
  baseEffects: [],
  modifierPoolRefs: [],
};

// ---------- Lookups ----------

const cardRegistry = {
  get(cid: CardDefId) {
    const all = [strike, defend, reaper, cleanse, wound];
    const c = all.find(x => x.id === cid);
    if (!c) throw new Error('Card not found: ' + cid);
    return c;
  },
};

// Sharpness modifier — +5 damage
const sharpness: Modifier = {
  id: id<ModifierId>('mod_sharp'),
  name: '예리함',
  descriptionTemplate: '',
  tags: [],
  weight: 1,
  transforms: [
    { op: 'modifyEffect', match: { kind: 'damage' }, set: { amount: { delta: 5 } } },
  ],
};

const exhaustAdd: Modifier = {
  id: id<ModifierId>('mod_exhaust'),
  name: '소멸',
  descriptionTemplate: '',
  tags: [],
  weight: 1,
  transforms: [{ op: 'addKeyword', keyword: 'exhaust' }],
};

const modLookup: ModifierLookup = {
  get(mid: ModifierId) {
    const all = [sharpness, exhaustAdd];
    const m = all.find(x => x.id === mid);
    if (!m) throw new Error('Modifier not found: ' + mid);
    return m;
  },
};

const statusRegistry: StatusRegistry = {
  get() { throw new Error('no status defs in play-card tests'); },
  has() { return false; },
};

// ---------- Helpers ----------

function makeCardInstance(defId: string, mods: ModifierId[] = []): CardInstance {
  return {
    instanceId: id<CardInstanceId>(`inst-${defId}-${Math.random()}`),
    defId: id<CardDefId>(defId),
    modifiers: mods.map(m => ({ id: m, appliedAt: 0, source: { kind: 'starter' } })),
    acquired: { kind: 'starter' },
  };
}

function makePlayer(opts: { hp?: number; energy?: number; block?: number } = {}): PlayerActor {
  return {
    kind: 'player',
    hp: opts.hp ?? 70,
    maxHp: 70,
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
  };
}

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  const player = overrides.player ?? makePlayer();
  const enemies = overrides.enemies ?? [makeEnemy('e1')];
  const piles: PlayerCombatState = overrides.piles ?? {
    hand: [], drawPile: [], discardPile: [], exhaustPile: [],
  };
  return {
    source: player,
    target: overrides.target,
    enemies,
    player,
    piles,
    statuses: statusRegistry,
    rng: makeRng('play'),
    constants: DEFAULT_CONSTANTS,
    run: { gold: 0 },
  };
}

// ---------- Tests ----------

describe('playCard — basic happy path', () => {
  it('plays a basic attack: spends energy, deals damage, discards', () => {
    const card = makeCardInstance('strike');
    const enemy = makeEnemy('e1', 30);
    const ctx = makeCtx({ enemies: [enemy], target: enemy });
    ctx.piles.hand.push(card);

    const result = playCard(card.instanceId, ctx, cardRegistry, modLookup, { target: enemy });
    expect(result.kind).toBe('played');
    if (result.kind !== 'played') return;
    expect(result.energySpent).toBe(1);
    expect(result.destination).toBe('discard');
    expect(ctx.player.energy).toBe(2);
    expect(enemy.hp).toBe(24);
    expect(ctx.piles.hand).toHaveLength(0);
    expect(ctx.piles.discardPile).toContain(card);
  });

  it('plays a self-target skill: gains block', () => {
    const card = makeCardInstance('defend');
    const ctx = makeCtx();
    ctx.piles.hand.push(card);
    const result = playCard(card.instanceId, ctx, cardRegistry, modLookup);
    expect(result.kind).toBe('played');
    expect(ctx.player.block).toBe(5);
    expect(ctx.player.energy).toBe(2);
  });

  it('plays an allEnemies attack', () => {
    const card = makeCardInstance('reaper');
    const a = makeEnemy('a', 20);
    const b = makeEnemy('b', 20);
    const ctx = makeCtx({ enemies: [a, b], player: makePlayer({ energy: 3 }) });
    ctx.piles.hand.push(card);
    const result = playCard(card.instanceId, ctx, cardRegistry, modLookup);
    expect(result.kind).toBe('played');
    if (result.kind !== 'played') return;
    expect(result.destination).toBe('exhaust');  // reaper has exhaust keyword
    expect(a.hp).toBe(16);
    expect(b.hp).toBe(16);
    expect(ctx.piles.exhaustPile).toContain(card);
    expect(ctx.piles.discardPile).not.toContain(card);
    expect(ctx.player.energy).toBe(1);  // 3 - 2
  });

  it('plays a no-target card (draw 2)', () => {
    const card = makeCardInstance('cleanse');
    const ctx = makeCtx({
      piles: {
        hand: [],
        drawPile: [makeCardInstance('strike'), makeCardInstance('defend')],
        discardPile: [],
        exhaustPile: [],
      },
    });
    ctx.piles.hand.push(card);
    const result = playCard(card.instanceId, ctx, cardRegistry, modLookup);
    expect(result.kind).toBe('played');
    expect(ctx.piles.hand).toHaveLength(2);  // drew 2 (card itself left hand → exhaust)
    expect(ctx.piles.exhaustPile).toContain(card);
  });
});

describe('playCard — with modifiers', () => {
  it('sharpness modifier increases damage', () => {
    const card = makeCardInstance('strike', [id<ModifierId>('mod_sharp')]);
    const enemy = makeEnemy('e1', 30);
    const ctx = makeCtx({ enemies: [enemy], target: enemy });
    ctx.piles.hand.push(card);
    playCard(card.instanceId, ctx, cardRegistry, modLookup, { target: enemy });
    expect(enemy.hp).toBe(19);  // 30 - (6+5)
  });

  it('exhaust modifier routes the card to exhaust pile', () => {
    const card = makeCardInstance('strike', [id<ModifierId>('mod_exhaust')]);
    const enemy = makeEnemy('e1', 30);
    const ctx = makeCtx({ enemies: [enemy], target: enemy });
    ctx.piles.hand.push(card);
    const r = playCard(card.instanceId, ctx, cardRegistry, modLookup, { target: enemy });
    expect(r.kind).toBe('played');
    if (r.kind !== 'played') return;
    expect(r.destination).toBe('exhaust');
    expect(ctx.piles.exhaustPile).toContain(card);
  });
});

describe('playCard — rejections', () => {
  it('rejects when card not in hand', () => {
    const ctx = makeCtx();
    const r = playCard(id<CardInstanceId>('nope'), ctx, cardRegistry, modLookup);
    expect(r.kind).toBe('rejected');
    if (r.kind === 'rejected') expect(r.reason).toBe('not-in-hand');
  });

  it('rejects when insufficient energy', () => {
    const card = makeCardInstance('reaper');  // cost 2
    const ctx = makeCtx({ player: makePlayer({ energy: 1 }) });
    ctx.piles.hand.push(card);
    const r = playCard(card.instanceId, ctx, cardRegistry, modLookup);
    expect(r.kind).toBe('rejected');
    if (r.kind === 'rejected') expect(r.reason).toBe('insufficient-energy');
    // No mutation: card still in hand, energy untouched
    expect(ctx.piles.hand).toContain(card);
    expect(ctx.player.energy).toBe(1);
  });

  it('rejects when missing target on enemy-target card', () => {
    const card = makeCardInstance('strike');
    const ctx = makeCtx();
    ctx.piles.hand.push(card);
    const r = playCard(card.instanceId, ctx, cardRegistry, modLookup);
    expect(r.kind).toBe('rejected');
    if (r.kind === 'rejected') expect(r.reason).toBe('missing-target');
  });

  it('rejects unplayable cards (status / curse)', () => {
    const card = makeCardInstance('wound');
    const ctx = makeCtx();
    ctx.piles.hand.push(card);
    const r = playCard(card.instanceId, ctx, cardRegistry, modLookup);
    expect(r.kind).toBe('rejected');
    if (r.kind === 'rejected') expect(r.reason).toBe('unplayable');
    expect(ctx.piles.hand).toContain(card);
  });
});

describe('canPlayCard', () => {
  it('returns ok for legal play', () => {
    const card = makeCardInstance('strike');
    const enemy = makeEnemy('e1');
    const ctx = makeCtx({ enemies: [enemy] });
    ctx.piles.hand.push(card);
    const r = canPlayCard(card.instanceId, ctx, cardRegistry, modLookup, { target: enemy });
    expect(r.ok).toBe(true);
  });

  it('reports specific failure reasons', () => {
    const card = makeCardInstance('reaper');
    const ctx = makeCtx({ player: makePlayer({ energy: 1 }) });
    ctx.piles.hand.push(card);
    const r = canPlayCard(card.instanceId, ctx, cardRegistry, modLookup);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('insufficient-energy');
  });

  it('does not mutate state', () => {
    const card = makeCardInstance('strike');
    const enemy = makeEnemy('e1', 30);
    const ctx = makeCtx({ enemies: [enemy] });
    ctx.piles.hand.push(card);
    canPlayCard(card.instanceId, ctx, cardRegistry, modLookup, { target: enemy });
    expect(enemy.hp).toBe(30);
    expect(ctx.player.energy).toBe(3);
    expect(ctx.piles.hand).toContain(card);
  });
});
