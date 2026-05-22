import type {
  EventDefinition,
  EventId,
  FlowDefinition,
  ScenarioId,
} from '../../types/index.js';
import { POOL_MAGIC } from '../card-pools.js';

const id = <T extends string>(s: string): T => s as T;

/**
 * 마법사의 지하실 — 마법 풀(POOL_MAGIC)에서 3장을 발견형으로 제시하고
 * 1장을 덱에 추가. 등급별 동일 가중치(common 100 / rare 30 / legendary 10)
 * 는 풀 정의 자체에 박혀 있어 sampler가 그대로 사용.
 */
export const EVENT_MAGIC_CELLAR: EventDefinition = {
  id: id<EventId>('magic_cellar'),
  name: '마법사의 지하실',
  nodeType: 'event_trigger' as any,
  flowId: id<ScenarioId>('scenario_magic_cellar'),
};

export const FLOW_MAGIC_CELLAR: FlowDefinition = {
  id: id<ScenarioId>('scenario_magic_cellar'),
  entryStepId: 'open',
  steps: {
    open: {
      kind: 'dialogue',
      text: '잠겨 있던 지하실의 문이 삐걱이며 열린다. 곰팡내와 함께 마력 잔향이 새어 나온다.',
      next: 'desc',
    },
    desc: {
      kind: 'dialogue',
      text: '오래 전 사라진 마법사의 작업실. 책장 위에 정리되지 않은 마법서가 흩어져 있다.',
      next: 'instr',
    },
    instr: {
      kind: 'dialogue',
      text: '세 권의 마법서 중 하나만 가져갈 수 있을 것 같다.',
      next: 'pick',
    },
    pick: {
      kind: 'cardOffer',
      poolId: POOL_MAGIC.id,
      picksPerIteration: 3,
      iterations: 1,
      destination: 'currentDeck',
      allowSkip: true,
      next: 'end',
    },
    end: { kind: 'end', outcome: 'success' },
  },
};
