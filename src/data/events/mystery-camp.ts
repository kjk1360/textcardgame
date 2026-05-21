import type {
  EventDefinition,
  EventId,
  FlowDefinition,
  ScenarioId,
} from '../../types/index.js';
import { CARD_DAGGER_THROW } from '../cards.js';
import {
  POOL_CARDS_BASIC,
  POOL_CARDS_DAGGER,
  POOL_CARDS_RARE,
} from '../card-pools.js';

const id = <T extends string>(s: string): T => s as T;

/**
 * 수상한 캠프 — illustrates conditional poolRefs on cardOffer.
 *
 * Pool composition:
 *   - BASIC always.
 *   - DAGGER added if the player currently holds 단검투척.
 *   - RARE added only if the upgrade shrine has been cleared this run.
 *
 * Pure mock scaffold to show the data shape — rename / re-wire once
 * real content lands.
 */
export const EVENT_MYSTERY_CAMP: EventDefinition = {
  id: id<EventId>('mystery_camp'),
  name: '수상한 캠프',
  nodeType: 'event_trigger' as any,
  flowId: id<ScenarioId>('scenario_mystery_camp'),
};

export const FLOW_MYSTERY_CAMP: FlowDefinition = {
  id: id<ScenarioId>('scenario_mystery_camp'),
  entryStepId: 'open',
  steps: {
    open: {
      kind: 'dialogue',
      text: '낯선 캠프 앞에 도착했다. 누군가 카드 한 장을 권한다.',
      next: 'pick',
    },
    pick: {
      kind: 'cardOffer',
      poolRefs: [
        { poolId: POOL_CARDS_BASIC.id },
        {
          poolId: POOL_CARDS_DAGGER.id,
          condition: { kind: 'hasCardInDeck', defId: CARD_DAGGER_THROW.id, min: 1 },
        },
        {
          poolId: POOL_CARDS_RARE.id,
          condition: { kind: 'eventCleared', eventId: id<EventId>('upgrade_shrine') },
        },
      ],
      picksPerIteration: 3,
      iterations: 1,
      destination: 'currentDeck',
      allowSkip: true,
      next: 'end',
    },
    end: { kind: 'end', outcome: 'success' },
  },
};
