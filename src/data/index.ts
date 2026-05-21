/**
 * Demo content — assembly point.
 *
 * Files are split by category to keep authoring sane. To add new
 * content, edit the relevant file (cards.ts / modifiers.ts /
 * card-pools.ts / events/*.ts / ...) and make sure it ends up in the
 * matching ALL_* array; this module wires the arrays into engine
 * registries.
 *
 * Reference integrity (poolEntry.cardDefId points to a real card,
 * modifierPoolRef points to a real pool, etc.) is enforced by
 * `data-integrity.test.ts` — running `npm test` after editing will
 * catch dangling references at PR time.
 */

import {
  makeCardPoolRegistry,
  makeCardRegistry,
  makeEnemyGroupRegistry,
  makeEnemyRegistry,
  makeEventRegistry,
  makeFlowRegistry,
  makeModifierPoolRegistry,
  makeModifierRegistry,
  makeSkillBoxRegistryFromList,
  makeSkillRegistry,
  makeStatusRegistry,
  type GameRegistries,
} from '../engine/integration/registries.js';

import { ALL_STATUSES }        from './statuses.js';
import { ALL_CARDS }           from './cards.js';
import { ALL_CARD_POOLS }      from './card-pools.js';
import { ALL_MODIFIERS }       from './modifiers.js';
import { ALL_MODIFIER_POOLS }  from './modifier-pools.js';
import { ALL_SKILLS, ALL_SKILL_BOXES } from './skills.js';
import { ALL_ENEMIES, ALL_ENEMY_GROUPS } from './enemies.js';
import { ALL_EVENTS, ALL_FLOWS } from './events/index.js';

export * from './statuses.js';
export * from './cards.js';
export * from './card-pools.js';
export * from './modifiers.js';
export * from './modifier-pools.js';
export * from './skills.js';
export * from './enemies.js';
export * from './events/index.js';

export function makeDemoRegistries(): GameRegistries {
  return {
    cards:         makeCardRegistry(ALL_CARDS),
    cardPools:     makeCardPoolRegistry(ALL_CARD_POOLS),
    modifiers:     makeModifierRegistry(ALL_MODIFIERS),
    modifierPools: makeModifierPoolRegistry(ALL_MODIFIER_POOLS),
    statuses:      makeStatusRegistry(ALL_STATUSES),
    skills:        makeSkillRegistry(ALL_SKILLS),
    skillBoxes:    makeSkillBoxRegistryFromList(ALL_SKILL_BOXES),
    enemies:       makeEnemyRegistry(ALL_ENEMIES),
    enemyGroups:   makeEnemyGroupRegistry(ALL_ENEMY_GROUPS),
    events:        makeEventRegistry(ALL_EVENTS),
    flows:         makeFlowRegistry(ALL_FLOWS),
  };
}
