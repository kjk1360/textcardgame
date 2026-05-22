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

/**
 * 불가침 (Intangible) — 어떤 종류의 피해도 무효화 + 받을 때마다 stack -1.
 * 회피와 다른 점: 상태이상에 의한 피해(중독/출혈/화상 tick)도 무시.
 *
 * 현재 구현 한계: damagePipeline은 damage effect에만 적용되어서
 * loseHp 기반 tick은 그대로 통과함. TODO(B-round): pipeline을 loseHp
 * 경로에도 통합하거나 별도 핸들러로 tick 차단.
 */
export const STATUS_INTANGIBLE: StatusDefinition = {
  id: id<StatusId>('intangible'), name: '불가침', description: '피해 1회 무효 (모든 종류, 받을 때마다 1 소비)',
  stackingRule: 'sum', decay: { kind: 'oneStackPerTrigger' },
  tags: [], hooks: [
    { on: 'onTakeDamage', effects: [] },
    {
      on: 'onOwnerTurnEnd',
      effects: [{ kind: 'removeStatus', status: id<StatusId>('intangible'), target: 'self' }],
    },
  ],
  damagePipeline: [{ kind: 'incomingMul', multiplier: 0 }],
};

/**
 * 판금 (Plate) — 매 턴 종료 시 stack만큼 방어도 획득 + stack -1.
 * tickStatusBlock 커스텀 핸들러(B-round 구현 예정) 사용 예정.
 */
export const STATUS_PLATE: StatusDefinition = {
  id: id<StatusId>('plate'), name: '판금', description: '매 턴 종료 시 stack만큼 방어도 획득',
  stackingRule: 'sum', decay: { kind: 'fixedPerTurn', amount: 1 },
  tags: [], hooks: [
    {
      on: 'onOwnerTurnEnd',
      effects: [{ kind: 'custom', handlerId: 'tickStatusBlock', params: { statusId: 'plate' } }],
    },
  ],
};

/**
 * 가시 (Thorns) — 공격하는 적에게 stack만큼 피해 반사. 턴 종료 시 1 감소.
 * TODO(B-round): reflectDamageToAttacker 커스텀 핸들러 + onTakeDamage hook.
 * 현재는 데이터 정의만, 반사 동작은 미구현.
 */
export const STATUS_THORNS: StatusDefinition = {
  id: id<StatusId>('thorns'), name: '가시', description: '공격받을 때 공격자에게 stack만큼 피해 반사',
  stackingRule: 'sum', decay: { kind: 'fixedPerTurn', amount: 1 },
  tags: [], hooks: [
    // TODO(B-round): { on: 'onTakeDamage', effects: [{ kind: 'custom', handlerId: 'reflectThorns', ... }] }
  ],
};

/**
 * 빙결 (Freeze) — 적: 의도된 행동 불발 + stack -1. 플레이어: 턴 시작 시
 * stack만큼 에너지 감소 + stack -1.
 * TODO(B-round): runOneEnemyStep에서 빙결 체크 + 플레이어 에너지 차감 훅.
 */
export const STATUS_FREEZE: StatusDefinition = {
  id: id<StatusId>('freeze'), name: '빙결', description: '적: 행동 불발 / 플레이어: 에너지 감소',
  stackingRule: 'sum', decay: { kind: 'fixedPerTurn', amount: 1 },
  tags: [], hooks: [],
};

/**
 * 화상 (Burn) — 피해를 입을 때 stack만큼 추가 피해 + stack -1. 턴 종료 시
 * 별도 피해 없이 stack -1만.
 * TODO(B-round): onTakeDamage 추가 피해 커스텀 핸들러.
 */
export const STATUS_BURN: StatusDefinition = {
  id: id<StatusId>('burn'), name: '화상', description: '피해받을 때 stack만큼 추가 피해. 턴 종료 시 1 감소',
  stackingRule: 'sum', decay: { kind: 'fixedPerTurn', amount: 1 },
  tags: [], hooks: [],
};

/**
 * 기절 (Stun) — 적: 의도된 행동 못함 + stack -1.
 * TODO(B-round): 빙결과 동일하게 runOneEnemyStep에서 체크.
 */
export const STATUS_STUN: StatusDefinition = {
  id: id<StatusId>('stun'), name: '기절', description: '적 의도된 행동 못함',
  stackingRule: 'sum', decay: { kind: 'fixedPerTurn', amount: 1 },
  tags: [], hooks: [],
};

/**
 * 단검마술 (Dagger Trick Buff) — 매 턴 드로우가 끝나고 stack만큼 단검을
 * 손에 생성. 전투간 유지 (감소 X).
 * TODO(B-round): startPlayerTurn 끝나는 시점에 카드 생성 커스텀 핸들러.
 */
export const STATUS_DAGGER_TRICK_BUFF: StatusDefinition = {
  id: id<StatusId>('dagger_trick_buff'), name: '단검마술', description: '매 턴 드로우 후 stack만큼 단검 생성',
  stackingRule: 'sum', decay: { kind: 'none' },
  tags: [], hooks: [],
};

/**
 * 더블캐스팅 — 마법 카드 사용 시 2번 발동 + stack -1.
 * TODO(B-round): combatPlayCard에서 마법 태그 체크 + 재발동.
 */
export const STATUS_DOUBLE_CAST: StatusDefinition = {
  id: id<StatusId>('double_cast'), name: '더블캐스팅', description: '마법 카드 사용 시 2번 발동',
  stackingRule: 'sum', decay: { kind: 'none' },  // consumed manually on magic-card play
  tags: [], hooks: [],
};

/**
 * 마법간소화 — 마법 카드 비용 stack만큼 감소 (this turn). 턴 종료 시
 * 전체 소멸.
 * TODO(B-round): canPlayCard / cost계산에서 태그+stack 반영.
 */
export const STATUS_MAGIC_SIMPLIFY: StatusDefinition = {
  id: id<StatusId>('magic_simplify'), name: '마법간소화', description: '이번 턴 마법 카드 비용 -N (전부 사라짐)',
  stackingRule: 'sum', decay: { kind: 'allAtEndOfTurn' },
  tags: [], hooks: [],
};

export const ALL_STATUSES: ReadonlyArray<StatusDefinition> = [
  STATUS_VULNERABLE, STATUS_WEAK, STATUS_STRENGTH, STATUS_DEXTERITY,
  STATUS_STRENGTH_TEMP, STATUS_POISON, STATUS_BLEED, STATUS_EVASION,
  STATUS_INTANGIBLE, STATUS_PLATE, STATUS_THORNS,
  STATUS_FREEZE, STATUS_BURN, STATUS_STUN,
  STATUS_DAGGER_TRICK_BUFF, STATUS_DOUBLE_CAST, STATUS_MAGIC_SIMPLIFY,
];
