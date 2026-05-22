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
 * shopOffer 스텝으로 POOL_MERCHANT에서 5장 진열 (등급별 가격 자동 책정:
 * common 50 / rare 150 / legendary 350). 보유 골드 한도 내 여러 장 구매
 * 가능. 200G "능력 각인" 옵션 별도 제공 — 선택 시 현재 덱 카드 1장에
 * 모디파이어 부착 (cardUpgrade 서브 스텝).
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
      next: 'shop',
    },
    shop: {
      kind: 'shopOffer',
      poolId: POOL_MERCHANT.id,
      itemCount: 5,
      engraveCost: 200,
      engraveNext: 'engrave',
      leaveNext: 'end',
    },
    engrave: {
      kind: 'cardUpgrade',
      source: 'currentDeck',
      count: 1,
      allowSkip: true,
      next: 'end',
    },
    end: { kind: 'end', outcome: 'success' },
  },
};
