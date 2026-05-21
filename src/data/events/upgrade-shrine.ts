import type {
  EventDefinition,
  EventId,
  FlowDefinition,
  ScenarioId,
} from '../../types/index.js';

const id = <T extends string>(s: string): T => s as T;

/**
 * 강화의 제단 — current run deck에서 카드 한 장을 골라 모디파이어 1개
 * 부여. 후보 모디파이어는 카드의 `modifierPoolRefs` 합집합에서 dedupe 샘플.
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
