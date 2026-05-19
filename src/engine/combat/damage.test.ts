import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyBlockGain,
  applyDamage,
  applyHeal,
  applyTrueLoseHp,
  calculateBlockGain,
  calculateDamage,
} from './damage.js';
import { applyStatus } from '../statuses/engine.js';
import type {
  Actor,
  EnemyActor,
  PlayerActor,
  StatusDefinition,
  StatusId,
} from '../../types/index.js';
import type { StatusRegistry } from '../statuses/engine.js';

const id = <T extends string>(s: string): T => s as T;

// ---------- Test status defs (damage pipeline) ----------

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

const WEAK: StatusDefinition = {
  id: id<StatusId>('weak'),
  name: '약화',
  description: '',
  stackingRule: 'sum',
  decay: { kind: 'fixedPerTurn', amount: 1 },
  tags: [],
  hooks: [],
  damagePipeline: [{ kind: 'outgoingMul', multiplier: 0.75 }],
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

const DEXTERITY: StatusDefinition = {
  id: id<StatusId>('dexterity'),
  name: '민첩',
  description: '',
  stackingRule: 'sum',
  decay: { kind: 'none' },
  tags: [],
  hooks: [],
  damagePipeline: [{ kind: 'blockGainAdd', perStack: 1 }],
};

const TOUGH_INCOMING_ADD_NEG: StatusDefinition = {
  id: id<StatusId>('tough'),
  name: '강인함',
  description: '',
  stackingRule: 'sum',
  decay: { kind: 'none' },
  tags: [],
  hooks: [],
  damagePipeline: [{ kind: 'incomingAdd', perStack: -1 }],
};

const allStatuses = [VULNERABLE, WEAK, STRENGTH, DEXTERITY, TOUGH_INCOMING_ADD_NEG];
const registry: StatusRegistry = {
  get(id) {
    const s = allStatuses.find(s => s.id === id);
    if (!s) throw new Error(`Status not found: ${id}`);
    return s;
  },
  has(id) {
    return allStatuses.some(s => s.id === id);
  },
};

function makePlayer(opts: { hp?: number; maxHp?: number; block?: number } = {}): PlayerActor {
  return {
    kind: 'player',
    hp: opts.hp ?? 70,
    maxHp: opts.maxHp ?? 70,
    block: opts.block ?? 0,
    energy: 3,
    maxEnergy: 3,
    statuses: [],
  };
}

function makeEnemy(opts: { hp?: number; maxHp?: number; block?: number } = {}): EnemyActor {
  return {
    kind: 'enemy',
    instanceId: 'e1',
    defId: 'enemy_test' as any,
    hp: opts.hp ?? 50,
    maxHp: opts.maxHp ?? 50,
    block: opts.block ?? 0,
    statuses: [],
  };
}

// ---------- calculateDamage ----------

describe('calculateDamage — pure', () => {
  it('passes through raw when no statuses', () => {
    const src = makePlayer();
    const tgt = makeEnemy();
    expect(calculateDamage(src, tgt, 10, registry)).toBe(10);
  });

  it('vulnerable on target multiplies by 1.5 (floored)', () => {
    const src = makePlayer();
    const tgt = makeEnemy();
    applyStatus(tgt, VULNERABLE.id, 1, registry);
    expect(calculateDamage(src, tgt, 10, registry)).toBe(15);
    expect(calculateDamage(src, tgt, 7, registry)).toBe(10); // 10.5 → 10
  });

  it('weak on source multiplies by 0.75 (floored)', () => {
    const src = makePlayer();
    const tgt = makeEnemy();
    applyStatus(src, WEAK.id, 1, registry);
    expect(calculateDamage(src, tgt, 10, registry)).toBe(7); // 7.5 → 7
    expect(calculateDamage(src, tgt, 4, registry)).toBe(3);  // 3 → 3
  });

  it('strength on source adds per stack', () => {
    const src = makePlayer();
    const tgt = makeEnemy();
    applyStatus(src, STRENGTH.id, 3, registry);
    expect(calculateDamage(src, tgt, 10, registry)).toBe(13);
  });

  it('combined: weak + strength + vulnerable', () => {
    const src = makePlayer();
    const tgt = makeEnemy();
    applyStatus(src, WEAK.id, 1, registry);
    applyStatus(src, STRENGTH.id, 2, registry);
    applyStatus(tgt, VULNERABLE.id, 1, registry);
    // 10 (raw)
    //  * 0.75 (weak)  = 7.5
    //  + 2 (strength) = 9.5
    //  * 1.5 (vuln)   = 14.25
    //  floor          = 14
    expect(calculateDamage(src, tgt, 10, registry)).toBe(14);
  });

  it('source undefined: skips outgoing modifiers (true damage path)', () => {
    const tgt = makeEnemy();
    applyStatus(tgt, VULNERABLE.id, 1, registry);
    expect(calculateDamage(undefined, tgt, 10, registry)).toBe(15); // only vuln applies
  });

  it('incomingAdd can reduce damage below raw', () => {
    const tgt = makeEnemy();
    applyStatus(tgt, TOUGH_INCOMING_ADD_NEG.id, 3, registry); // -1 per stack = -3
    expect(calculateDamage(undefined, tgt, 5, registry)).toBe(2);
  });

  it('clamps at 0 (never negative)', () => {
    const tgt = makeEnemy();
    applyStatus(tgt, TOUGH_INCOMING_ADD_NEG.id, 99, registry);
    expect(calculateDamage(undefined, tgt, 5, registry)).toBe(0);
  });

  it('raw 0 stays 0 (no buffs convert nothing to something here)', () => {
    const src = makePlayer();
    const tgt = makeEnemy();
    applyStatus(src, STRENGTH.id, 5, registry);
    // 0 + 5 = 5? Yes — strength's outgoingAdd applies regardless
    expect(calculateDamage(src, tgt, 0, registry)).toBe(5);
  });
});

// ---------- applyDamage ----------

describe('applyDamage — mutation + outcome', () => {
  let src: Actor;
  let tgt: Actor;
  beforeEach(() => {
    src = makePlayer();
    tgt = makeEnemy({ hp: 30, maxHp: 30, block: 5 });
  });

  it('block absorbs full damage when sufficient', () => {
    const r = applyDamage(src, tgt, 3, registry);
    expect(r).toMatchObject({
      attempted: 3, calculated: 3,
      blockConsumed: 3, hpLost: 0, killed: false, blockBroken: false,
    });
    expect(tgt.block).toBe(2);
    expect(tgt.hp).toBe(30);
  });

  it('block partial: rest goes to hp, blockBroken=true', () => {
    const r = applyDamage(src, tgt, 8, registry); // 5 absorbed, 3 to hp
    expect(r).toMatchObject({
      blockConsumed: 5, hpLost: 3, blockBroken: true, killed: false,
    });
    expect(tgt.block).toBe(0);
    expect(tgt.hp).toBe(27);
  });

  it('ignoreBlock: damage skips block entirely', () => {
    const r = applyDamage(src, tgt, 4, registry, { ignoreBlock: true });
    expect(r.blockConsumed).toBe(0);
    expect(r.hpLost).toBe(4);
    expect(tgt.block).toBe(5);
    expect(tgt.hp).toBe(26);
  });

  it('killed when hp reaches 0', () => {
    tgt.hp = 5; tgt.block = 0;
    const r = applyDamage(src, tgt, 5, registry);
    expect(r.killed).toBe(true);
    expect(tgt.hp).toBe(0);
  });

  it('killed when hp would go negative (clamped to 0)', () => {
    tgt.hp = 5; tgt.block = 0;
    const r = applyDamage(src, tgt, 999, registry);
    expect(r.killed).toBe(true);
    expect(tgt.hp).toBe(0);
    expect(r.hpLost).toBe(999); // accounts for what was attempted to land
  });

  it('already-dead target is silent no-op', () => {
    tgt.hp = 0;
    const r = applyDamage(src, tgt, 50, registry);
    expect(r).toMatchObject({ calculated: 0, blockConsumed: 0, hpLost: 0, killed: false });
    expect(tgt.hp).toBe(0);
  });

  it('blockBroken=false when block was already 0', () => {
    tgt.block = 0;
    const r = applyDamage(src, tgt, 5, registry);
    expect(r.blockBroken).toBe(false);
  });

  it('blockBroken=false when block survives intact', () => {
    tgt.block = 10;
    const r = applyDamage(src, tgt, 3, registry);
    expect(r.blockBroken).toBe(false);
    expect(tgt.block).toBe(7);
  });

  it('integrates with status pipeline: vulnerable doubles damage path', () => {
    applyStatus(tgt, VULNERABLE.id, 1, registry);
    tgt.block = 0;
    const r = applyDamage(src, tgt, 10, registry); // 15 after vuln
    expect(r.calculated).toBe(15);
    expect(tgt.hp).toBe(15);
  });
});

// ---------- calculateBlockGain / applyBlockGain ----------

describe('block gain pipeline', () => {
  it('raw gain when no dexterity', () => {
    const p = makePlayer();
    expect(calculateBlockGain(p, 5, registry)).toBe(5);
  });

  it('dexterity adds per stack', () => {
    const p = makePlayer();
    applyStatus(p, DEXTERITY.id, 3, registry);
    expect(calculateBlockGain(p, 5, registry)).toBe(8);
  });

  it('applyBlockGain mutates and returns gained', () => {
    const p = makePlayer({ block: 2 });
    applyStatus(p, DEXTERITY.id, 1, registry);
    const r = applyBlockGain(p, 5, registry);
    expect(r.gained).toBe(6);
    expect(p.block).toBe(8);
  });

  it('clamps to 0', () => {
    const p = makePlayer();
    expect(calculateBlockGain(p, -3, registry)).toBe(0);
  });
});

// ---------- applyTrueLoseHp ----------

describe('applyTrueLoseHp', () => {
  it('honors block by default', () => {
    const p = makePlayer({ hp: 30, block: 5 });
    const r = applyTrueLoseHp(p, 7);
    expect(r.blockConsumed).toBe(5);
    expect(r.hpLost).toBe(2);
    expect(p.hp).toBe(28);
  });

  it('ignoreBlock: true → goes straight to hp', () => {
    const p = makePlayer({ hp: 30, block: 5 });
    const r = applyTrueLoseHp(p, 7, { ignoreBlock: true });
    expect(r.blockConsumed).toBe(0);
    expect(r.hpLost).toBe(7);
    expect(p.hp).toBe(23);
    expect(p.block).toBe(5);
  });

  it('bypasses status pipeline (no vulnerable amplification)', () => {
    const p = makePlayer({ hp: 30, block: 0 });
    applyStatus(p, VULNERABLE.id, 1, registry);
    const r = applyTrueLoseHp(p, 10, { ignoreBlock: true });
    expect(r.hpLost).toBe(10); // not 15
  });
});

// ---------- applyHeal ----------

describe('applyHeal', () => {
  it('heals up to maxHp', () => {
    const p = makePlayer({ hp: 50, maxHp: 70 });
    expect(applyHeal(p, 10)).toBe(10);
    expect(p.hp).toBe(60);
  });

  it('caps at maxHp', () => {
    const p = makePlayer({ hp: 65, maxHp: 70 });
    expect(applyHeal(p, 100)).toBe(5);
    expect(p.hp).toBe(70);
  });

  it('dead target → 0 healed', () => {
    const p = makePlayer({ hp: 0, maxHp: 70 });
    expect(applyHeal(p, 50)).toBe(0);
    expect(p.hp).toBe(0);
  });

  it('non-positive amount → 0', () => {
    const p = makePlayer({ hp: 50, maxHp: 70 });
    expect(applyHeal(p, 0)).toBe(0);
    expect(applyHeal(p, -5)).toBe(0);
  });
});
