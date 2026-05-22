import type { CardPool, CardPoolId } from '../types/index.js';
import {
  // 기존
  CARD_BASH,
  CARD_DAGGER_THROW,
  CARD_DEFEND,
  CARD_HEAVY_STRIKE,
  CARD_STRIKE,
  // 일반 신규
  CARD_ARTIFACT_APPRAISE,
  CARD_CRUEL_THRUST,
  CARD_DAGGER_MASTERY,
  CARD_POISON_POTION,
  CARD_STONE_THROW,
  CARD_TRICK_BELT,
  // 마법
  CARD_MAGIC_BLIZZARD,
  CARD_MAGIC_CHAIN_LIGHTNING,
  CARD_MAGIC_DOUBLE_CAST,
  CARD_MAGIC_EM_FIELD,
  CARD_MAGIC_FIRE_WALL,
  CARD_MAGIC_FIREBALL,
  CARD_MAGIC_ICE_BOLT,
  CARD_MAGIC_MEMORIZE,
  CARD_MAGIC_METEOR,
  CARD_MAGIC_MIRROR_IMAGE,
  CARD_MAGIC_MISSILE,
  CARD_MAGIC_SHIELD,
  CARD_MAGIC_SIMPLIFICATION,
  // 전투골동품
  CARD_CORRODED_NEEDLE,
  CARD_ENCHANTED_SHIELD,
  CARD_GLOWING_AMULET,
  CARD_OLD_SHIELD_GENERATOR,
  CARD_RELIC_GEMSTONE_GAUNTLET,
  CARD_RELIC_RED_CUBE,
  CARD_RELIC_REVERSAL,
  CARD_RELIC_RUNE_SHIELD,
  CARD_RUSTY_DAGGER,
  CARD_SHARP_LONGSWORD,
  CARD_SHATTERED_STRENGTH_CRYSTAL,
  CARD_STRENGTH_PILL,
} from './cards.js';

const id = <T extends string>(s: string): T => s as T;

/**
 * Card pools — referenced by events / cardOffer steps / starting deck
 * generation. Same card may appear in multiple pools; the multi-pool
 * sampler dedupes via MAX weight (set semantics).
 */

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

// --------------------------------------------------------------------
// Mock pools demonstrating set-semantic overlap. Wired into
// EVENT_MYSTERY_CAMP as poolRefs with conditional gating.
// --------------------------------------------------------------------

export const POOL_CARDS_BASIC: CardPool = {
  id: id<CardPoolId>('pool_cards_basic'),
  name: '기본 보상 풀',
  entries: [
    { cardDefId: CARD_STRIKE.id, weight: 10 },
    { cardDefId: CARD_DEFEND.id, weight: 10 },
    { cardDefId: CARD_HEAVY_STRIKE.id, weight: 5 },
  ],
};

export const POOL_CARDS_DAGGER: CardPool = {
  id: id<CardPoolId>('pool_cards_dagger'),
  name: '단검 컬렉션 풀',
  entries: [
    { cardDefId: CARD_DAGGER_THROW.id, weight: 10 },
    // 추가 단검 카드들이 들어갈 자리 (데이터 입력 단계에서 확장)
  ],
};

/**
 * Rare reward pool — gated behind clearing a specific event in the run.
 * Demo events use this with conditional poolRefs.
 */
export const POOL_CARDS_RARE: CardPool = {
  id: id<CardPoolId>('pool_cards_rare'),
  name: '드문 보상 풀',
  entries: [
    { cardDefId: CARD_BASH.id, weight: 6 },
    { cardDefId: CARD_DAGGER_THROW.id, weight: 3 },  // overlap with DAGGER pool
  ],
};

// ====================================================================
// Round-1 신규 풀
// ====================================================================

/**
 * 전투골동품 풀 — 골동품 감정 카드의 발견 대상.
 * common 100 / rare 30 / legendary 10 (gradeWeight 규칙).
 * 일반 보상/상점/이벤트에서는 절대 등장 안 함 — 발견 전용.
 */
export const POOL_COMBAT_ARTIFACT: CardPool = {
  id: id<CardPoolId>('pool_combat_artifact'),
  name: '전투골동품 풀',
  entries: [
    // common (w=100)
    { cardDefId: CARD_SHATTERED_STRENGTH_CRYSTAL.id, weight: 100 },
    { cardDefId: CARD_OLD_SHIELD_GENERATOR.id,       weight: 100 },
    { cardDefId: CARD_CORRODED_NEEDLE.id,            weight: 100 },
    { cardDefId: CARD_RUSTY_DAGGER.id,               weight: 100 },
    // rare (w=30)
    { cardDefId: CARD_GLOWING_AMULET.id,             weight: 30 },
    { cardDefId: CARD_ENCHANTED_SHIELD.id,           weight: 30 },
    { cardDefId: CARD_SHARP_LONGSWORD.id,            weight: 30 },
    { cardDefId: CARD_STRENGTH_PILL.id,              weight: 30 },
    // legendary (w=10)
    { cardDefId: CARD_RELIC_GEMSTONE_GAUNTLET.id,    weight: 10 },
    { cardDefId: CARD_RELIC_RED_CUBE.id,             weight: 10 },
    { cardDefId: CARD_RELIC_REVERSAL.id,             weight: 10 },
    { cardDefId: CARD_RELIC_RUNE_SHIELD.id,          weight: 10 },
  ],
};

/**
 * 마법 풀 — "마법사의 지하실" 이벤트가 사용. 모든 magic 태그 카드.
 * 등급별 동일 가중치 (common 100 / rare 30 / legendary 10).
 */
export const POOL_MAGIC: CardPool = {
  id: id<CardPoolId>('pool_magic'),
  name: '마법 풀',
  entries: [
    // common
    { cardDefId: CARD_MAGIC_FIREBALL.id,        weight: 100 },
    { cardDefId: CARD_MAGIC_CHAIN_LIGHTNING.id, weight: 100 },
    { cardDefId: CARD_MAGIC_ICE_BOLT.id,        weight: 100 },
    { cardDefId: CARD_MAGIC_MISSILE.id,         weight: 100 },
    { cardDefId: CARD_MAGIC_SHIELD.id,          weight: 100 },
    { cardDefId: CARD_MAGIC_MEMORIZE.id,        weight: 100 },
    // rare
    { cardDefId: CARD_MAGIC_FIRE_WALL.id,       weight: 30 },
    { cardDefId: CARD_MAGIC_BLIZZARD.id,        weight: 30 },
    { cardDefId: CARD_MAGIC_DOUBLE_CAST.id,     weight: 30 },
    { cardDefId: CARD_MAGIC_EM_FIELD.id,        weight: 30 },
    { cardDefId: CARD_MAGIC_MIRROR_IMAGE.id,    weight: 30 },
    { cardDefId: CARD_MAGIC_SIMPLIFICATION.id,  weight: 30 },
    // legendary
    { cardDefId: CARD_MAGIC_METEOR.id,          weight: 10 },
  ],
};

/**
 * 물리적 폭력 풀 — "오래된 전장" 이벤트가 사용. 마법/골동품 제외
 * 신규 카드 + 골동품 감정 카드. 등급별 동일 가중치.
 */
export const POOL_PHYSICAL_VIOLENCE: CardPool = {
  id: id<CardPoolId>('pool_physical_violence'),
  name: '물리적 폭력 풀',
  entries: [
    // common
    { cardDefId: CARD_CRUEL_THRUST.id,    weight: 100 },
    { cardDefId: CARD_STONE_THROW.id,     weight: 100 },
    { cardDefId: CARD_DAGGER_MASTERY.id,  weight: 100 },
    { cardDefId: CARD_POISON_POTION.id,   weight: 100 },
    // rare
    { cardDefId: CARD_ARTIFACT_APPRAISE.id, weight: 30 },
    { cardDefId: CARD_TRICK_BELT.id,        weight: 30 },
  ],
};

/**
 * 상인 풀 — 골동품 제외 모든 카드(기존 + 신규). 상점 진열용.
 */
export const POOL_MERCHANT: CardPool = {
  id: id<CardPoolId>('pool_merchant'),
  name: '상인 풀',
  entries: [
    // 기존
    { cardDefId: CARD_STRIKE.id,        weight: 100 },
    { cardDefId: CARD_DEFEND.id,        weight: 100 },
    { cardDefId: CARD_HEAVY_STRIKE.id,  weight: 100 },
    { cardDefId: CARD_DAGGER_THROW.id,  weight: 100 },
    { cardDefId: CARD_BASH.id,          weight: 100 },
    // 일반 신규
    { cardDefId: CARD_CRUEL_THRUST.id,  weight: 100 },
    { cardDefId: CARD_STONE_THROW.id,   weight: 100 },
    { cardDefId: CARD_DAGGER_MASTERY.id, weight: 100 },
    { cardDefId: CARD_POISON_POTION.id, weight: 100 },
    { cardDefId: CARD_ARTIFACT_APPRAISE.id, weight: 30 },
    { cardDefId: CARD_TRICK_BELT.id,    weight: 30 },
    // 마법
    { cardDefId: CARD_MAGIC_FIREBALL.id,        weight: 100 },
    { cardDefId: CARD_MAGIC_CHAIN_LIGHTNING.id, weight: 100 },
    { cardDefId: CARD_MAGIC_ICE_BOLT.id,        weight: 100 },
    { cardDefId: CARD_MAGIC_MISSILE.id,         weight: 100 },
    { cardDefId: CARD_MAGIC_SHIELD.id,          weight: 100 },
    { cardDefId: CARD_MAGIC_MEMORIZE.id,        weight: 100 },
    { cardDefId: CARD_MAGIC_FIRE_WALL.id,       weight: 30 },
    { cardDefId: CARD_MAGIC_BLIZZARD.id,        weight: 30 },
    { cardDefId: CARD_MAGIC_DOUBLE_CAST.id,     weight: 30 },
    { cardDefId: CARD_MAGIC_EM_FIELD.id,        weight: 30 },
    { cardDefId: CARD_MAGIC_MIRROR_IMAGE.id,    weight: 30 },
    { cardDefId: CARD_MAGIC_SIMPLIFICATION.id,  weight: 30 },
    { cardDefId: CARD_MAGIC_METEOR.id,          weight: 10 },
  ],
};

export const ALL_CARD_POOLS: ReadonlyArray<CardPool> = [
  POOL_START_CARDS,
  POOL_CARDS_BASIC, POOL_CARDS_DAGGER, POOL_CARDS_RARE,
  POOL_COMBAT_ARTIFACT, POOL_MAGIC, POOL_PHYSICAL_VIOLENCE, POOL_MERCHANT,
];
