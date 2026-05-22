import type {
  EventDefinition,
  EventId,
  FlowDefinition,
  ScenarioId,
} from '../../types/index.js';
import { POOL_MERCHANT } from '../card-pools.js';

const id = <T extends string>(s: string): T => s as T;

/**
 * 차원 상인 — shop 노드 기본 이벤트.
 *
 * Round-1 임시 구조: cardOffer로 POOL_MERCHANT에서 5장 중 1장 무료 선택.
 *
 * TODO(B-round): 진짜 상점 UX 구현 필요. 사용자 스펙:
 *   1. POOL_MERCHANT에서 5장 랜덤 진열 + 카드별 가격 (등급별 가격표 필요)
 *   2. 골드가 허락하는 한 여러 장 구매 가능 (현재 cardOffer는 1장만)
 *   3. 200G "능력 각인" 옵션 필수 (cardUpgrade 1회 — 현재 덱에서 강화)
 *   4. 총 6개 선택지 (카드 5개 + 각인)
 * 새로운 `shopOffer` 플로우 스텝 + UI 화면이 필요. 이번 라운드에선
 * 단순 cardOffer로 임시 대체.
 */
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
      text: '재미있는 물건이 좀 있다네. 보고 가시게.',
      next: 'cards',
    },
    cards: {
      kind: 'cardOffer',
      poolId: POOL_MERCHANT.id,
      picksPerIteration: 5,
      iterations: 1,
      destination: 'currentDeck',
      allowSkip: true,
      next: 'end',
    },
    end: { kind: 'end', outcome: 'success' },
  },
};
