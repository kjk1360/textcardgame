import type {
  EventDefinition,
  EventId,
  FlowDefinition,
  ScenarioId,
} from '../../types/index.js';
import { POOL_START_CARDS } from '../card-pools.js';

const id = <T extends string>(s: string): T => s as T;

/**
 * 여정의 시작 — 신규 캐릭터(또는 첫 런)가 들어가자마자 띄우는 카드 5장
 * 드래프트. 인벤토리에서 가져온 카드 수만큼 채워줘서 항상 총 5장이 되게
 * 함 (`fillToDeckCount`).
 */
export const EVENT_JOURNEY_START: EventDefinition = {
  id: id<EventId>('journey_start'),
  name: '여정의 시작',
  nodeType: 'event_trigger' as any,
  flowId: id<ScenarioId>('scenario_journey_start'),
  oneShot: false,
  // Only at the start node — never picked for random event tiles.
  startOnly: true,
};

export const FLOW_JOURNEY_START: FlowDefinition = {
  id: id<ScenarioId>('scenario_journey_start'),
  entryStepId: 'open',
  steps: {
    open:  { kind: 'dialogue', speaker: '차원의 안내자', text: '또 한 명의 도전자가 왔군. 너의 첫 무기를 골라야 한다.', next: 'instr' },
    instr: { kind: 'dialogue', text: '다섯 번에 걸쳐, 세 장 중 한 장을 골라라.', next: 'picks' },
    picks: {
      kind: 'cardOffer',
      poolId: POOL_START_CARDS.id,
      picksPerIteration: 3,
      iterations: 5,
      fillToDeckCount: 5,
      destination: 'currentDeck',
      next: 'depart',
    },
    depart: { kind: 'dialogue', text: '행운을 빈다.', next: 'end' },
    end:    { kind: 'end', outcome: 'success' },
  },
};
