import type { StatusDefinition, StatusId } from '../types/index.js';

const id = <T extends string>(s: string): T => s as T;

/**
 * Status definitions.
 *
 * 통일 규칙:
 *  - 영구 능력치(근력·민첩 등): decay 'none' + damagePipeline outgoing/blockGain
 *  - 디버프(취약·약화 등): decay fixedPerTurn 1 + damagePipeline incoming/outgoing
 *  - this-turn 버프(전열·회피 등): decay 'allAtEndOfTurn'(또는 oneStackPerTrigger
 *    + onOwnerTurnEnd removeStatus 자기자신)
 *  - 틱 데미지(중독·출혈): custom 'tickStatusDamage' 핸들러 + fixedPerTurn 1
 */

export const STATUS_VULNERABLE: StatusDefinition = {
  id: id<StatusId>('vulnerable'), name: '취약', description: '받는 피해 +50%',
  stackingRule: 'sum', decay: { kind: 'fixedPerTurn', amount: 1 },
  tags: [], hooks: [],
  damagePipeline: [{ kind: 'incomingMul', multiplier: 1.5 }],
};

export const STATUS_WEAK: StatusDefinition = {
  id: id<StatusId>('weak'), name: '약화', description: '주는 피해 -25%',
  stackingRule: 'sum', decay: { kind: 'fixedPerTurn', amount: 1 },
  tags: [], hooks: [],
  damagePipeline: [{ kind: 'outgoingMul', multiplier: 0.75 }],
};

export const STATUS_STRENGTH: StatusDefinition = {
  id: id<StatusId>('strength'), name: '근력', description: '공격 피해 +N (영구)',
  stackingRule: 'sum', decay: { kind: 'none' },
  tags: [], hooks: [],
  damagePipeline: [{ kind: 'outgoingAdd', perStack: 1 }],
};

export const STATUS_DEXTERITY: StatusDefinition = {
  id: id<StatusId>('dexterity'), name: '민첩', description: '방어도 획득 +N (영구)',
  stackingRule: 'sum', decay: { kind: 'none' },
  tags: [], hooks: [],
  damagePipeline: [{ kind: 'blockGainAdd', perStack: 1 }],
};

/** 전열 — "이번 턴만" 근력 +N. 턴 종료 시 전부 사라짐. */
export const STATUS_STRENGTH_TEMP: StatusDefinition = {
  id: id<StatusId>('strength_temp'), name: '전열', description: '이번 턴 공격 피해 +N',
  stackingRule: 'sum', decay: { kind: 'allAtEndOfTurn' },
  tags: [], hooks: [],
  damagePipeline: [{ kind: 'outgoingAdd', perStack: 1 }],
};

/** 중독 — 매 턴 시작 시 stack만큼 HP 감소 (방어도 무시), 그 후 stack -1. */
export const STATUS_POISON: StatusDefinition = {
  id: id<StatusId>('poison'), name: '중독', description: '매 턴 시작 시 stack만큼 HP 감소',
  stackingRule: 'sum', decay: { kind: 'fixedPerTurn', amount: 1 },
  tags: [], hooks: [
    {
      on: 'onOwnerTurnStart',
      effects: [{ kind: 'custom', handlerId: 'tickStatusDamage', params: { statusId: 'poison' } }],
    },
  ],
};

/** 출혈 — 매 턴 종료 시 stack만큼 HP 감소 (방어도 무시), 그 후 stack -1. */
export const STATUS_BLEED: StatusDefinition = {
  id: id<StatusId>('bleed'), name: '출혈', description: '매 턴 종료 시 stack만큼 HP 감소',
  stackingRule: 'sum', decay: { kind: 'fixedPerTurn', amount: 1 },
  tags: [], hooks: [
    {
      on: 'onOwnerTurnEnd',
      effects: [{ kind: 'custom', handlerId: 'tickStatusDamage', params: { statusId: 'bleed' } }],
    },
  ],
};

/**
 * 회피 — incoming damage × 0 (완전 무효화). 매번 공격을 받을 때 stack -1
 * (oneStackPerTrigger). 잔여 stack은 turn end에 자기 자신을 removeStatus
 * 해서 "이번 턴 한정" 효과를 모사한다.
 */
export const STATUS_EVASION: StatusDefinition = {
  id: id<StatusId>('evasion'), name: '회피', description: '공격 1회 무시 (이번 턴 한정, 받을 때마다 1 소비)',
  stackingRule: 'sum', decay: { kind: 'oneStackPerTrigger' },
  tags: [], hooks: [
    { on: 'onTakeDamage', effects: [] },
    {
      on: 'onOwnerTurnEnd',
      effects: [{ kind: 'removeStatus', status: id<StatusId>('evasion'), target: 'self' }],
    },
  ],
  damagePipeline: [{ kind: 'incomingMul', multiplier: 0 }],
};

export const ALL_STATUSES: ReadonlyArray<StatusDefinition> = [
  STATUS_VULNERABLE, STATUS_WEAK, STATUS_STRENGTH, STATUS_DEXTERITY,
  STATUS_STRENGTH_TEMP, STATUS_POISON, STATUS_BLEED, STATUS_EVASION,
];
