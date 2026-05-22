import type {
  CardDefId,
  CardDefinition,
  EffectTag,
  ModifierPoolId,
} from '../types/index.js';
import {
  STATUS_BLEED,
  STATUS_BURN,
  STATUS_DAGGER_TRICK_BUFF,
  STATUS_DOUBLE_CAST,
  STATUS_FREEZE,
  STATUS_INTANGIBLE,
  STATUS_MAGIC_SIMPLIFY,
  STATUS_PLATE,
  STATUS_POISON,
  STATUS_STRENGTH,
  STATUS_STRENGTH_TEMP,
  STATUS_STUN,
  STATUS_THORNS,
  STATUS_VULNERABLE,
  STATUS_WEAK,
} from './statuses.js';

const id = <T extends string>(s: string): T => s as T;

// --------------------------------------------------------------------
// Tags — internal "kind" markers used to drive which modifier pools
// a card pulls from on upgrade. Not surfaced in the UI.
// --------------------------------------------------------------------
export const TAG_DAGGER:          EffectTag = id<EffectTag>('dagger');
export const TAG_PHYSICAL:        EffectTag = id<EffectTag>('physical');
export const TAG_SINGLE_ATTACK:   EffectTag = id<EffectTag>('single_attack');
export const TAG_SINGLE_DEFENSE:  EffectTag = id<EffectTag>('single_defense');
export const TAG_AOE_ATTACK:      EffectTag = id<EffectTag>('aoe_attack');
export const TAG_TECHNIQUE:       EffectTag = id<EffectTag>('technique');
export const TAG_BUFF:            EffectTag = id<EffectTag>('buff');
export const TAG_DAMAGE_BOOST:    EffectTag = id<EffectTag>('damage_boost');
export const TAG_RELIC:           EffectTag = id<EffectTag>('relic');
// 마법 계열
export const TAG_MAGIC:           EffectTag = id<EffectTag>('magic');
export const TAG_FIRE:            EffectTag = id<EffectTag>('fire');
export const TAG_LIGHTNING:       EffectTag = id<EffectTag>('lightning');
export const TAG_COLD:            EffectTag = id<EffectTag>('cold');
export const TAG_SUPPORT_MAGIC:   EffectTag = id<EffectTag>('support_magic');
export const TAG_BASIC_MAGIC:     EffectTag = id<EffectTag>('basic_magic');
export const TAG_MID_MAGIC:       EffectTag = id<EffectTag>('mid_magic');
export const TAG_HIGH_MAGIC:      EffectTag = id<EffectTag>('high_magic');

// --------------------------------------------------------------------
// Modifier pool ids — referenced from cards' modifierPoolRefs and
// defined in `modifier-pools.ts`. Centralized here so both modules
// agree on the literal id string.
// --------------------------------------------------------------------
export const POOL_DAGGER_ID         = id<ModifierPoolId>('pool_dagger');
export const POOL_PHYSICAL_ID       = id<ModifierPoolId>('pool_physical');
export const POOL_SINGLE_ATTACK_ID  = id<ModifierPoolId>('pool_single_attack');
export const POOL_SINGLE_DEFENSE_ID = id<ModifierPoolId>('pool_single_defense');

// --------------------------------------------------------------------
// Cards
// --------------------------------------------------------------------

export const CARD_STRIKE: CardDefinition = {
  id: id<CardDefId>('strike'), name: '타격',
  cost: { kind: 'fixed', value: 1 }, type: 'attack', target: { kind: 'enemy' },
  rarity: 'common', tags: [TAG_PHYSICAL, TAG_SINGLE_ATTACK], keywords: [],
  baseDescription: '적에게 6의 피해를 줍니다.',
  baseEffects: [{ kind: 'damage', amount: 6, target: 'enemy' }],
  modifierPoolRefs: [POOL_PHYSICAL_ID, POOL_SINGLE_ATTACK_ID],
};

export const CARD_DEFEND: CardDefinition = {
  id: id<CardDefId>('defend'), name: '수비',
  cost: { kind: 'fixed', value: 1 }, type: 'skill', target: { kind: 'self' },
  rarity: 'common', tags: [TAG_SINGLE_DEFENSE], keywords: [],
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
// === Round-1 additions ===============================================
//
// 신규 카드들. 일부 효과는 메커니즘 미구현 (TODO 표기) — 데이터는
// 정확히 들어가지만 효과 발동은 다음 라운드 이후 구현 예정.
//
// 미구현 효과 요약:
//  - 발견 (Discover) : 골동품 감정. UI 통합 + 'discoverFromPool' 효과 필요.
//  - addCardToPile(self) : 매직미사일·쉴드. executor에서 deferred 상태.
//  - 인접 적 / 체인 / 라이더 : 파이어볼·체인라이트닝·독약병. 별도 핸들러.
//  - 동적 dmg 강화 : 보석 건틀릿(카드ID별), 단검술 숙련(태그별).
//  - 마지막 마법 복제 : 거울상.
//  - 다음 턴 에너지 예약 : 메모라이즈.
//  - 더블캐스트 재발동·마법간소화 비용 : 엔진의 playCard 경로 손봐야 함.
//  - 상태이상 hook : 판금/가시/화상/빙결/기절. 데이터에 hook이 들어 있거나
//    TODO 주석으로 표시. 다음 라운드에서 커스텀 핸들러로 연결.
// ====================================================================

// --- 단일 카드 (이벤트/상점/일반 보상용) ---

export const CARD_CRUEL_THRUST: CardDefinition = {
  id: id<CardDefId>('cruel_thrust'), name: '잔인한 찌르기',
  cost: { kind: 'fixed', value: 1 }, type: 'attack', target: { kind: 'enemy' },
  rarity: 'common', tags: [TAG_PHYSICAL, TAG_SINGLE_ATTACK], keywords: [],
  baseDescription: '단일 적에게 5의 피해. 출혈 +3 부여.',
  baseEffects: [
    { kind: 'damage', amount: 5, target: 'enemy' },
    { kind: 'applyStatus', status: STATUS_BLEED.id, stacks: 3, target: 'enemy' },
  ],
  modifierPoolRefs: [POOL_PHYSICAL_ID, POOL_SINGLE_ATTACK_ID],
};

/**
 * TODO(B-round): 발견 시스템. 'discoverFromPool' 커스텀 효과 + UI 통합 필요.
 * 현재는 단순 stub damage로 대체 (효과 발동 시 아무 일도 안 일어남).
 */
export const CARD_ARTIFACT_APPRAISE: CardDefinition = {
  id: id<CardDefId>('artifact_appraise'), name: '골동품 감정',
  cost: { kind: 'fixed', value: 1 }, type: 'skill', target: { kind: 'none' },
  rarity: 'rare', tags: [TAG_PHYSICAL, TAG_SINGLE_ATTACK], keywords: ['exhaust'],
  baseDescription: '전투골동품 풀에서 3장 발견 — 1장을 손으로. 소멸. (TODO: 발견 미구현)',
  baseEffects: [
    { kind: 'custom', handlerId: 'discoverFromPool', params: { poolId: 'pool_combat_artifact', count: 3, temporary: true } },
  ],
  modifierPoolRefs: [POOL_PHYSICAL_ID, POOL_SINGLE_ATTACK_ID],
};

// --- 전투골동품 카드 (발견 전용, 일반 덱에 들어가지 않음) ---

export const CARD_SHATTERED_STRENGTH_CRYSTAL: CardDefinition = {
  id: id<CardDefId>('shattered_strength_crystal'), name: '조각난 힘의 수정',
  cost: { kind: 'fixed', value: 0 }, type: 'skill', target: { kind: 'self' },
  rarity: 'common', tags: [TAG_BUFF, TAG_RELIC], keywords: ['exhaust'],
  baseDescription: '이번 턴 근력 +5. 소멸.',
  baseEffects: [{ kind: 'applyStatus', status: STATUS_STRENGTH_TEMP.id, stacks: 5, target: 'self' }],
  modifierPoolRefs: [],
};

export const CARD_OLD_SHIELD_GENERATOR: CardDefinition = {
  id: id<CardDefId>('old_shield_generator'), name: '오래된 보호막 생성기',
  cost: { kind: 'fixed', value: 0 }, type: 'skill', target: { kind: 'self' },
  rarity: 'common', tags: [TAG_SINGLE_DEFENSE, TAG_RELIC], keywords: ['exhaust'],
  baseDescription: '방어도 9 획득. 소멸.',
  baseEffects: [{ kind: 'gainBlock', amount: 9 }],
  modifierPoolRefs: [],
};

export const CARD_CORRODED_NEEDLE: CardDefinition = {
  id: id<CardDefId>('corroded_needle'), name: '부식된 장침',
  cost: { kind: 'fixed', value: 0 }, type: 'attack', target: { kind: 'enemy' },
  rarity: 'common', tags: [TAG_RELIC], keywords: ['exhaust'],
  baseDescription: '단일 적에게 출혈 +2, 중독 +2. 소멸.',
  baseEffects: [
    { kind: 'applyStatus', status: STATUS_BLEED.id, stacks: 2, target: 'enemy' },
    { kind: 'applyStatus', status: STATUS_POISON.id, stacks: 2, target: 'enemy' },
  ],
  modifierPoolRefs: [],
};

export const CARD_RUSTY_DAGGER: CardDefinition = {
  id: id<CardDefId>('rusty_dagger'), name: '녹슨 단검',
  cost: { kind: 'fixed', value: 0 }, type: 'attack', target: { kind: 'enemy' },
  rarity: 'common', tags: [TAG_RELIC], keywords: ['exhaust'],
  baseDescription: '단일 적에게 3의 피해 3회. 소멸.',
  baseEffects: [{ kind: 'damageMultiHit', amount: 3, hits: 3, target: 'enemy' }],
  modifierPoolRefs: [],
};

export const CARD_GLOWING_AMULET: CardDefinition = {
  id: id<CardDefId>('glowing_amulet'), name: '은은하게 빛나는 보호 부적',
  cost: { kind: 'fixed', value: 0 }, type: 'skill', target: { kind: 'self' },
  rarity: 'rare', tags: [TAG_BUFF, TAG_RELIC], keywords: ['exhaust'],
  baseDescription: '불가침 +1 획득. 소멸.',
  baseEffects: [{ kind: 'applyStatus', status: STATUS_INTANGIBLE.id, stacks: 1, target: 'self' }],
  modifierPoolRefs: [],
};

export const CARD_ENCHANTED_SHIELD: CardDefinition = {
  id: id<CardDefId>('enchanted_shield'), name: '마법이 깃든 방패',
  cost: { kind: 'fixed', value: 0 }, type: 'skill', target: { kind: 'self' },
  rarity: 'rare', tags: [TAG_RELIC], keywords: ['exhaust'],
  baseDescription: '방어도 15 획득. 소멸.',
  baseEffects: [{ kind: 'gainBlock', amount: 15 }],
  modifierPoolRefs: [],
};

export const CARD_SHARP_LONGSWORD: CardDefinition = {
  id: id<CardDefId>('sharp_longsword'), name: '날카로운 세공 장검',
  cost: { kind: 'fixed', value: 0 }, type: 'attack', target: { kind: 'allEnemies' },
  rarity: 'rare', tags: [TAG_RELIC], keywords: ['exhaust'],
  baseDescription: '모든 적에게 15의 피해. 소멸.',
  baseEffects: [{ kind: 'damage', amount: 15, target: 'allEnemies' }],
  modifierPoolRefs: [],
};

export const CARD_STRENGTH_PILL: CardDefinition = {
  id: id<CardDefId>('strength_pill'), name: '힘의 단약',
  cost: { kind: 'fixed', value: 0 }, type: 'skill', target: { kind: 'self' },
  rarity: 'rare', tags: [TAG_BUFF, TAG_RELIC], keywords: ['exhaust'],
  baseDescription: '이번 전투 동안 근력 +2. 소멸.',
  baseEffects: [{ kind: 'applyStatus', status: STATUS_STRENGTH.id, stacks: 2, target: 'self' }],
  modifierPoolRefs: [],
};

export const CARD_RELIC_GEMSTONE_GAUNTLET: CardDefinition = {
  id: id<CardDefId>('relic_gemstone_gauntlet'), name: '유물 : 보석 건틀릿',
  cost: { kind: 'fixed', value: 0 }, type: 'attack', target: { kind: 'enemy' },
  rarity: 'legendary', tags: [TAG_SINGLE_ATTACK, TAG_RELIC], keywords: [],
  baseDescription: '단일 적에게 14의 피해. 이번 전투 동안 "보석 건틀릿"의 피해량 +5.',
  baseEffects: [
    { kind: 'damage', amount: 14, target: 'enemy' },
    { kind: 'custom', handlerId: 'boostCardDamage', params: { defId: 'relic_gemstone_gauntlet', delta: 5 } },
  ],
  modifierPoolRefs: [],
};

export const CARD_RELIC_RED_CUBE: CardDefinition = {
  id: id<CardDefId>('relic_red_cube'), name: '유물 : 붉게 빛나는 입방체',
  cost: { kind: 'fixed', value: 0 }, type: 'skill', target: { kind: 'allEnemies' },
  rarity: 'legendary', tags: [TAG_RELIC, TAG_AOE_ATTACK], keywords: ['exhaust'],
  baseDescription: '모든 적에게 약화 +5, 출혈 +5. 소멸.',
  baseEffects: [
    { kind: 'applyStatus', status: STATUS_WEAK.id,  stacks: 5, target: 'allEnemies' },
    { kind: 'applyStatus', status: STATUS_BLEED.id, stacks: 5, target: 'allEnemies' },
  ],
  modifierPoolRefs: [],
};

/**
 * TODO(B-round): "대상의 모든 버프 제거" — 현재 removeStatus는 1개 status만
 * 지정 가능. 'removeAllBuffs' 커스텀 핸들러 필요. 현재 stub.
 */
export const CARD_RELIC_REVERSAL: CardDefinition = {
  id: id<CardDefId>('relic_reversal'), name: '유물 : 역산 장치',
  cost: { kind: 'fixed', value: 0 }, type: 'skill', target: { kind: 'enemy' },
  rarity: 'legendary', tags: [TAG_RELIC], keywords: ['exhaust'],
  baseDescription: '대상에게 부여된 버프 전부 제거. 소멸. (TODO: 미구현)',
  baseEffects: [{ kind: 'custom', handlerId: 'removeAllBuffs', params: { target: 'enemy' } }],
  modifierPoolRefs: [],
};

export const CARD_RELIC_RUNE_SHIELD: CardDefinition = {
  id: id<CardDefId>('relic_rune_shield'), name: '유물 : 룬 새김 방패',
  cost: { kind: 'fixed', value: 0 }, type: 'skill', target: { kind: 'self' },
  rarity: 'legendary', tags: [TAG_SINGLE_DEFENSE, TAG_RELIC], keywords: ['exhaust'],
  baseDescription: '방어도 10 획득. 판금 +5 획득. 소멸.',
  baseEffects: [
    { kind: 'gainBlock', amount: 10 },
    { kind: 'applyStatus', status: STATUS_PLATE.id, stacks: 5, target: 'self' },
  ],
  modifierPoolRefs: [],
};

// --- 일반 카드들 (이벤트/상점/보상으로 획득) ---

export const CARD_STONE_THROW: CardDefinition = {
  id: id<CardDefId>('stone_throw'), name: '돌팔매질',
  cost: { kind: 'fixed', value: 0 }, type: 'attack', target: { kind: 'enemy' },
  rarity: 'common', tags: [TAG_PHYSICAL, TAG_SINGLE_ATTACK], keywords: [],
  baseDescription: '단일 적에게 5의 피해.',
  baseEffects: [{ kind: 'damage', amount: 5, target: 'enemy' }],
  modifierPoolRefs: [POOL_PHYSICAL_ID, POOL_SINGLE_ATTACK_ID],
};

/**
 * TODO(C-round): "이번 전투에서 [단검] 태그 카드 피해량 +1" — 태그 기반
 * 전투 한정 dmg-boost 시스템 필요. 현재 stub (효과 없음).
 */
export const CARD_DAGGER_MASTERY: CardDefinition = {
  id: id<CardDefId>('dagger_mastery'), name: '단검술 숙련',
  cost: { kind: 'fixed', value: 2 }, type: 'power', target: { kind: 'self' },
  rarity: 'common', tags: [TAG_DAMAGE_BOOST, TAG_TECHNIQUE], keywords: [],
  baseDescription: '이번 전투에서 [단검] 카드의 피해량 +1 (TODO: 미구현).',
  baseEffects: [{ kind: 'custom', handlerId: 'combatDamageBoostByTag', params: { tag: 'dagger', delta: 1 } }],
  modifierPoolRefs: [],
};

/**
 * TODO(D-round): "다음 공격 피해량만큼 대상에 독 부여" — 다음 공격 라이더
 * 시스템 필요. 현재 stub.
 */
export const CARD_POISON_POTION: CardDefinition = {
  id: id<CardDefId>('poison_potion'), name: '독약병',
  cost: { kind: 'fixed', value: 1 }, type: 'skill', target: { kind: 'self' },
  rarity: 'common', tags: [TAG_PHYSICAL, TAG_SINGLE_ATTACK], keywords: [],
  baseDescription: '다음 공격 카드의 피해량만큼 대상에 중독 부여 (TODO: 미구현).',
  baseEffects: [{ kind: 'custom', handlerId: 'nextAttackRiderPoison', params: {} }],
  modifierPoolRefs: [POOL_PHYSICAL_ID, POOL_SINGLE_ATTACK_ID],
};

/**
 * 단검 — 단검마술 버프가 매 턴 손에 생성하는 임시 카드. 자체로는 풀에
 * 등록되지 않음 (보상/이벤트에서 안 나옴). 일반 단검 태그 + 소멸.
 */
export const CARD_DAGGER: CardDefinition = {
  id: id<CardDefId>('dagger'), name: '단검',
  cost: { kind: 'fixed', value: 0 }, type: 'attack', target: { kind: 'enemy' },
  rarity: 'common', tags: [TAG_DAGGER, TAG_PHYSICAL, TAG_SINGLE_ATTACK], keywords: ['exhaust'],
  baseDescription: '단일 적에게 3의 피해. 소멸.',
  baseEffects: [{ kind: 'damage', amount: 3, target: 'enemy' }],
  modifierPoolRefs: [POOL_DAGGER_ID, POOL_PHYSICAL_ID, POOL_SINGLE_ATTACK_ID],
};

export const CARD_TRICK_BELT: CardDefinition = {
  id: id<CardDefId>('trick_belt'), name: '속임수 벨트',
  cost: { kind: 'fixed', value: 3 }, type: 'skill', target: { kind: 'self' },
  rarity: 'rare', tags: [TAG_PHYSICAL, TAG_SINGLE_ATTACK], keywords: ['exhaust'],
  baseDescription: '단검마술 +1 획득 (매 턴 드로우 후 단검 생성). 소멸.',
  baseEffects: [{ kind: 'applyStatus', status: STATUS_DAGGER_TRICK_BUFF.id, stacks: 1, target: 'self' }],
  modifierPoolRefs: [POOL_PHYSICAL_ID, POOL_SINGLE_ATTACK_ID],
};

// --- 마법 카드들 ---

export const CARD_MAGIC_FIREBALL: CardDefinition = {
  id: id<CardDefId>('magic_fireball'), name: '마법 : 파이어볼',
  cost: { kind: 'fixed', value: 1 }, type: 'attack', target: { kind: 'enemy' },
  rarity: 'common', tags: [TAG_MAGIC, TAG_FIRE, TAG_BASIC_MAGIC], keywords: [],
  baseDescription: '단일 적에게 6의 피해. 양쪽 인접 적에게 3의 피해.',
  baseEffects: [
    { kind: 'custom', handlerId: 'fireballAdjacent', params: { baseAmount: 6, sideAmount: 3 } },
  ],
  modifierPoolRefs: [],
};

export const CARD_MAGIC_CHAIN_LIGHTNING: CardDefinition = {
  id: id<CardDefId>('magic_chain_lightning'), name: '마법 : 체인라이트닝',
  cost: { kind: 'fixed', value: 1 }, type: 'attack', target: { kind: 'enemy' },
  rarity: 'common', tags: [TAG_MAGIC, TAG_LIGHTNING, TAG_BASIC_MAGIC], keywords: [],
  baseDescription: '단일 적에게 6의 피해. 오른쪽 적에게 -1 피해로 연쇄 재시전.',
  baseEffects: [
    { kind: 'custom', handlerId: 'chainLightning', params: { initialAmount: 6, falloff: 1 } },
  ],
  modifierPoolRefs: [],
};

export const CARD_MAGIC_ICE_BOLT: CardDefinition = {
  id: id<CardDefId>('magic_ice_bolt'), name: '마법 : 아이스 볼트',
  cost: { kind: 'fixed', value: 2 }, type: 'attack', target: { kind: 'enemy' },
  rarity: 'common', tags: [TAG_MAGIC, TAG_COLD, TAG_BASIC_MAGIC, TAG_SINGLE_ATTACK], keywords: [],
  baseDescription: '단일 적에게 4의 피해. 빙결 +1 부여.',
  baseEffects: [
    { kind: 'damage', amount: 4, target: 'enemy' },
    { kind: 'applyStatus', status: STATUS_FREEZE.id, stacks: 1, target: 'enemy' },
  ],
  modifierPoolRefs: [],
};

export const CARD_MAGIC_FIRE_WALL: CardDefinition = {
  id: id<CardDefId>('magic_fire_wall'), name: '마법 : 파이어 월',
  cost: { kind: 'fixed', value: 2 }, type: 'attack', target: { kind: 'allEnemies' },
  rarity: 'rare', tags: [TAG_MAGIC, TAG_FIRE, TAG_MID_MAGIC, TAG_AOE_ATTACK], keywords: [],
  baseDescription: '모든 적에게 8의 피해. 화상 +3 부여.',
  baseEffects: [
    { kind: 'damage', amount: 8, target: 'allEnemies' },
    { kind: 'applyStatus', status: STATUS_BURN.id, stacks: 3, target: 'allEnemies' },
  ],
  modifierPoolRefs: [],
};

/**
 * TODO(B-round): addCardToPile 실행 (executor에서 deferred). 현재 base damage만.
 */
export const CARD_MAGIC_MISSILE: CardDefinition = {
  id: id<CardDefId>('magic_missile'), name: '마법 : 매직미사일',
  cost: { kind: 'fixed', value: 1 }, type: 'attack', target: { kind: 'enemy' },
  rarity: 'common', tags: [TAG_MAGIC, TAG_BASIC_MAGIC, TAG_SINGLE_ATTACK], keywords: [],
  baseDescription: '단일 적에게 3의 피해. "매직미사일" 1장을 손에 생성 (TODO: 미구현).',
  baseEffects: [
    { kind: 'damage', amount: 3, target: 'enemy' },
    { kind: 'addCardToPile', cardDefId: id<CardDefId>('magic_missile'), pile: 'hand' },
  ],
  modifierPoolRefs: [],
};

export const CARD_MAGIC_BLIZZARD: CardDefinition = {
  id: id<CardDefId>('magic_blizzard'), name: '마법 : 블리자드',
  cost: { kind: 'fixed', value: 3 }, type: 'attack', target: { kind: 'allEnemies' },
  rarity: 'rare', tags: [TAG_MAGIC, TAG_COLD, TAG_MID_MAGIC, TAG_AOE_ATTACK], keywords: ['exhaust'],
  baseDescription: '모든 적에게 4의 피해. 모든 적에게 빙결 +1. 소멸.',
  baseEffects: [
    { kind: 'damage', amount: 4, target: 'allEnemies' },
    { kind: 'applyStatus', status: STATUS_FREEZE.id, stacks: 1, target: 'allEnemies' },
  ],
  modifierPoolRefs: [],
};

export const CARD_MAGIC_DOUBLE_CAST: CardDefinition = {
  id: id<CardDefId>('magic_double_cast'), name: '마법 : 더블캐스팅',
  cost: { kind: 'fixed', value: 1 }, type: 'skill', target: { kind: 'self' },
  rarity: 'rare', tags: [TAG_MAGIC, TAG_SUPPORT_MAGIC], keywords: ['exhaust'],
  baseDescription: '더블캐스팅 +1 (다음 마법 사용 시 2번 발동). 소멸.',
  baseEffects: [{ kind: 'applyStatus', status: STATUS_DOUBLE_CAST.id, stacks: 1, target: 'self' }],
  modifierPoolRefs: [],
};

export const CARD_MAGIC_EM_FIELD: CardDefinition = {
  id: id<CardDefId>('magic_em_field'), name: '마법 : 전자기 역장',
  cost: { kind: 'fixed', value: 2 }, type: 'skill', target: { kind: 'self' },
  rarity: 'rare', tags: [TAG_MAGIC, TAG_LIGHTNING, TAG_MID_MAGIC, TAG_SINGLE_DEFENSE], keywords: ['exhaust'],
  baseDescription: '판금 +5, 가시 +5, 방어도 +5. 소멸.',
  baseEffects: [
    { kind: 'applyStatus', status: STATUS_PLATE.id,  stacks: 5, target: 'self' },
    { kind: 'applyStatus', status: STATUS_THORNS.id, stacks: 5, target: 'self' },
    { kind: 'gainBlock', amount: 5 },
  ],
  modifierPoolRefs: [],
};

/**
 * TODO(B-round): addCardToPile 실행 필요. 현재 base block만.
 */
export const CARD_MAGIC_SHIELD: CardDefinition = {
  id: id<CardDefId>('magic_shield'), name: '마법 : 쉴드',
  cost: { kind: 'fixed', value: 1 }, type: 'skill', target: { kind: 'self' },
  rarity: 'common', tags: [TAG_MAGIC, TAG_BASIC_MAGIC, TAG_SINGLE_DEFENSE], keywords: [],
  baseDescription: '방어도 7 획득. "마법 : 쉴드" 1장을 손에 생성 (TODO: 미구현).',
  baseEffects: [
    { kind: 'gainBlock', amount: 7 },
    { kind: 'addCardToPile', cardDefId: id<CardDefId>('magic_shield'), pile: 'hand' },
  ],
  modifierPoolRefs: [],
};

/**
 * TODO(D-round): 다음 턴 에너지 +2 예약. 현재 stub.
 */
export const CARD_MAGIC_MEMORIZE: CardDefinition = {
  id: id<CardDefId>('magic_memorize'), name: '마법 : 메모라이즈',
  cost: { kind: 'fixed', value: 1 }, type: 'skill', target: { kind: 'self' },
  rarity: 'common', tags: [TAG_MAGIC, TAG_BASIC_MAGIC], keywords: [],
  baseDescription: '다음 턴 시작 시 에너지 +2 (TODO: 미구현).',
  baseEffects: [{ kind: 'custom', handlerId: 'nextTurnEnergyReserve', params: { amount: 2 } }],
  modifierPoolRefs: [],
};

/**
 * TODO(C-round): 마지막 사용 마법 카드 복제. 현재 stub (아무것도 안 함).
 */
export const CARD_MAGIC_MIRROR_IMAGE: CardDefinition = {
  id: id<CardDefId>('magic_mirror_image'), name: '마법 : 거울상',
  cost: { kind: 'fixed', value: 0 }, type: 'skill', target: { kind: 'self' },
  rarity: 'rare', tags: [TAG_MAGIC, TAG_SUPPORT_MAGIC], keywords: ['exhaust'],
  baseDescription: '마지막에 사용한 "마법" 카드 1장을 손에 복제. 소멸. (TODO: 미구현)',
  baseEffects: [{ kind: 'custom', handlerId: 'cloneLastMagicToHand', params: {} }],
  modifierPoolRefs: [],
};

export const CARD_MAGIC_METEOR: CardDefinition = {
  id: id<CardDefId>('magic_meteor'), name: '마법 : 운석 충돌',
  cost: { kind: 'fixed', value: 4 }, type: 'attack', target: { kind: 'allEnemies' },
  rarity: 'legendary', tags: [TAG_MAGIC, TAG_FIRE, TAG_HIGH_MAGIC, TAG_AOE_ATTACK], keywords: ['exhaust'],
  baseDescription: '모든 적에게 30의 피해. 모든 적에게 기절 +1. 소멸.',
  baseEffects: [
    { kind: 'damage', amount: 30, target: 'allEnemies' },
    { kind: 'applyStatus', status: STATUS_STUN.id, stacks: 1, target: 'allEnemies' },
  ],
  modifierPoolRefs: [],
};

export const CARD_MAGIC_SIMPLIFICATION: CardDefinition = {
  id: id<CardDefId>('magic_simplification'), name: '마법 : 마법 간소화',
  cost: { kind: 'fixed', value: 0 }, type: 'skill', target: { kind: 'self' },
  rarity: 'rare', tags: [TAG_MAGIC, TAG_SUPPORT_MAGIC], keywords: [],
  baseDescription: '마법간소화 +1 부여 (이번 턴 마법 비용 -N, 턴 종료 시 전부 소멸).',
  baseEffects: [{ kind: 'applyStatus', status: STATUS_MAGIC_SIMPLIFY.id, stacks: 1, target: 'self' }],
  modifierPoolRefs: [],
};

// --- 배열에 추가 ---

export const ALL_CARDS: ReadonlyArray<CardDefinition> = [
  // 기존
  CARD_STRIKE, CARD_DEFEND, CARD_HEAVY_STRIKE, CARD_DAGGER_THROW, CARD_BASH,
  // 일반 신규
  CARD_CRUEL_THRUST, CARD_ARTIFACT_APPRAISE,
  CARD_STONE_THROW, CARD_DAGGER_MASTERY, CARD_POISON_POTION, CARD_TRICK_BELT,
  CARD_DAGGER,
  // 마법
  CARD_MAGIC_FIREBALL, CARD_MAGIC_CHAIN_LIGHTNING, CARD_MAGIC_ICE_BOLT,
  CARD_MAGIC_FIRE_WALL, CARD_MAGIC_MISSILE, CARD_MAGIC_BLIZZARD,
  CARD_MAGIC_DOUBLE_CAST, CARD_MAGIC_EM_FIELD, CARD_MAGIC_SHIELD,
  CARD_MAGIC_MEMORIZE, CARD_MAGIC_MIRROR_IMAGE, CARD_MAGIC_METEOR,
  CARD_MAGIC_SIMPLIFICATION,
  // 전투골동품 (발견 전용)
  CARD_SHATTERED_STRENGTH_CRYSTAL, CARD_OLD_SHIELD_GENERATOR,
  CARD_CORRODED_NEEDLE, CARD_RUSTY_DAGGER,
  CARD_GLOWING_AMULET, CARD_ENCHANTED_SHIELD,
  CARD_SHARP_LONGSWORD, CARD_STRENGTH_PILL,
  CARD_RELIC_GEMSTONE_GAUNTLET, CARD_RELIC_RED_CUBE,
  CARD_RELIC_REVERSAL, CARD_RELIC_RUNE_SHIELD,
];
