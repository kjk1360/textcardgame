import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyStatus,
  collectHooks,
  decayAtTurnEnd,
  getStacks,
  hasStatus,
  reduceStatusStacks,
  removeStatus,
  type StatusRegistry,
} from './engine.js';
import type {
  Actor,
  EffectTag,
  PlayerActor,
  StatusDefinition,
  StatusId,
} from '../../types/index.js';

const id = <T extends string>(s: string): T => s as T;

// ---------- Test status definitions ----------

const STR: StatusDefinition = {
  id: id<StatusId>('strength'),
  name: '근력',
  description: '',
  stackingRule: 'sum',
  decay: { kind: 'none' },
  tags: [],
  hooks: [],
};

const WEAK: StatusDefinition = {
  id: id<StatusId>('weak'),
  name: '약화',
  description: '',
  stackingRule: 'sum',
  decay: { kind: 'fixedPerTurn', amount: 1 },
  tags: [],
  hooks: [],
};

const BARRIER: StatusDefinition = {
  id: id<StatusId>('barrier'),
  name: '보호막',
  description: '',
  stackingRule: 'max',
  decay: { kind: 'allAtEndOfTurn' },
  tags: [],
  hooks: [],
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
      effects: [{ kind: 'loseHp', amount: 1, ignoreBlock: true }],
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
    { on: 'onOwnerTurnEnd', effects: [{ kind: 'gainHp', amount: 1 }] },
  ],
};

const MULTI_HOOK: StatusDefinition = {
  id: id<StatusId>('multi'),
  name: '복합',
  description: '',
  stackingRule: 'sum',
  decay: { kind: 'none' },
  tags: [],
  hooks: [
    { on: 'onOwnerTurnStart', effects: [{ kind: 'draw', count: 1 }] },
    { on: 'onOwnerTurnEnd',   effects: [{ kind: 'gainGold', amount: 1 }] },
    { on: 'onCardPlayed',     effects: [{ kind: 'gainEnergy', amount: 1 }] },
  ],
};

const allStatuses = [STR, WEAK, BARRIER, BLEED, REGEN, MULTI_HOOK];

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

// ---------- Tests ----------

describe('applyStatus — stacking rules', () => {
  let actor: Actor;
  beforeEach(() => { actor = makePlayer(); });

  it('initial apply pushes new instance', () => {
    applyStatus(actor, STR.id, 3, registry);
    expect(actor.statuses).toHaveLength(1);
    expect(getStacks(actor, STR.id)).toBe(3);
  });

  it("sum: subsequent applies add", () => {
    applyStatus(actor, STR.id, 3, registry);
    applyStatus(actor, STR.id, 2, registry);
    expect(getStacks(actor, STR.id)).toBe(5);
  });

  it('max: subsequent applies take the larger', () => {
    applyStatus(actor, BARRIER.id, 2, registry);
    applyStatus(actor, BARRIER.id, 5, registry);
    expect(getStacks(actor, BARRIER.id)).toBe(5);
    applyStatus(actor, BARRIER.id, 1, registry);
    expect(getStacks(actor, BARRIER.id)).toBe(5); // 1 is smaller, ignored
  });

  it('zero or negative stacks is a no-op', () => {
    applyStatus(actor, STR.id, 0, registry);
    applyStatus(actor, STR.id, -3, registry);
    expect(actor.statuses).toHaveLength(0);
  });
});

describe('removeStatus / reduceStatusStacks / hasStatus', () => {
  let actor: Actor;
  beforeEach(() => { actor = makePlayer(); });

  it('removeStatus deletes', () => {
    applyStatus(actor, STR.id, 5, registry);
    expect(removeStatus(actor, STR.id)).toBe(true);
    expect(hasStatus(actor, STR.id)).toBe(false);
  });

  it('removeStatus on missing returns false', () => {
    expect(removeStatus(actor, STR.id)).toBe(false);
  });

  it('reduceStatusStacks: partial reduction', () => {
    applyStatus(actor, STR.id, 5, registry);
    reduceStatusStacks(actor, STR.id, 2);
    expect(getStacks(actor, STR.id)).toBe(3);
  });

  it('reduceStatusStacks: removes when reaching 0', () => {
    applyStatus(actor, STR.id, 3, registry);
    reduceStatusStacks(actor, STR.id, 3);
    expect(hasStatus(actor, STR.id)).toBe(false);
  });

  it('reduceStatusStacks: clamps at 0 (over-reduce)', () => {
    applyStatus(actor, STR.id, 3, registry);
    reduceStatusStacks(actor, STR.id, 10);
    expect(hasStatus(actor, STR.id)).toBe(false);
  });
});

describe('decayAtTurnEnd', () => {
  let actor: Actor;
  beforeEach(() => { actor = makePlayer(); });

  it("'none' decay: stacks unchanged", () => {
    applyStatus(actor, STR.id, 5, registry);
    decayAtTurnEnd(actor, registry);
    expect(getStacks(actor, STR.id)).toBe(5);
  });

  it("'fixedPerTurn 1': reduces by 1", () => {
    applyStatus(actor, WEAK.id, 3, registry);
    decayAtTurnEnd(actor, registry);
    expect(getStacks(actor, WEAK.id)).toBe(2);
    decayAtTurnEnd(actor, registry);
    decayAtTurnEnd(actor, registry);
    expect(hasStatus(actor, WEAK.id)).toBe(false);
  });

  it("'allAtEndOfTurn': removes entirely", () => {
    applyStatus(actor, BARRIER.id, 99, registry);
    decayAtTurnEnd(actor, registry);
    expect(hasStatus(actor, BARRIER.id)).toBe(false);
  });

  it("'oneStackPerTrigger': turn-end decay does NOT reduce", () => {
    applyStatus(actor, BLEED.id, 5, registry);
    decayAtTurnEnd(actor, registry);
    expect(getStacks(actor, BLEED.id)).toBe(5); // trigger-based, not turn-based
  });

  it('multiple statuses with different decay rules processed together', () => {
    applyStatus(actor, STR.id, 3, registry);
    applyStatus(actor, WEAK.id, 2, registry);
    applyStatus(actor, BARRIER.id, 4, registry);
    applyStatus(actor, BLEED.id, 3, registry);
    decayAtTurnEnd(actor, registry);
    expect(getStacks(actor, STR.id)).toBe(3);     // none
    expect(getStacks(actor, WEAK.id)).toBe(1);    // -1
    expect(hasStatus(actor, BARRIER.id)).toBe(false); // wiped
    expect(getStacks(actor, BLEED.id)).toBe(3);   // trigger-based, untouched
  });
});

describe('collectHooks', () => {
  it('returns hooks matching event', () => {
    const actor = makePlayer();
    applyStatus(actor, BLEED.id, 5, registry);
    const hooks = collectHooks(actor, 'onOwnerTurnStart', registry);
    expect(hooks).toHaveLength(1);
    expect(hooks[0]!.statusId).toBe(BLEED.id);
    expect(hooks[0]!.stacks).toBe(5);
    expect(hooks[0]!.decayOnFire).toBe(true);
  });

  it('ignores hooks for different events', () => {
    const actor = makePlayer();
    applyStatus(actor, BLEED.id, 1, registry);
    const hooks = collectHooks(actor, 'onCardPlayed', registry);
    expect(hooks).toHaveLength(0);
  });

  it('returns multiple hooks across statuses', () => {
    const actor = makePlayer();
    applyStatus(actor, BLEED.id, 1, registry);
    applyStatus(actor, MULTI_HOOK.id, 1, registry);
    const startHooks = collectHooks(actor, 'onOwnerTurnStart', registry);
    expect(startHooks.map(h => h.statusId).sort()).toEqual([BLEED.id, MULTI_HOOK.id].sort());
  });

  it('single status with multiple hooks: only matching event returned', () => {
    const actor = makePlayer();
    applyStatus(actor, MULTI_HOOK.id, 1, registry);
    const start = collectHooks(actor, 'onOwnerTurnStart', registry);
    const end = collectHooks(actor, 'onOwnerTurnEnd', registry);
    const play = collectHooks(actor, 'onCardPlayed', registry);
    expect(start).toHaveLength(1);
    expect(end).toHaveLength(1);
    expect(play).toHaveLength(1);
  });

  it("decayOnFire flag: true only for 'oneStackPerTrigger' statuses", () => {
    const actor = makePlayer();
    applyStatus(actor, BLEED.id, 1, registry);       // oneStackPerTrigger
    applyStatus(actor, MULTI_HOOK.id, 1, registry);   // none
    const hooks = collectHooks(actor, 'onOwnerTurnStart', registry);
    const bleed = hooks.find(h => h.statusId === BLEED.id)!;
    const multi = hooks.find(h => h.statusId === MULTI_HOOK.id)!;
    expect(bleed.decayOnFire).toBe(true);
    expect(multi.decayOnFire).toBe(false);
  });

  it('returns empty for unknown statuses (defensive)', () => {
    const actor = makePlayer();
    actor.statuses.push({ id: id<StatusId>('unknown'), stacks: 1 });
    const hooks = collectHooks(actor, 'onOwnerTurnStart', registry);
    expect(hooks).toHaveLength(0);
  });
});

describe('lifecycle: full bleed cycle (apply → trigger decay → eventual removal)', () => {
  it("3 bleed stacks → 3 trigger fires → stacks 0", () => {
    const actor = makePlayer();
    applyStatus(actor, BLEED.id, 3, registry);

    for (let t = 0; t < 3; t++) {
      const hooks = collectHooks(actor, 'onOwnerTurnStart', registry);
      expect(hooks.length).toBe(1);
      const h = hooks[0]!;
      // Caller would execute effects here; we just simulate the decay
      if (h.decayOnFire) reduceStatusStacks(actor, h.statusId, 1);
    }

    expect(hasStatus(actor, BLEED.id)).toBe(false);
    const finalHooks = collectHooks(actor, 'onOwnerTurnStart', registry);
    expect(finalHooks).toHaveLength(0);
  });
});
