import type { SkillDefinition, SkillId } from '../types/index.js';
import type { SkillBoxDefinition } from '../engine/meta/skill-box.js';
import { STATUS_STRENGTH } from './statuses.js';

const id = <T extends string>(s: string): T => s as T;

/**
 * Skills.
 *
 * Each skill is keyed by an id and declares hooks that fire at engine
 * events (onCombatStart / onTurnStart / onEnemyKilled / etc.). Special
 * "skill_sacrifice"-style mechanical effects with no clean hook shape
 * are wired in `game.ts` directly — their `hooks` is informational.
 */

export const SKILL_LIFESTEAL: SkillDefinition = {
  id: id<SkillId>('skill_lifesteal'),
  name: '흡혈', description: '적 처치 시 3 HP 회복.',
  grade: 'common', tags: [], passiveEligible: true,
  hooks: [{ on: 'onEnemyKilled', effects: [{ kind: 'gainHp', amount: 3 }] }],
};

export const SKILL_QUICK_HANDS: SkillDefinition = {
  id: id<SkillId>('skill_quick_hands'),
  name: '빠른 손', description: '매 턴 시작 +1 드로우.',
  grade: 'common', tags: [], passiveEligible: true,
  hooks: [{ on: 'onTurnStart', effects: [{ kind: 'draw', count: 1 }] }],
};

// 4 test-pool skills (per user spec). Combat-only buffs because
// player.statuses[] is cleared at beginCombatWithGroup.
export const SKILL_STRENGTH_1: SkillDefinition = {
  id: id<SkillId>('skill_strength_1'),
  name: '힘증가', description: '전투 시작 시 근력 +1 부여 (해당 전투 한정).',
  grade: 'common', tags: [], passiveEligible: true,
  hooks: [{
    on: 'onCombatStart',
    effects: [{ kind: 'applyStatus', status: STATUS_STRENGTH.id, stacks: 1, target: 'self' }],
  }],
};

export const SKILL_STRENGTH_2: SkillDefinition = {
  id: id<SkillId>('skill_strength_2'),
  name: '괴력', description: '전투 시작 시 근력 +2 부여 (해당 전투 한정).',
  grade: 'rare', tags: [], passiveEligible: true,
  hooks: [{
    on: 'onCombatStart',
    effects: [{ kind: 'applyStatus', status: STATUS_STRENGTH.id, stacks: 2, target: 'self' }],
  }],
};

export const SKILL_STRENGTH_3: SkillDefinition = {
  id: id<SkillId>('skill_strength_3'),
  name: '천부의 힘', description: '전투 시작 시 근력 +3 부여 (해당 전투 한정).',
  grade: 'legendary', tags: [], passiveEligible: true,
  hooks: [{
    on: 'onCombatStart',
    effects: [{ kind: 'applyStatus', status: STATUS_STRENGTH.id, stacks: 3, target: 'self' }],
  }],
};

export const SKILL_SACRIFICE: SkillDefinition = {
  id: id<SkillId>('skill_sacrifice'),
  name: '희생 분신',
  description: '매 턴 드로우 -1. 카드 사용 시 효과가 2번 발동됨.',
  grade: 'legendary', tags: [], passiveEligible: true,
  // Mechanical effects are wired in game.ts (combatEndTurn draw modifier
  // + combatPlayCard duplicate trigger) — hooks here are informational.
  hooks: [],
};

export const ALL_SKILLS: ReadonlyArray<SkillDefinition> = [
  SKILL_LIFESTEAL, SKILL_QUICK_HANDS,
  SKILL_STRENGTH_1, SKILL_STRENGTH_2, SKILL_STRENGTH_3, SKILL_SACRIFICE,
];

// --------------------------------------------------------------------
// Skill boxes — meta-shop bags of skills purchased between runs.
// --------------------------------------------------------------------

export const SKILL_BOX_COMMON: SkillBoxDefinition = {
  grade: 'common', priceGold: 50,
  entries: [
    { skillId: SKILL_LIFESTEAL.id, weight: 1 },
    { skillId: SKILL_QUICK_HANDS.id, weight: 1 },
  ],
};

export const ALL_SKILL_BOXES: ReadonlyArray<SkillBoxDefinition> = [SKILL_BOX_COMMON];

/**
 * Treasure / skill-book pool — listed inline in FLOW_TREASURE's
 * skillOffer step via poolOverride. When all entries are owned, the
 * offer falls back to gold-per-slot.
 */
export const TREASURE_SKILL_POOL: ReadonlyArray<SkillId> = [
  SKILL_STRENGTH_1.id,
  SKILL_STRENGTH_2.id,
  SKILL_STRENGTH_3.id,
  SKILL_SACRIFICE.id,
];
