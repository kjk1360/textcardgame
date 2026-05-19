import { describe, expect, it } from 'vitest';
import {
  applyDifficultyBuffsToEnemies,
  getDifficultyEntry,
  isAtFinalDifficulty,
  makeDefaultDifficultyTable,
  type DifficultyTable,
  type SpecialBuff,
} from './difficulty.js';
import { applyStatus, getStacks, type StatusRegistry } from '../statuses/engine.js';
import type {
  EnemyActor,
  EnemyId,
  StatusDefinition,
  StatusId,
} from '../../types/index.js';

const id = <T extends string>(s: string): T => s as T;

// ---------- Status fixtures ----------

const STRENGTH: StatusDefinition = {
  id: id<StatusId>('strength'),
  name: '근력', description: '',
  stackingRule: 'sum', decay: { kind: 'none' },
  tags: [], hooks: [],
};
const DEXTERITY: StatusDefinition = {
  id: id<StatusId>('dexterity'),
  name: '민첩', description: '',
  stackingRule: 'sum', decay: { kind: 'none' },
  tags: [], hooks: [],
};
const THORNS: StatusDefinition = {
  id: id<StatusId>('thorns'),
  name: '가시', description: '',
  stackingRule: 'sum', decay: { kind: 'none' },
  tags: [], hooks: [],
};
const REGEN: StatusDefinition = {
  id: id<StatusId>('regen'),
  name: '재생', description: '',
  stackingRule: 'sum', decay: { kind: 'oneStackPerTrigger' },
  tags: [], hooks: [],
};
const FIRST_HIT_INVULN: StatusDefinition = {
  id: id<StatusId>('firstHitInvuln'),
  name: '첫피격무효', description: '',
  stackingRule: 'max', decay: { kind: 'oneStackPerTrigger' },
  tags: [], hooks: [],
};
const META_EXTRA_INTENT: StatusDefinition = {
  id: id<StatusId>('meta_extra_intent'),
  name: '의도+1', description: '',
  stackingRule: 'max', decay: { kind: 'none' },
  tags: [], hooks: [],
};

const allStatuses = [STRENGTH, DEXTERITY, THORNS, REGEN, FIRST_HIT_INVULN, META_EXTRA_INTENT];
const statusRegistry: StatusRegistry = {
  get(sid) {
    const s = allStatuses.find(x => x.id === sid);
    if (!s) throw new Error(`Unknown status: ${sid}`);
    return s;
  },
  has(sid) { return allStatuses.some(x => x.id === sid); },
};

// ---------- Helpers ----------

function makeEnemy(name: string, hp: number = 30): EnemyActor {
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

// ====================================================================
// Lookup / final check
// ====================================================================

describe('getDifficultyEntry / isAtFinalDifficulty', () => {
  const table = makeDefaultDifficultyTable();

  it('returns the entry for the given level', () => {
    expect(getDifficultyEntry(table, 0)).toMatchObject({
      level: 0,
      enemyHpMultiplier: 1,
      enemyStrengthBonus: 0,
    });
    expect(getDifficultyEntry(table, 5)).toMatchObject({
      level: 5, enemyStrengthBonus: 5,
    });
  });

  it('clamps below min and above max', () => {
    expect(getDifficultyEntry(table, -10).level).toBe(0);
    expect(getDifficultyEntry(table, 999).level).toBe(20);
  });

  it('isAtFinalDifficulty true at or beyond max', () => {
    expect(isAtFinalDifficulty(table, 19)).toBe(false);
    expect(isAtFinalDifficulty(table, 20)).toBe(true);
    expect(isAtFinalDifficulty(table, 100)).toBe(true);
  });
});

// ====================================================================
// applyDifficultyBuffsToEnemies
// ====================================================================

describe('applyDifficultyBuffsToEnemies', () => {
  const table = makeDefaultDifficultyTable();

  it('level 0 — no change', () => {
    const e = makeEnemy('e1', 30);
    applyDifficultyBuffsToEnemies([e], 0, table, statusRegistry);
    expect(e.maxHp).toBe(30);
    expect(e.hp).toBe(30);
    expect(e.statuses).toHaveLength(0);
  });

  it('scales HP by multiplier and restores to full', () => {
    const e = makeEnemy('e1', 30);
    e.hp = 15; // wounded — should be restored after scaling
    applyDifficultyBuffsToEnemies([e], 5, table, statusRegistry); // ×1.5
    expect(e.maxHp).toBe(45);
    expect(e.hp).toBe(45);
  });

  it('applies strength stacks', () => {
    const e = makeEnemy('e1', 30);
    applyDifficultyBuffsToEnemies([e], 3, table, statusRegistry);
    expect(getStacks(e, STRENGTH.id)).toBe(3);
  });

  it('special buff: thorns at level 3', () => {
    const e = makeEnemy('e1', 30);
    applyDifficultyBuffsToEnemies([e], 3, table, statusRegistry);
    expect(getStacks(e, THORNS.id)).toBe(2);
  });

  it('special buff: firstHitInvuln at level 5', () => {
    const e = makeEnemy('e1', 30);
    applyDifficultyBuffsToEnemies([e], 5, table, statusRegistry);
    expect(getStacks(e, FIRST_HIT_INVULN.id)).toBe(1);
  });

  it('special buff: startWithBlock at level 7', () => {
    const e = makeEnemy('e1', 30);
    applyDifficultyBuffsToEnemies([e], 7, table, statusRegistry);
    expect(e.block).toBe(5);
  });

  it('special buff: regenPerTurn at level 10', () => {
    const e = makeEnemy('e1', 30);
    applyDifficultyBuffsToEnemies([e], 10, table, statusRegistry);
    expect(getStacks(e, REGEN.id)).toBe(1);
  });

  it('special buff: extraIntent at level 15 (marker status)', () => {
    const e = makeEnemy('e1', 30);
    applyDifficultyBuffsToEnemies([e], 15, table, statusRegistry);
    expect(getStacks(e, META_EXTRA_INTENT.id)).toBe(1);
  });

  it('special buffs: multiple at level 20 (final boss)', () => {
    const e = makeEnemy('e1', 30);
    applyDifficultyBuffsToEnemies([e], 20, table, statusRegistry);
    expect(getStacks(e, REGEN.id)).toBe(3);
    expect(getStacks(e, THORNS.id)).toBe(5);
    expect(getStacks(e, STRENGTH.id)).toBe(20);
  });

  it('multiple enemies all get the same buffs', () => {
    const enemies = [makeEnemy('a', 10), makeEnemy('b', 20), makeEnemy('c', 30)];
    applyDifficultyBuffsToEnemies(enemies, 3, table, statusRegistry);
    for (const e of enemies) {
      expect(getStacks(e, STRENGTH.id)).toBe(3);
      expect(getStacks(e, THORNS.id)).toBe(2);
    }
  });

  it('custom buff handler invoked via registry', () => {
    const customTable: DifficultyTable = {
      min: 0, max: 0,
      entries: new Map([
        [0, {
          level: 0,
          enemyHpMultiplier: 1,
          enemyStrengthBonus: 0,
          specialBuffs: [{ kind: 'custom', handlerId: 'double_block' }],
        }],
      ]),
    };
    const customHandlers = new Map([
      ['double_block', (enemy: EnemyActor) => { enemy.block += 99; }],
    ]);
    const e = makeEnemy('e1', 30);
    applyDifficultyBuffsToEnemies([e], 0, customTable, statusRegistry, { customBuffHandlers: customHandlers });
    expect(e.block).toBe(99);
  });

  it('custom buff without registered handler throws', () => {
    const customTable: DifficultyTable = {
      min: 0, max: 0,
      entries: new Map([
        [0, {
          level: 0,
          enemyHpMultiplier: 1, enemyStrengthBonus: 0,
          specialBuffs: [{ kind: 'custom', handlerId: 'nope' }],
        }],
      ]),
    };
    const e = makeEnemy('e1', 30);
    expect(() =>
      applyDifficultyBuffsToEnemies([e], 0, customTable, statusRegistry),
    ).toThrow(/not provided/);
  });

  it('clamps level lookups to table bounds', () => {
    const e = makeEnemy('e1', 30);
    applyDifficultyBuffsToEnemies([e], 999, table, statusRegistry); // clamps to 20
    expect(getStacks(e, STRENGTH.id)).toBe(20);
  });

  it('overridable status ids: respects opts.strengthStatusId', () => {
    const myStr: StatusDefinition = {
      ...STRENGTH,
      id: id<StatusId>('my_strength'),
    };
    const reg: StatusRegistry = {
      get(sid) { return sid === 'my_strength' ? myStr : statusRegistry.get(sid); },
      has(sid) { return sid === 'my_strength' || statusRegistry.has(sid); },
    };
    const e = makeEnemy('e1', 30);
    applyDifficultyBuffsToEnemies([e], 3, table, reg, {
      strengthStatusId: id<StatusId>('my_strength'),
    });
    expect(getStacks(e, id<StatusId>('my_strength'))).toBe(3);
    expect(getStacks(e, STRENGTH.id)).toBe(0);
  });
});

// ====================================================================
// makeDefaultDifficultyTable
// ====================================================================

describe('makeDefaultDifficultyTable', () => {
  it('has entries for all levels [0..20]', () => {
    const t = makeDefaultDifficultyTable();
    for (let i = 0; i <= 20; i++) {
      expect(t.entries.has(i)).toBe(true);
    }
  });

  it('hp multiplier grows monotonically per level', () => {
    const t = makeDefaultDifficultyTable();
    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const m = t.entries.get(i)!.enemyHpMultiplier;
      expect(m).toBeGreaterThan(prev);
      prev = m;
    }
  });

  it('level 20 marked as final boss in description', () => {
    const t = makeDefaultDifficultyTable();
    expect(t.entries.get(20)?.description).toContain('최종보스');
  });
});
