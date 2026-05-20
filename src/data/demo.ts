/**
 * Demo content — minimal game data for the UI prototype.
 *
 * This is the temporary single-file content registry used by the dev
 * UI until Phase 4 brings up the xlsx/yaml data pipeline. Designers
 * shouldn't edit this — it'll be replaced wholesale by the build-data
 * pipeline output.
 *
 * Migration note: docs/migration/01_ts_to_excel.md
 *
 * Modifier-pool architecture:
 *   Each card carries a set of EffectTag tags. modifierPoolRefs are the
 *   pools the card's upgrade event will sample from. Pools overlap on
 *   purpose: 확산 lives in both POOL_DAGGER and POOL_SINGLE_ATTACK so any
 *   card tagged 단검 OR 단일공격 can pull it; the sampler dedupes (no
 *   weight stacking) — pools are sets-of-options, not buckets.
 */

import type {
  CardDefId,
  CardDefinition,
  CardPool,
  CardPoolId,
  EffectTag,
  EnemyGroupId,
  EnemyId,
  EventDefinition,
  EventId,
  FlowDefinition,
  Modifier,
  ModifierId,
  ModifierPool,
  ModifierPoolId,
  ScenarioId,
  SkillDefinition,
  SkillId,
  StatusDefinition,
  StatusId,
} from '../types/index.js';
import {
  makeCardPoolRegistry,
  makeCardRegistry,
  makeEnemyGroupRegistry,
  makeEnemyRegistry,
  makeEventRegistry,
  makeFlowRegistry,
  makeModifierPoolRegistry,
  makeModifierRegistry,
  makeSkillBoxRegistryFromList,
  makeSkillRegistry,
  makeStatusRegistry,
  type EnemyDefinition,
  type EnemyGroupDefinition,
  type GameRegistries,
} from '../engine/integration/registries.js';
import type { SkillBoxDefinition } from '../engine/meta/skill-box.js';

const id = <T extends string>(s: string): T => s as T;

// ====================================================================
// Statuses
// ====================================================================

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

/**
 * 전열 임시 근력 — 카드 효과로 부여하는 "이번 턴만" 근력. 매 턴 종료 시
 * 전체 스택이 0으로 리셋된다.
 */
export const STATUS_STRENGTH_TEMP: StatusDefinition = {
  id: id<StatusId>('strength_temp'), name: '전열', description: '이번 턴 공격 피해 +N',
  stackingRule: 'sum', decay: { kind: 'allAtEndOfTurn' },
  tags: [], hooks: [],
  damagePipeline: [{ kind: 'outgoingAdd', perStack: 1 }],
};

/**
 * 중독 — 매 턴 시작 시 stack만큼 HP 감소 (방어도 무시), 그 후 stack -1.
 * tickStatusDamage 커스텀 핸들러로 stack 수만큼 피해를 입힌다.
 */
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

/**
 * 출혈 — 매 턴 종료 시 stack만큼 HP 감소 (방어도 무시), 그 후 stack -1.
 */
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

// ====================================================================
// Tags — internal-only "kind" markers on cards used to derive
// modifierPoolRefs. Not surfaced in the UI.
// ====================================================================

const TAG_DAGGER:          EffectTag = id<EffectTag>('dagger');
const TAG_PHYSICAL:        EffectTag = id<EffectTag>('physical');
const TAG_SINGLE_ATTACK:   EffectTag = id<EffectTag>('single_attack');
const TAG_SINGLE_DEFENSE:  EffectTag = id<EffectTag>('single_defense');

// ====================================================================
// Modifier pool ids
// ====================================================================

const POOL_DAGGER_ID         = id<ModifierPoolId>('pool_dagger');
const POOL_PHYSICAL_ID       = id<ModifierPoolId>('pool_physical');
const POOL_SINGLE_ATTACK_ID  = id<ModifierPoolId>('pool_single_attack');
const POOL_SINGLE_DEFENSE_ID = id<ModifierPoolId>('pool_single_defense');

// ====================================================================
// Cards
// ====================================================================

export const CARD_STRIKE: CardDefinition = {
  id: id<CardDefId>('strike'), name: '타격',
  cost: { kind: 'fixed', value: 1 }, type: 'attack', target: { kind: 'enemy' },
  rarity: 'starter', tags: [TAG_PHYSICAL, TAG_SINGLE_ATTACK], keywords: [],
  baseDescription: '적에게 6의 피해를 줍니다.',
  baseEffects: [{ kind: 'damage', amount: 6, target: 'enemy' }],
  modifierPoolRefs: [POOL_PHYSICAL_ID, POOL_SINGLE_ATTACK_ID],
};

export const CARD_DEFEND: CardDefinition = {
  id: id<CardDefId>('defend'), name: '수비',
  cost: { kind: 'fixed', value: 1 }, type: 'skill', target: { kind: 'self' },
  rarity: 'starter', tags: [TAG_SINGLE_DEFENSE], keywords: [],
  baseDescription: '방어도 5를 얻습니다.',
  baseEffects: [{ kind: 'gainBlock', amount: 5 }],
  modifierPoolRefs: [POOL_SINGLE_DEFENSE_ID],
};

export const CARD_HEAVY_STRIKE: CardDefinition = {
  id: id<CardDefId>('heavy_strike'), name: '강타',
  cost: { kind: 'fixed', value: 2 }, type: 'attack', target: { kind: 'enemy' },
  rarity: 'common', tags: [TAG_PHYSICAL, TAG_SINGLE_ATTACK], keywords: [],
  baseDescription: '적에게 10의 피해를 줍니다.',
  baseEffects: [{ kind: 'damage', amount: 10, target: 'enemy' }],
  modifierPoolRefs: [POOL_PHYSICAL_ID, POOL_SINGLE_ATTACK_ID],
};

export const CARD_DAGGER_THROW: CardDefinition = {
  id: id<CardDefId>('dagger_throw'), name: '단검투척',
  cost: { kind: 'fixed', value: 0 }, type: 'attack', target: { kind: 'enemy' },
  rarity: 'common', tags: [TAG_DAGGER, TAG_PHYSICAL, TAG_SINGLE_ATTACK], keywords: ['exhaust'],
  baseDescription: '적에게 4의 피해. 소멸.',
  baseEffects: [{ kind: 'damage', amount: 4, target: 'enemy' }],
  modifierPoolRefs: [POOL_DAGGER_ID, POOL_PHYSICAL_ID, POOL_SINGLE_ATTACK_ID],
};

export const CARD_BASH: CardDefinition = {
  id: id<CardDefId>('bash'), name: '강타·취약',
  cost: { kind: 'fixed', value: 2 }, type: 'attack', target: { kind: 'enemy' },
  rarity: 'common', tags: [TAG_PHYSICAL, TAG_SINGLE_ATTACK], keywords: [],
  baseDescription: '적에게 8의 피해 + 취약 2 부여.',
  baseEffects: [
    { kind: 'damage', amount: 8, target: 'enemy' },
    { kind: 'applyStatus', status: STATUS_VULNERABLE.id, stacks: 2, target: 'enemy' },
  ],
  modifierPoolRefs: [POOL_PHYSICAL_ID, POOL_SINGLE_ATTACK_ID],
};

// ====================================================================
// Modifiers
// ====================================================================

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

// ====================================================================
// Modifier pools
// ====================================================================

export const POOL_DAGGER: ModifierPool = {
  id: POOL_DAGGER_ID,
  name: '단검 강화 풀',
  entries: [
    { modifierId: MOD_SPREAD.id,       weight: 4 },
    { modifierId: MOD_POISON_COAT.id,  weight: 5 },
    { modifierId: MOD_DAGGER_TRICK.id, weight: 3 },
  ],
};

export const POOL_PHYSICAL: ModifierPool = {
  id: POOL_PHYSICAL_ID,
  name: '물리 강화 풀',
  entries: [
    { modifierId: MOD_HONE.id,      weight: 8 },
    { modifierId: MOD_OIL.id,       weight: 4 },
    { modifierId: MOD_BARB.id,      weight: 5 },
    { modifierId: MOD_OVERPOWER.id, weight: 5 },
  ],
};

export const POOL_SINGLE_ATTACK: ModifierPool = {
  id: POOL_SINGLE_ATTACK_ID,
  name: '단일공격 강화 풀',
  entries: [
    { modifierId: MOD_SPREAD.id,  weight: 4 },
    { modifierId: MOD_SUSTAIN.id, weight: 4 },
    { modifierId: MOD_RALLY.id,   weight: 4 },
  ],
};

export const POOL_SINGLE_DEFENSE: ModifierPool = {
  id: POOL_SINGLE_DEFENSE_ID,
  name: '단일방어 강화 풀',
  entries: [
    { modifierId: MOD_SUSTAIN.id, weight: 4 },
    { modifierId: MOD_HARDEN.id,  weight: 6 },
    { modifierId: MOD_BLUR.id,    weight: 3 },
  ],
};

// ====================================================================
// Card pools
// ====================================================================

export const POOL_START_CARDS: CardPool = {
  id: id<CardPoolId>('pool_start_cards'),
  name: '시작 카드 풀',
  entries: [
    { cardDefId: CARD_STRIKE.id, weight: 20 },
    { cardDefId: CARD_DEFEND.id, weight: 20 },
    { cardDefId: CARD_DAGGER_THROW.id, weight: 8 },
    { cardDefId: CARD_HEAVY_STRIKE.id, weight: 5 },
    { cardDefId: CARD_BASH.id, weight: 3 },
  ],
};

// ====================================================================
// Skills + boxes
// ====================================================================

export const SKILL_LIFESTEAL: SkillDefinition = {
  id: id<SkillId>('skill_lifesteal'),
  name: '흡혈', description: '적 처치 시 3 HP 회복.',
  grade: 'low', tags: [], passiveEligible: true,
  hooks: [{ on: 'onEnemyKilled', effects: [{ kind: 'gainHp', amount: 3 }] }],
};
export const SKILL_QUICK_HANDS: SkillDefinition = {
  id: id<SkillId>('skill_quick_hands'),
  name: '빠른 손', description: '매 턴 시작 +1 드로우.',
  grade: 'low', tags: [], passiveEligible: true,
  hooks: [{ on: 'onTurnStart', effects: [{ kind: 'draw', count: 1 }] }],
};

// 4 test-pool skills (per user spec). Combat-only buffs because
// player.statuses[] is cleared at beginCombatWithGroup.
export const SKILL_STRENGTH_1: SkillDefinition = {
  id: id<SkillId>('skill_strength_1'),
  name: '힘증가', description: '전투 시작 시 근력 +1 부여 (해당 전투 한정).',
  grade: 'low', tags: [], passiveEligible: true,
  hooks: [{
    on: 'onCombatStart',
    effects: [{ kind: 'applyStatus', status: STATUS_STRENGTH.id, stacks: 1, target: 'self' }],
  }],
};
export const SKILL_STRENGTH_2: SkillDefinition = {
  id: id<SkillId>('skill_strength_2'),
  name: '괴력', description: '전투 시작 시 근력 +2 부여 (해당 전투 한정).',
  grade: 'mid', tags: [], passiveEligible: true,
  hooks: [{
    on: 'onCombatStart',
    effects: [{ kind: 'applyStatus', status: STATUS_STRENGTH.id, stacks: 2, target: 'self' }],
  }],
};
export const SKILL_STRENGTH_3: SkillDefinition = {
  id: id<SkillId>('skill_strength_3'),
  name: '천부의 힘', description: '전투 시작 시 근력 +3 부여 (해당 전투 한정).',
  grade: 'high', tags: [], passiveEligible: true,
  hooks: [{
    on: 'onCombatStart',
    effects: [{ kind: 'applyStatus', status: STATUS_STRENGTH.id, stacks: 3, target: 'self' }],
  }],
};
export const SKILL_SACRIFICE: SkillDefinition = {
  id: id<SkillId>('skill_sacrifice'),
  name: '희생 분신',
  description: '매 턴 드로우 -1. 카드 사용 시 효과가 2번 발동됨.',
  grade: 'high', tags: [], passiveEligible: true,
  // Mechanical effects are wired in game.ts (combatEndTurn draw modifier
  // + combatPlayCard duplicate trigger) — hooks here are informational.
  hooks: [],
};

export const SKILL_BOX_LOWEST: SkillBoxDefinition = {
  grade: 'lowest', priceGold: 50,
  entries: [
    { skillId: SKILL_LIFESTEAL.id, weight: 1 },
    { skillId: SKILL_QUICK_HANDS.id, weight: 1 },
  ],
};

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

// ====================================================================
// Enemies + groups
// ====================================================================

export const ENEMY_SLIME: EnemyDefinition = {
  id: id<EnemyId>('slime'), name: '슬라임', tier: 'normal',
  hpRange: [12, 14],
  intentScript: {
    mode: 'cycle',
    intents: [
      { id: 'a', display: { kind: 'attack', value: 4 }, effects: [{ kind: 'damage', amount: 4, target: 'enemy' }] },
      { id: 'd', display: { kind: 'defend', value: 3 }, effects: [{ kind: 'gainBlock', amount: 3 }] },
    ],
  },
  rewards: { goldRange: [8, 14] },
  sprite: [
    '    ▄▀▀▀▄    ',
    '   █▒░ ░▒█   ',
    '   █▒ o ▒█   ',
    '   ▀█▒▒▒█▀   ',
    '     ▀▀▀     ',
  ],
};

export const ENEMY_BRUTE: EnemyDefinition = {
  id: id<EnemyId>('brute'), name: '난폭자', tier: 'normal',
  hpRange: [25, 30],
  intentScript: {
    mode: 'cycle',
    intents: [
      { id: 'a', display: { kind: 'attack', value: 8 }, effects: [{ kind: 'damage', amount: 8, target: 'enemy' }] },
      { id: 'a2', display: { kind: 'attack', value: 8 }, effects: [{ kind: 'damage', amount: 8, target: 'enemy' }] },
      { id: 'd', display: { kind: 'defend', value: 6 }, effects: [{ kind: 'gainBlock', amount: 6 }] },
    ],
  },
  rewards: { goldRange: [15, 25] },
  sprite: [
    '   ▄█████▄   ',
    '  █▌▀ ▒ ▀▐█  ',
    '  █▌▖▗▘▝▐█   ',
    '  █▌ ▄▄▄ ▐█  ',
    '   ▀█▄▄▄█▀   ',
    '   ▟█   █▙   ',
    '  ▟▀     ▀▙  ',
  ],
};

export const GROUP_SLIME_SOLO: EnemyGroupDefinition = {
  id: id<EnemyGroupId>('eg_slime_solo'),
  members: [ENEMY_SLIME.id],
};
export const GROUP_BRUTE_SOLO: EnemyGroupDefinition = {
  id: id<EnemyGroupId>('eg_brute_solo'),
  members: [ENEMY_BRUTE.id],
};

// ====================================================================
// Events + flows
// ====================================================================

export const EVENT_JOURNEY_START: EventDefinition = {
  id: id<EventId>('journey_start'),
  name: '여정의 시작',
  nodeType: 'event_trigger' as any,
  flowId: id<ScenarioId>('scenario_journey_start'),
  oneShot: false,
};

export const FLOW_JOURNEY_START: FlowDefinition = {
  id: id<ScenarioId>('scenario_journey_start'),
  entryStepId: 'open',
  steps: {
    open: { kind: 'dialogue', speaker: '차원의 안내자', text: '또 한 명의 도전자가 왔군. 너의 첫 무기를 골라야 한다.', next: 'instr' },
    instr: { kind: 'dialogue', text: '다섯 번에 걸쳐, 세 장 중 한 장을 골라라.', next: 'picks' },
    picks: {
      kind: 'cardOffer',
      poolId: POOL_START_CARDS.id,
      picksPerIteration: 3,
      iterations: 5,
      // Pick "5 minus whatever the player already drafted from inventory".
      // If they brought 3 from the warehouse, journey_start fills 2 more.
      fillToDeckCount: 5,
      destination: 'currentDeck',
      next: 'depart',
    },
    depart: { kind: 'dialogue', text: '행운을 빈다.', next: 'end' },
    end: { kind: 'end', outcome: 'success' },
  },
};

// ---------- Shop ----------

export const EVENT_SHOP: EventDefinition = {
  id: id<EventId>('shop_default'),
  name: '차원 상인',
  nodeType: 'shop' as any,
  flowId: id<ScenarioId>('scenario_shop'),
};

export const FLOW_SHOP: FlowDefinition = {
  id: id<ScenarioId>('scenario_shop'),
  entryStepId: 'open',
  steps: {
    open: {
      kind: 'dialogue', speaker: '차원 상인',
      text: '재미있는 카드가 있다네. 보겠는가?',
      next: 'menu',
    },
    menu: {
      kind: 'choice',
      prompt: '무엇을 하겠는가?',
      options: [
        {
          label: '카드 1장 보기 (50G)',
          condition: { kind: 'hasGold', min: 50 },
          effects: [{ kind: 'loseGold', amount: 50 }],
          next: 'cards',
        },
        { label: '떠난다', next: 'end' },
      ],
    },
    cards: {
      kind: 'cardOffer',
      poolId: POOL_START_CARDS.id,
      picksPerIteration: 3,
      iterations: 1,
      destination: 'currentDeck',
      allowSkip: true,
      next: 'end',
    },
    end: { kind: 'end', outcome: 'success' },
  },
};

// ---------- Treasure ----------

export const EVENT_TREASURE: EventDefinition = {
  id: id<EventId>('treasure_default'),
  name: '차원의 보물',
  nodeType: 'treasure' as any,
  flowId: id<ScenarioId>('scenario_treasure'),
};

export const FLOW_TREASURE: FlowDefinition = {
  id: id<ScenarioId>('scenario_treasure'),
  entryStepId: 'open',
  steps: {
    open: {
      kind: 'dialogue',
      text: '보물 상자를 발견했다! 그 속에 스킬북이…',
      next: 'gold',
    },
    gold: {
      kind: 'applyEffect',
      effects: [{ kind: 'gainGold', amount: 30 }],
      next: 'skill_offer',
    },
    skill_offer: {
      kind: 'skillOffer',
      poolOverride: TREASURE_SKILL_POOL,
      count: 3,
      allowSkip: true,
      fillRestWithGoldAmount: 10,
      next: 'end',
    },
    end: { kind: 'end', outcome: 'success' },
  },
};

// ---------- Upgrade shrine ----------

/**
 * Card-upgrade event. Picks one card from the current run deck and
 * attaches one of three sampled modifiers (from the card's pools).
 */
export const EVENT_UPGRADE_SHRINE: EventDefinition = {
  id: id<EventId>('upgrade_shrine'),
  name: '강화의 제단',
  nodeType: 'event_trigger' as any,
  flowId: id<ScenarioId>('scenario_upgrade_shrine'),
};

export const FLOW_UPGRADE_SHRINE: FlowDefinition = {
  id: id<ScenarioId>('scenario_upgrade_shrine'),
  entryStepId: 'open',
  steps: {
    open: {
      kind: 'dialogue',
      text: '오래된 제단이 카드 한 장에 룬을 새겨주겠다고 한다…',
      next: 'pick',
    },
    pick: {
      kind: 'cardUpgrade',
      source: 'currentDeck',
      count: 1,
      allowSkip: true,
      next: 'end',
    },
    end: { kind: 'end', outcome: 'success' },
  },
};

// ====================================================================
// Bundle
// ====================================================================

export function makeDemoRegistries(): GameRegistries {
  return {
    cards: makeCardRegistry([CARD_STRIKE, CARD_DEFEND, CARD_HEAVY_STRIKE, CARD_DAGGER_THROW, CARD_BASH]),
    cardPools: makeCardPoolRegistry([POOL_START_CARDS]),
    modifiers: makeModifierRegistry([
      MOD_SPREAD, MOD_POISON_COAT, MOD_DAGGER_TRICK,
      MOD_HONE, MOD_OIL, MOD_BARB, MOD_OVERPOWER,
      MOD_SUSTAIN, MOD_RALLY,
      MOD_HARDEN, MOD_BLUR,
    ]),
    modifierPools: makeModifierPoolRegistry([
      POOL_DAGGER, POOL_PHYSICAL, POOL_SINGLE_ATTACK, POOL_SINGLE_DEFENSE,
    ]),
    statuses: makeStatusRegistry([
      STATUS_VULNERABLE, STATUS_WEAK, STATUS_STRENGTH, STATUS_DEXTERITY,
      STATUS_STRENGTH_TEMP, STATUS_POISON, STATUS_BLEED, STATUS_EVASION,
    ]),
    skills: makeSkillRegistry([
      SKILL_LIFESTEAL, SKILL_QUICK_HANDS,
      SKILL_STRENGTH_1, SKILL_STRENGTH_2, SKILL_STRENGTH_3, SKILL_SACRIFICE,
    ]),
    skillBoxes: makeSkillBoxRegistryFromList([SKILL_BOX_LOWEST]),
    enemies: makeEnemyRegistry([ENEMY_SLIME, ENEMY_BRUTE]),
    enemyGroups: makeEnemyGroupRegistry([GROUP_SLIME_SOLO, GROUP_BRUTE_SOLO]),
    events: makeEventRegistry([EVENT_JOURNEY_START, EVENT_SHOP, EVENT_TREASURE, EVENT_UPGRADE_SHRINE]),
    flows: makeFlowRegistry([FLOW_JOURNEY_START, FLOW_SHOP, FLOW_TREASURE, FLOW_UPGRADE_SHRINE]),
  };
}
