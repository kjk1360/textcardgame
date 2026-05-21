import { describe, expect, it } from 'vitest';
import {
  collectSkillHooks,
  getActiveSkillIds,
  type SkillRegistry,
} from './engine.js';
import {
  eligibleForPromotion,
  noEligiblePromotion,
  promoteToPassive,
} from '../meta/passives.js';
import type { SkillDefinition, SkillId } from '../../types/index.js';

const id = <T extends string>(s: string): T => s as T;

// ---------- Fixtures ----------

function makeSkill(opts: {
  id: string;
  hooks?: Array<{ on: string; effects: any[] }>;
  passiveEligible?: boolean;
  grade?: SkillDefinition['grade'];
}): SkillDefinition {
  return {
    id: id<SkillId>(opts.id),
    name: opts.id,
    description: '',
    grade: opts.grade ?? 'common',
    tags: [],
    passiveEligible: opts.passiveEligible ?? true,
    hooks: (opts.hooks ?? []).map(h => ({
      on: h.on as any,
      effects: h.effects,
    })),
  };
}

const SK_BLOODLUST = makeSkill({
  id: 'sk_bloodlust',
  hooks: [{ on: 'onEnemyKilled', effects: [{ kind: 'gainEnergy', amount: 1 }] }],
});

const SK_DRAW_PLUS = makeSkill({
  id: 'sk_draw_plus',
  hooks: [{ on: 'onTurnStart', effects: [{ kind: 'draw', count: 1 }] }],
});

const SK_PASSIVE_HEAL = makeSkill({
  id: 'sk_heal_combat_start',
  hooks: [{ on: 'onCombatStart', effects: [{ kind: 'gainHp', amount: 5 }] }],
  passiveEligible: true,
});

const SK_BAN_FROM_PASSIVE = makeSkill({
  id: 'sk_overpowered',
  hooks: [{ on: 'onCombatStart', effects: [{ kind: 'gainEnergy', amount: 999 }] }],
  passiveEligible: false,
});

const SK_MULTI_HOOK = makeSkill({
  id: 'sk_multi',
  hooks: [
    { on: 'onTurnStart', effects: [{ kind: 'gainGold', amount: 1 }] },
    { on: 'onTurnEnd', effects: [{ kind: 'gainHp', amount: 1 }] },
    { on: 'onCombatEnd', effects: [{ kind: 'gainGold', amount: 5 }] },
  ],
});

const allSkills = [SK_BLOODLUST, SK_DRAW_PLUS, SK_PASSIVE_HEAL, SK_BAN_FROM_PASSIVE, SK_MULTI_HOOK];

const registry: SkillRegistry = {
  get(sid) {
    const s = allSkills.find(x => x.id === sid);
    if (!s) throw new Error(`Skill not found: ${sid}`);
    return s;
  },
  has(sid) { return allSkills.some(x => x.id === sid); },
};

// ====================================================================
// getActiveSkillIds — merge + dedup
// ====================================================================

describe('getActiveSkillIds', () => {
  it('character-only skills', () => {
    const r = getActiveSkillIds([SK_BLOODLUST.id, SK_DRAW_PLUS.id], []);
    expect(r.map(x => x.id)).toEqual([SK_BLOODLUST.id, SK_DRAW_PLUS.id]);
    expect(r.every(x => x.source === 'character')).toBe(true);
  });

  it('passive-only skills', () => {
    const r = getActiveSkillIds([], [SK_PASSIVE_HEAL.id]);
    expect(r).toEqual([{ id: SK_PASSIVE_HEAL.id, source: 'passive' }]);
  });

  it('character + passive merged', () => {
    const r = getActiveSkillIds([SK_BLOODLUST.id], [SK_PASSIVE_HEAL.id]);
    expect(r).toHaveLength(2);
    expect(r.find(x => x.id === SK_BLOODLUST.id)?.source).toBe('character');
    expect(r.find(x => x.id === SK_PASSIVE_HEAL.id)?.source).toBe('passive');
  });

  it('dedup: passive wins when same id present in both', () => {
    const r = getActiveSkillIds([SK_BLOODLUST.id], [SK_BLOODLUST.id]);
    expect(r).toEqual([{ id: SK_BLOODLUST.id, source: 'passive' }]);
  });
});

// ====================================================================
// collectSkillHooks
// ====================================================================

describe('collectSkillHooks', () => {
  it('finds hooks matching the event', () => {
    const hooks = collectSkillHooks(
      [SK_BLOODLUST.id, SK_DRAW_PLUS.id],
      [],
      'onTurnStart',
      registry,
    );
    expect(hooks).toHaveLength(1);
    expect(hooks[0]?.skillId).toBe(SK_DRAW_PLUS.id);
  });

  it('returns empty when no skill responds to event', () => {
    const hooks = collectSkillHooks(
      [SK_DRAW_PLUS.id],
      [],
      'onNodeEntered',
      registry,
    );
    expect(hooks).toHaveLength(0);
  });

  it('merges passive skill hooks', () => {
    const hooks = collectSkillHooks(
      [SK_DRAW_PLUS.id],
      [SK_PASSIVE_HEAL.id],
      'onCombatStart',
      registry,
    );
    expect(hooks).toHaveLength(1);
    expect(hooks[0]?.skillId).toBe(SK_PASSIVE_HEAL.id);
    expect(hooks[0]?.source).toBe('passive');
  });

  it('multi-hook skill: each matching event returns its own', () => {
    const startHooks = collectSkillHooks([SK_MULTI_HOOK.id], [], 'onTurnStart', registry);
    const endHooks   = collectSkillHooks([SK_MULTI_HOOK.id], [], 'onTurnEnd', registry);
    const combatEnd  = collectSkillHooks([SK_MULTI_HOOK.id], [], 'onCombatEnd', registry);
    expect(startHooks).toHaveLength(1);
    expect(endHooks).toHaveLength(1);
    expect(combatEnd).toHaveLength(1);
    expect(startHooks[0]?.hookIndex).toBe(0);
    expect(endHooks[0]?.hookIndex).toBe(1);
    expect(combatEnd[0]?.hookIndex).toBe(2);
  });

  it('unknown skill ids are skipped (defensive — for stale saves)', () => {
    const hooks = collectSkillHooks(
      [SK_DRAW_PLUS.id, id<SkillId>('sk_does_not_exist')],
      [],
      'onTurnStart',
      registry,
    );
    expect(hooks).toHaveLength(1);
    expect(hooks[0]?.skillId).toBe(SK_DRAW_PLUS.id);
  });
});

// ====================================================================
// passives module
// ====================================================================

describe('passives — promoteToPassive', () => {
  it('promotes an eligible skill', () => {
    const state = { passiveSkills: [] };
    const r = promoteToPassive(state, SK_PASSIVE_HEAL.id, registry);
    expect(r.ok).toBe(true);
    expect(state.passiveSkills).toEqual([SK_PASSIVE_HEAL.id]);
  });

  it('rejects already-passive skill', () => {
    const state = { passiveSkills: [SK_PASSIVE_HEAL.id] };
    const r = promoteToPassive(state, SK_PASSIVE_HEAL.id, registry);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('already-passive');
    expect(state.passiveSkills).toEqual([SK_PASSIVE_HEAL.id]);
  });

  it('rejects not-eligible skill', () => {
    const state = { passiveSkills: [] };
    const r = promoteToPassive(state, SK_BAN_FROM_PASSIVE.id, registry);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not-eligible');
    expect(state.passiveSkills).toEqual([]);
  });

  it('rejects unknown skill', () => {
    const state = { passiveSkills: [] };
    const r = promoteToPassive(state, id<SkillId>('nope'), registry);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unknown-skill');
  });
});

describe('passives — eligibleForPromotion / noEligiblePromotion', () => {
  it('returns passive-eligible character skills', () => {
    const state = { passiveSkills: [] };
    const skills = eligibleForPromotion(
      [SK_BLOODLUST.id, SK_BAN_FROM_PASSIVE.id, SK_PASSIVE_HEAL.id],
      state,
      registry,
    );
    expect(skills.map(s => s.id).sort()).toEqual(
      [SK_BLOODLUST.id, SK_PASSIVE_HEAL.id].sort(),
    );
  });

  it('excludes already-passive', () => {
    const state = { passiveSkills: [SK_PASSIVE_HEAL.id] };
    const skills = eligibleForPromotion(
      [SK_BLOODLUST.id, SK_PASSIVE_HEAL.id],
      state,
      registry,
    );
    expect(skills.map(s => s.id)).toEqual([SK_BLOODLUST.id]);
  });

  it('excludes not-eligible', () => {
    const state = { passiveSkills: [] };
    const skills = eligibleForPromotion(
      [SK_BAN_FROM_PASSIVE.id],
      state,
      registry,
    );
    expect(skills).toHaveLength(0);
  });

  it('noEligiblePromotion correctly detects empty', () => {
    const state = { passiveSkills: [SK_PASSIVE_HEAL.id] };
    expect(noEligiblePromotion([SK_PASSIVE_HEAL.id, SK_BAN_FROM_PASSIVE.id], state, registry)).toBe(true);
    expect(noEligiblePromotion([SK_BLOODLUST.id], state, registry)).toBe(false);
    expect(noEligiblePromotion([], state, registry)).toBe(true);
  });
});
