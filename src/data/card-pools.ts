import type { CardPool, CardPoolId } from '../types/index.js';
import {
  CARD_BASH,
  CARD_DAGGER_THROW,
  CARD_DEFEND,
  CARD_HEAVY_STRIKE,
  CARD_STRIKE,
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

export const ALL_CARD_POOLS: ReadonlyArray<CardPool> = [
  POOL_START_CARDS,
  POOL_CARDS_BASIC, POOL_CARDS_DAGGER, POOL_CARDS_RARE,
];
