import type { EventDefinition, FlowDefinition } from '../../types/index.js';
import { EVENT_JOURNEY_START, FLOW_JOURNEY_START } from './journey-start.js';
import { EVENT_SHOP,          FLOW_SHOP          } from './shop.js';
import { EVENT_TREASURE,      FLOW_TREASURE      } from './treasure.js';
import { EVENT_UPGRADE_SHRINE, FLOW_UPGRADE_SHRINE } from './upgrade-shrine.js';
import { EVENT_MYSTERY_CAMP,   FLOW_MYSTERY_CAMP   } from './mystery-camp.js';

export * from './journey-start.js';
export * from './shop.js';
export * from './treasure.js';
export * from './upgrade-shrine.js';
export * from './mystery-camp.js';

export const ALL_EVENTS: ReadonlyArray<EventDefinition> = [
  EVENT_JOURNEY_START, EVENT_SHOP, EVENT_TREASURE,
  EVENT_UPGRADE_SHRINE, EVENT_MYSTERY_CAMP,
];

export const ALL_FLOWS: ReadonlyArray<FlowDefinition> = [
  FLOW_JOURNEY_START, FLOW_SHOP, FLOW_TREASURE,
  FLOW_UPGRADE_SHRINE, FLOW_MYSTERY_CAMP,
];
