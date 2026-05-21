import type { Modifier, ModifierId } from '../types/index.js';
import {
  STATUS_BLEED,
  STATUS_EVASION,
  STATUS_POISON,
  STATUS_STRENGTH_TEMP,
  STATUS_WEAK,
} from './statuses.js';

const id = <T extends string>(s: string): T => s as T;

// --- 단검 풀 ---

/**
 * 확산 — 모든 damage/damageMultiHit effect의 target을 'allEnemies'로 override.
 * (단검 풀 + 단일공격 풀 양쪽에 들어가지만 sampler가 dedupe.)
 */
export const MOD_SPREAD: Modifier = {
  id: id<ModifierId>('mod_spread'),
  name: '확산', descriptionTemplate: '공격이 모든 적에게 적중합니다.',
  tags: [], weight: 4,
  transforms: [
    { op: 'modifyEffect', match: { kind: 'damage' }, set: { target: 'allEnemies' } },
    { op: 'modifyEffect', match: { kind: 'damageMultiHit' }, set: { target: 'allEnemies' } },
  ],
};

/** 독바르기 — 적중 후 적에 중독 +3 (단검 풀 한정). */
export const MOD_POISON_COAT: Modifier = {
  id: id<ModifierId>('mod_poison_coat'),
  name: '독바르기', descriptionTemplate: '피해를 받은 적이 중독 3을 얻습니다.',
  tags: [], weight: 5,
  transforms: [{
    op: 'appendEffect',
    effect: { kind: 'applyStatus', status: STATUS_POISON.id, stacks: 3, target: 'enemy' },
  }],
};

/** 단검 묘기 — exhaust 키워드 제거. */
export const MOD_DAGGER_TRICK: Modifier = {
  id: id<ModifierId>('mod_dagger_trick'),
  name: '단검 묘기', descriptionTemplate: '소멸을 무시합니다.',
  tags: [], weight: 3,
  transforms: [{ op: 'removeKeyword', keyword: 'exhaust' }],
};

// --- 물리 풀 ---

/** 연마 — 피해량 +1. */
export const MOD_HONE: Modifier = {
  id: id<ModifierId>('mod_hone'),
  name: '연마', descriptionTemplate: '피해량을 1 증가시킵니다.',
  tags: [], weight: 8,
  transforms: [{ op: 'modifyEffect', match: { kind: 'damage' }, set: { amount: { delta: 1 } } }],
};

/** 기름칠 — 비용 -1. */
export const MOD_OIL: Modifier = {
  id: id<ModifierId>('mod_oil'),
  name: '기름칠', descriptionTemplate: '비용을 1 감소시킵니다.',
  tags: [], weight: 4,
  transforms: [{ op: 'modifyCost', delta: -1 }],
};

/** 뾰족니 — 적중 대상에 출혈 +2. */
export const MOD_BARB: Modifier = {
  id: id<ModifierId>('mod_barb'),
  name: '뾰족니', descriptionTemplate: '적중하는 대상에게 출혈을 2 부여합니다.',
  tags: [], weight: 5,
  transforms: [{
    op: 'appendEffect',
    effect: { kind: 'applyStatus', status: STATUS_BLEED.id, stacks: 2, target: 'enemy' },
  }],
};

/** 압도 — 적중 대상에 약화 +1. */
export const MOD_OVERPOWER: Modifier = {
  id: id<ModifierId>('mod_overpower'),
  name: '압도', descriptionTemplate: '적중하는 대상에게 약화를 1 부여합니다.',
  tags: [], weight: 5,
  transforms: [{
    op: 'appendEffect',
    effect: { kind: 'applyStatus', status: STATUS_WEAK.id, stacks: 1, target: 'enemy' },
  }],
};

// --- 단일공격 풀 (확산은 위 단검 풀에서 정의) ---

/** 지속 전투 — 사용 시 자신 HP +1 (단일공격/단일방어 양쪽). */
export const MOD_SUSTAIN: Modifier = {
  id: id<ModifierId>('mod_sustain'),
  name: '지속 전투', descriptionTemplate: '사용 시 자신의 HP를 1 회복합니다 (최대 초과 X).',
  tags: [], weight: 4,
  transforms: [{
    op: 'appendEffect',
    effect: { kind: 'gainHp', amount: 1 },
  }],
};

/** 전열 — 사용 시 이번 턴 한정 근력 +1. */
export const MOD_RALLY: Modifier = {
  id: id<ModifierId>('mod_rally'),
  name: '전열', descriptionTemplate: '사용 시 이번 턴에만 근력 +1.',
  tags: [], weight: 4,
  transforms: [{
    op: 'appendEffect',
    effect: { kind: 'applyStatus', status: STATUS_STRENGTH_TEMP.id, stacks: 1, target: 'self' },
  }],
};

// --- 단일방어 풀 ---

/** 단련 — 방어도 +2. */
export const MOD_HARDEN: Modifier = {
  id: id<ModifierId>('mod_harden'),
  name: '단련', descriptionTemplate: '방어도를 2 추가로 획득합니다.',
  tags: [], weight: 6,
  transforms: [{ op: 'modifyEffect', match: { kind: 'gainBlock' }, set: { amount: { delta: 2 } } }],
};

/** 흐릿해지기 — 이번 턴 회피 +1. */
export const MOD_BLUR: Modifier = {
  id: id<ModifierId>('mod_blur'),
  name: '흐릿해지기', descriptionTemplate: '사용 시 이번 턴에만 회피 +1.',
  tags: [], weight: 3,
  transforms: [{
    op: 'appendEffect',
    effect: { kind: 'applyStatus', status: STATUS_EVASION.id, stacks: 1, target: 'self' },
  }],
};

export const ALL_MODIFIERS: ReadonlyArray<Modifier> = [
  MOD_SPREAD, MOD_POISON_COAT, MOD_DAGGER_TRICK,
  MOD_HONE, MOD_OIL, MOD_BARB, MOD_OVERPOWER,
  MOD_SUSTAIN, MOD_RALLY,
  MOD_HARDEN, MOD_BLUR,
];
