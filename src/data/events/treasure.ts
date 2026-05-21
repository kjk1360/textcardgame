import type {
  EventDefinition,
  EventId,
  FlowDefinition,
  ScenarioId,
} from '../../types/index.js';
import { TREASURE_SKILL_POOL } from '../skills.js';

const id = <T extends string>(s: string): T => s as T;

/**
 * 차원의 보물 — treasure 노드 기본 이벤트. 골드 +30 + 스킬 3장 중 1장
 * (보유 중인 건 제외; 풀 고갈 시 골드 마커로 채움).
 */
export const EVENT_TREASURE: EventDefinition = {
  id: id<EventId>('treasure_default'),
  name: '차원의 보물',
  nodeType: 'treasure' as any,
  flowId: id<ScenarioId>('scenario_treasure'),
};

export const FLOW_TREASURE: FlowDefinition = {
  id: id<ScenarioId>('scenario_treasure'),
  entryStepId: 'open',
  steps: {
    open: {
      kind: 'dialogue',
      text: '보물 상자를 발견했다! 그 속에 스킬북이…',
      next: 'gold',
    },
    gold: {
      kind: 'applyEffect',
      effects: [{ kind: 'gainGold', amount: 30 }],
      next: 'skill_offer',
    },
    skill_offer: {
      kind: 'skillOffer',
      poolOverride: TREASURE_SKILL_POOL,
      count: 3,
      allowSkip: true,
      fillRestWithGoldAmount: 10,
      next: 'end',
    },
    end: { kind: 'end', outcome: 'success' },
  },
};
