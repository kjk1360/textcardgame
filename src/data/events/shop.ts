import type {
  EventDefinition,
  EventId,
  FlowDefinition,
  ScenarioId,
} from '../../types/index.js';
import { POOL_START_CARDS } from '../card-pools.js';

const id = <T extends string>(s: string): T => s as T;

/**
 * 차원 상인 — shop 노드 기본 이벤트. 50G 차감 후 카드 풀에서 3장 중 1장
 * 선택. 정식 콘텐츠에선 상점 전용 풀 / 다양한 진열 슬롯으로 확장 예정.
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
