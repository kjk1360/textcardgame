import type {
  EventDefinition,
  EventId,
  FlowDefinition,
  ScenarioId,
} from '../../types/index.js';
import { POOL_PHYSICAL_VIOLENCE } from '../card-pools.js';

const id = <T extends string>(s: string): T => s as T;

/**
 * 오래된 전장 — 물리적 폭력 풀(POOL_PHYSICAL_VIOLENCE)에서 3장을 제시.
 * 마법/골동품 제외 신규 카드 + 골동품 감정 카드를 등급별 가중치로 샘플.
 */
export const EVENT_ANCIENT_BATTLEFIELD: EventDefinition = {
  id: id<EventId>('ancient_battlefield'),
  name: '오래된 전장',
  nodeType: 'event_trigger' as any,
  flowId: id<ScenarioId>('scenario_ancient_battlefield'),
};

export const FLOW_ANCIENT_BATTLEFIELD: FlowDefinition = {
  id: id<ScenarioId>('scenario_ancient_battlefield'),
  entryStepId: 'open',
  steps: {
    open: {
      kind: 'dialogue',
      text: '풀들 사이로 부러진 창대와 깨진 갑옷이 모습을 드러낸다. 오래 전 누군가가 죽기로 결심한 자리.',
      next: 'desc',
    },
    desc: {
      kind: 'dialogue',
      text: '아직 쓸 만한 무기 한두 개를 챙길 수 있을 것 같다.',
      next: 'pick',
    },
    pick: {
      kind: 'cardOffer',
      poolId: POOL_PHYSICAL_VIOLENCE.id,
      picksPerIteration: 3,
      iterations: 1,
      destination: 'currentDeck',
      allowSkip: true,
      next: 'end',
    },
    end: { kind: 'end', outcome: 'success' },
  },
};
