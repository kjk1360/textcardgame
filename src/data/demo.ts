/**
 * Demo content — minimal game data for the UI prototype.
 *
 * This is the temporary single-file content registry used by the dev
 * UI until Phase 4 brings up the xlsx/yaml data pipeline. Designers
 * shouldn't edit this — it'll be replaced wholesale by the build-data
 * pipeline output.
 *
 * Migration note: docs/migration/01_ts_to_excel.md
 */

import type {
  CardDefId,
  CardDefinition,
  CardPool,
  CardPoolId,
  EnemyGroupId,
  EnemyId,
  EventDefinition,
  EventId,
  FlowDefinition,
  Modifier,
  ModifierId,
  ModifierPool,
  ModifierPoolId,
  ScenarioId,
  SkillDefinition,
  SkillId,
  StatusDefinition,
  StatusId,
} from '../types/index.js';
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
  type EnemyDefinition,
  type EnemyGroupDefinition,
  type GameRegistries,
} from '../engine/integration/registries.js';
import type { SkillBoxDefinition } from '../engine/meta/skill-box.js';

const id = <T extends string>(s: string): T => s as T;

// ====================================================================
// Statuses
// ====================================================================

export const STATUS_VULNERABLE: StatusDefinition = {
  id: id<StatusId>('vulnerable'), name: '취약', description: '받는 피해 +50%',
  stackingRule: 'sum', decay: { kind: 'fixedPerTurn', amount: 1 },
  tags: [], hooks: [],
  damagePipeline: [{ kind: 'incomingMul', multiplier: 1.5 }],
};
export const STATUS_WEAK: StatusDefinition = {
  id: id<StatusId>('weak'), name: '약화', description: '주는 피해 -25%',
  stackingRule: 'sum', decay: { kind: 'fixedPerTurn', amount: 1 },
  tags: [], hooks: [],
  damagePipeline: [{ kind: 'outgoingMul', multiplier: 0.75 }],
};
export const STATUS_STRENGTH: StatusDefinition = {
  id: id<StatusId>('strength'), name: '근력', description: '공격 피해 +N',
  stackingRule: 'sum', decay: { kind: 'none' },
  tags: [], hooks: [],
  damagePipeline: [{ kind: 'outgoingAdd', perStack: 1 }],
};
export const STATUS_DEXTERITY: StatusDefinition = {
  id: id<StatusId>('dexterity'), name: '민첩', description: '방어도 획득 +N',
  stackingRule: 'sum', decay: { kind: 'none' },
  tags: [], hooks: [],
  damagePipeline: [{ kind: 'blockGainAdd', perStack: 1 }],
};

// ====================================================================
// Cards
// ====================================================================

export const CARD_STRIKE: CardDefinition = {
  id: id<CardDefId>('strike'), name: '타격',
  cost: { kind: 'fixed', value: 1 }, type: 'attack', target: { kind: 'enemy' },
  rarity: 'starter', tags: [], keywords: [],
  baseDescription: '적에게 6의 피해를 줍니다.',
  baseEffects: [{ kind: 'damage', amount: 6, target: 'enemy' }],
  modifierPoolRefs: [id<ModifierPoolId>('pool_attack_generic')],
};

export const CARD_DEFEND: CardDefinition = {
  id: id<CardDefId>('defend'), name: '수비',
  cost: { kind: 'fixed', value: 1 }, type: 'skill', target: { kind: 'self' },
  rarity: 'starter', tags: [], keywords: [],
  baseDescription: '방어도 5를 얻습니다.',
  baseEffects: [{ kind: 'gainBlock', amount: 5 }],
  modifierPoolRefs: [],
};

export const CARD_HEAVY_STRIKE: CardDefinition = {
  id: id<CardDefId>('heavy_strike'), name: '강타',
  cost: { kind: 'fixed', value: 2 }, type: 'attack', target: { kind: 'enemy' },
  rarity: 'common', tags: [], keywords: [],
  baseDescription: '적에게 10의 피해를 줍니다.',
  baseEffects: [{ kind: 'damage', amount: 10, target: 'enemy' }],
  modifierPoolRefs: [id<ModifierPoolId>('pool_attack_generic')],
};

export const CARD_DAGGER_THROW: CardDefinition = {
  id: id<CardDefId>('dagger_throw'), name: '단검투척',
  cost: { kind: 'fixed', value: 0 }, type: 'attack', target: { kind: 'enemy' },
  rarity: 'common', tags: [], keywords: ['exhaust'],
  baseDescription: '적에게 4의 피해. 소멸.',
  baseEffects: [{ kind: 'damage', amount: 4, target: 'enemy' }],
  modifierPoolRefs: [id<ModifierPoolId>('pool_attack_generic')],
};

export const CARD_BASH: CardDefinition = {
  id: id<CardDefId>('bash'), name: '강타·취약',
  cost: { kind: 'fixed', value: 2 }, type: 'attack', target: { kind: 'enemy' },
  rarity: 'common', tags: [], keywords: [],
  baseDescription: '적에게 8의 피해 + 취약 2 부여.',
  baseEffects: [
    { kind: 'damage', amount: 8, target: 'enemy' },
    { kind: 'applyStatus', status: STATUS_VULNERABLE.id, stacks: 2, target: 'enemy' },
  ],
  modifierPoolRefs: [id<ModifierPoolId>('pool_attack_generic')],
};

// ====================================================================
// Modifiers
// ====================================================================

export const MOD_SHARPNESS: Modifier = {
  id: id<ModifierId>('mod_sharpness'),
  name: '예리함', descriptionTemplate: '피해량 +5.',
  tags: [], weight: 10,
  transforms: [{ op: 'modifyEffect', match: { kind: 'damage' }, set: { amount: { delta: 5 } } }],
};
export const MOD_BLEED: Modifier = {
  id: id<ModifierId>('mod_bleed_on_hit'),
  name: '출혈 부여', descriptionTemplate: '명중한 적에게 출혈을 추가합니다.',
  tags: [], weight: 5,
  transforms: [{
    op: 'appendEffect',
    effect: { kind: 'applyStatus', status: STATUS_WEAK.id, stacks: 1, target: 'enemy' },
  }],
};

export const POOL_ATTACK_GENERIC: ModifierPool = {
  id: id<ModifierPoolId>('pool_attack_generic'),
  name: '공격 일반', entries: [
    { modifierId: MOD_SHARPNESS.id, weight: 10 },
    { modifierId: MOD_BLEED.id, weight: 5 },
  ],
};

// ====================================================================
// Card pools
// ====================================================================

export const POOL_START_CARDS: CardPool = {
  id: id<CardPoolId>('pool_start_cards'),
  name: '시작 카드 풀',
  entries: [
    { cardDefId: CARD_STRIKE.id, weight: 20 },
    { cardDefId: CARD_DEFEND.id, weight: 20 },
    { cardDefId: CARD_DAGGER_THROW.id, weight: 8 },
    { cardDefId: CARD_HEAVY_STRIKE.id, weight: 5 },
    { cardDefId: CARD_BASH.id, weight: 3 },
  ],
};

// ====================================================================
// Skills + boxes
// ====================================================================

export const SKILL_LIFESTEAL: SkillDefinition = {
  id: id<SkillId>('skill_lifesteal'),
  name: '흡혈', description: '적 처치 시 3 HP 회복.',
  grade: 'low', tags: [], passiveEligible: true,
  hooks: [{ on: 'onEnemyKilled', effects: [{ kind: 'gainHp', amount: 3 }] }],
};
export const SKILL_QUICK_HANDS: SkillDefinition = {
  id: id<SkillId>('skill_quick_hands'),
  name: '빠른 손', description: '매 턴 시작 +1 드로우.',
  grade: 'low', tags: [], passiveEligible: true,
  hooks: [{ on: 'onTurnStart', effects: [{ kind: 'draw', count: 1 }] }],
};

export const SKILL_BOX_LOWEST: SkillBoxDefinition = {
  grade: 'lowest', priceGold: 50,
  entries: [
    { skillId: SKILL_LIFESTEAL.id, weight: 1 },
    { skillId: SKILL_QUICK_HANDS.id, weight: 1 },
  ],
};

// ====================================================================
// Enemies + groups
// ====================================================================

export const ENEMY_SLIME: EnemyDefinition = {
  id: id<EnemyId>('slime'), name: '슬라임', tier: 'normal',
  hpRange: [12, 14],
  intentScript: {
    mode: 'cycle',
    intents: [
      { id: 'a', display: { kind: 'attack', value: 4 }, effects: [{ kind: 'damage', amount: 4, target: 'enemy' }] },
      { id: 'd', display: { kind: 'defend', value: 3 }, effects: [{ kind: 'gainBlock', amount: 3 }] },
    ],
  },
  rewards: { goldRange: [8, 14] },
  sprite: [
    '    ▄▀▀▀▄    ',
    '   █▒░ ░▒█   ',
    '   █▒ o ▒█   ',
    '   ▀█▒▒▒█▀   ',
    '     ▀▀▀     ',
  ],
};

export const ENEMY_BRUTE: EnemyDefinition = {
  id: id<EnemyId>('brute'), name: '난폭자', tier: 'normal',
  hpRange: [25, 30],
  intentScript: {
    mode: 'cycle',
    intents: [
      { id: 'a', display: { kind: 'attack', value: 8 }, effects: [{ kind: 'damage', amount: 8, target: 'enemy' }] },
      { id: 'a2', display: { kind: 'attack', value: 8 }, effects: [{ kind: 'damage', amount: 8, target: 'enemy' }] },
      { id: 'd', display: { kind: 'defend', value: 6 }, effects: [{ kind: 'gainBlock', amount: 6 }] },
    ],
  },
  rewards: { goldRange: [15, 25] },
  sprite: [
    '   ▄█████▄   ',
    '  █▌▀ ▒ ▀▐█  ',
    '  █▌▖▗▘▝▐█   ',
    '  █▌ ▄▄▄ ▐█  ',
    '   ▀█▄▄▄█▀   ',
    '   ▟█   █▙   ',
    '  ▟▀     ▀▙  ',
  ],
};

export const GROUP_SLIME_SOLO: EnemyGroupDefinition = {
  id: id<EnemyGroupId>('eg_slime_solo'),
  members: [ENEMY_SLIME.id],
};
export const GROUP_BRUTE_SOLO: EnemyGroupDefinition = {
  id: id<EnemyGroupId>('eg_brute_solo'),
  members: [ENEMY_BRUTE.id],
};

// ====================================================================
// Events + flows
// ====================================================================

export const EVENT_JOURNEY_START: EventDefinition = {
  id: id<EventId>('journey_start'),
  name: '여정의 시작',
  nodeType: 'event_trigger' as any,
  flowId: id<ScenarioId>('scenario_journey_start'),
  oneShot: false,
};

export const FLOW_JOURNEY_START: FlowDefinition = {
  id: id<ScenarioId>('scenario_journey_start'),
  entryStepId: 'open',
  steps: {
    open: { kind: 'dialogue', speaker: '차원의 안내자', text: '또 한 명의 도전자가 왔군. 너의 첫 무기를 골라야 한다.', next: 'instr' },
    instr: { kind: 'dialogue', text: '다섯 번에 걸쳐, 세 장 중 한 장을 골라라.', next: 'picks' },
    picks: {
      kind: 'cardOffer',
      poolId: POOL_START_CARDS.id,
      picksPerIteration: 3,
      iterations: 5,
      // Pick "5 minus whatever the player already drafted from inventory".
      // If they brought 3 from the warehouse, journey_start fills 2 more.
      fillToDeckCount: 5,
      destination: 'currentDeck',
      next: 'depart',
    },
    depart: { kind: 'dialogue', text: '행운을 빈다.', next: 'end' },
    end: { kind: 'end', outcome: 'success' },
  },
};

// ---------- Shop ----------

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

// ---------- Treasure ----------

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
      text: '보물 상자를 발견했다!',
      next: 'gold',
    },
    gold: {
      kind: 'applyEffect',
      effects: [{ kind: 'gainGold', amount: 30 }],
      next: 'card_offer',
    },
    card_offer: {
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

// ====================================================================
// Bundle
// ====================================================================

export function makeDemoRegistries(): GameRegistries {
  return {
    cards: makeCardRegistry([CARD_STRIKE, CARD_DEFEND, CARD_HEAVY_STRIKE, CARD_DAGGER_THROW, CARD_BASH]),
    cardPools: makeCardPoolRegistry([POOL_START_CARDS]),
    modifiers: makeModifierRegistry([MOD_SHARPNESS, MOD_BLEED]),
    modifierPools: makeModifierPoolRegistry([POOL_ATTACK_GENERIC]),
    statuses: makeStatusRegistry([STATUS_VULNERABLE, STATUS_WEAK, STATUS_STRENGTH, STATUS_DEXTERITY]),
    skills: makeSkillRegistry([SKILL_LIFESTEAL, SKILL_QUICK_HANDS]),
    skillBoxes: makeSkillBoxRegistryFromList([SKILL_BOX_LOWEST]),
    enemies: makeEnemyRegistry([ENEMY_SLIME, ENEMY_BRUTE]),
    enemyGroups: makeEnemyGroupRegistry([GROUP_SLIME_SOLO, GROUP_BRUTE_SOLO]),
    events: makeEventRegistry([EVENT_JOURNEY_START, EVENT_SHOP, EVENT_TREASURE]),
    flows: makeFlowRegistry([FLOW_JOURNEY_START, FLOW_SHOP, FLOW_TREASURE]),
  };
}
