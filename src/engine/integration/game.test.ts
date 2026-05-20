import { describe, expect, it } from 'vitest';
import { Game } from './game.js';
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
} from './registries.js';
import { makeDefaultDifficultyTable } from '../meta/difficulty.js';
import type {
  CardDefId,
  CardDefinition,
  CardInstance,
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
} from '../../types/index.js';
import type { SkillBoxDefinition } from '../meta/skill-box.js';

const id = <T extends string>(s: string): T => s as T;

// ====================================================================
// Test data — minimal but exercises every system
// ====================================================================

// --- Statuses ---
const STR: StatusDefinition = {
  id: id<StatusId>('strength'),
  name: '근력', description: '',
  stackingRule: 'sum', decay: { kind: 'none' },
  tags: [], hooks: [],
  damagePipeline: [{ kind: 'outgoingAdd', perStack: 1 }],
};

// --- Cards ---
const strike: CardDefinition = {
  id: id<CardDefId>('strike'),
  name: '타격',
  cost: { kind: 'fixed', value: 1 },
  type: 'attack', target: { kind: 'enemy' },
  rarity: 'starter', tags: [], keywords: [],
  baseDescription: 'Deal 6 damage',
  baseEffects: [{ kind: 'damage', amount: 6, target: 'enemy' }],
  modifierPoolRefs: [id<ModifierPoolId>('pool_attack')],
};

const heavyStrike: CardDefinition = {
  id: id<CardDefId>('heavy_strike'),
  name: '강타',
  cost: { kind: 'fixed', value: 2 },
  type: 'attack', target: { kind: 'enemy' },
  rarity: 'common', tags: [], keywords: [],
  baseDescription: 'Deal 10 damage',
  baseEffects: [{ kind: 'damage', amount: 10, target: 'enemy' }],
  modifierPoolRefs: [id<ModifierPoolId>('pool_attack')],
};

const defend: CardDefinition = {
  id: id<CardDefId>('defend'),
  name: '수비',
  cost: { kind: 'fixed', value: 1 },
  type: 'skill', target: { kind: 'self' },
  rarity: 'starter', tags: [], keywords: [],
  baseDescription: 'Gain 5 block',
  baseEffects: [{ kind: 'gainBlock', amount: 5 }],
  modifierPoolRefs: [],
};

// --- Modifiers ---
const modSharpness: Modifier = {
  id: id<ModifierId>('mod_sharp'),
  name: '예리함', descriptionTemplate: '+5 damage',
  tags: [], weight: 10,
  transforms: [
    { op: 'modifyEffect', match: { kind: 'damage' }, set: { amount: { delta: 5 } } },
  ],
};
const modPoolAttack: ModifierPool = {
  id: id<ModifierPoolId>('pool_attack'),
  name: 'Attack',
  entries: [{ modifierId: modSharpness.id, weight: 10 }],
};

// --- Card pools ---
const startCardsPool: CardPool = {
  id: id<CardPoolId>('pool_start'),
  name: 'Starting Cards',
  entries: [
    { cardDefId: strike.id, weight: 5 },
    { cardDefId: defend.id, weight: 5 },
    { cardDefId: heavyStrike.id, weight: 1 },
  ],
};

// --- Skills ---
const skillLifesteal: SkillDefinition = {
  id: id<SkillId>('skill_lifesteal'),
  name: '흡혈',
  description: 'Heal on enemy kill',
  grade: 'low',
  tags: [],
  passiveEligible: true,
  hooks: [{ on: 'onEnemyKilled', effects: [{ kind: 'gainHp', amount: 3 }] }],
};

// --- Skill box ---
const lowestBox: SkillBoxDefinition = {
  grade: 'lowest',
  priceGold: 0, // free for test convenience
  entries: [{ skillId: skillLifesteal.id, weight: 1 }],
};

// --- Enemies ---
const slime: EnemyDefinition = {
  id: id<EnemyId>('slime'),
  name: '슬라임', tier: 'normal',
  hpRange: [12, 12],
  intentScript: {
    mode: 'cycle',
    intents: [{ id: 'atk', display: { kind: 'attack', value: 4 }, effects: [{ kind: 'damage', amount: 4, target: 'enemy' }] }],
  },
};
const slimeGroup: EnemyGroupDefinition = {
  id: id<EnemyGroupId>('eg_slime_solo'),
  members: [slime.id],
};

// --- Event + flow ---
const journeyStart: EventDefinition = {
  id: id<EventId>('journey_start'),
  name: '여정의 시작',
  nodeType: 'event_normal' as any,
  flowId: id<ScenarioId>('scenario_js'),
};

const journeyFlow: FlowDefinition = {
  id: id<ScenarioId>('scenario_js'),
  entryStepId: 'open',
  steps: {
    open: { kind: 'dialogue', text: '환영하노라.', next: 'pick' },
    pick: {
      kind: 'cardOffer',
      poolId: 'pool_start',
      picksPerIteration: 3,
      iterations: 5,
      destination: 'currentDeck',
      next: 'depart',
    },
    depart: { kind: 'end', outcome: 'success' },
  },
};

// --- Registries bundle ---
function makeRegistries(): GameRegistries {
  return {
    cards: makeCardRegistry([strike, heavyStrike, defend]),
    cardPools: makeCardPoolRegistry([startCardsPool]),
    modifiers: makeModifierRegistry([modSharpness]),
    modifierPools: makeModifierPoolRegistry([modPoolAttack]),
    statuses: makeStatusRegistry([STR]),
    skills: makeSkillRegistry([skillLifesteal]),
    skillBoxes: makeSkillBoxRegistryFromList([lowestBox]),
    enemies: makeEnemyRegistry([slime]),
    enemyGroups: makeEnemyGroupRegistry([slimeGroup]),
    events: makeEventRegistry([journeyStart]),
    flows: makeFlowRegistry([journeyFlow]),
  };
}

// ====================================================================
// End-to-end test
// ====================================================================

describe('Game — end-to-end cycle', () => {
  it('create character → enter dungeon → first event → map nav → combat → return to rest', () => {
    const game = new Game({
      registries: makeRegistries(),
      rngSeed: 'e2e-1',
      difficulty: makeDefaultDifficultyTable(),
    });

    // ---- Title: create character ----
    game.createCharacter(0, 'Hero');
    expect(game.state.currentSlotIndex).toBe(0);
    expect(game.state.slots[0]!.state).toBe('inStartPhase');
    expect(game.state.slots[0]!.character?.hp).toBe(70);

    // ---- Begin dungeon with empty starter deck ----
    // (in real flow the "여정의 시작" event populates deck via cardOffer)
    game.enterDungeon({ deck: [] });

    // Start node is event_normal with eventId set → flow should engage
    // But our generated map may not assign eventId. For end-to-end purposes
    // we manually plant the event onto the start node.
    const run = game.state.run!;
    const startNode = run.map.nodes[run.map.currentNodeKey]!;
    startNode.eventId = journeyStart.id;
    startNode.nodeType = 'event_normal' as any;
    // Trigger manually since we plant after enterDungeon
    (game as any).beginEvent(journeyStart.id);

    // ---- Event: dialogue ----
    let status = game.flowStatus();
    expect(status.kind).toBe('awaitingDialogue');

    // ---- Advance to cardOffer ----
    status = game.flowAdvance();
    expect(status.kind).toBe('awaitingCardPick');
    if (status.kind !== 'awaitingCardPick') throw new Error();
    expect(status.iteration).toBe(1);
    expect(status.choices.length).toBeGreaterThan(0);

    // Pick first card 5 times (iterations)
    for (let i = 0; i < 5; i++) {
      const s = game.flowStatus();
      if (s.kind !== 'awaitingCardPick') throw new Error(`iter ${i}: expected cardPick, got ${s.kind}`);
      status = game.flowPickCard(s.choices[0]!);
    }
    // After 5 iterations + depart end step, run.activity returns to inMap
    expect(run.activity.kind).toBe('inMap');
    expect(run.deck.length).toBe(5);

    // ---- Map navigation: pick a neighbor ----
    const neighbors = game.getMovableNeighbors();
    expect(neighbors.length).toBeGreaterThan(0);

    // Plant a combat node on a neighbor so we can guarantee a combat
    const combatTarget = neighbors[0]!;
    combatTarget.nodeType = 'combat_normal' as any;
    combatTarget.enemyGroupId = slimeGroup.id;

    const moveResult = game.moveTo(combatTarget.key);
    expect(moveResult.ok).toBe(true);
    expect(run.activity.kind).toBe('inCombat');
    if (run.activity.kind !== 'inCombat') throw new Error();
    expect(run.activity.enemies).toHaveLength(1);
    expect(run.activity.piles.hand.length).toBeGreaterThan(0);

    // ---- Combat: play cards until enemy dies or turns exhaust ----
    let combatSafety = 50;
    while (combatSafety-- > 0) {
      // combatPlayCard now auto-resolves combat on lethal — activity may
      // have transitioned away from 'inCombat'.
      if (run.activity.kind !== 'inCombat') break;
      const hand = run.activity.piles.hand;
      const playable = hand.find(c => {
        const def = game.registries.cards.get(c.defId);
        return def.cost.kind === 'fixed' && def.cost.value <= game.state.slots[0]!.character!.energy;
      });
      if (!playable) {
        const combatOutcome = game.combatEndTurn();
        if (combatOutcome !== 'inProgress') break;
        continue;
      }
      const def = game.registries.cards.get(playable.defId);
      const target = def.target.kind === 'enemy' ? run.activity.enemies[0]!.instanceId : undefined;
      game.combatPlayCard(playable.instanceId, target);
    }
    // Combat won → reward pick screen; skip to return to map
    expect(run.activity.kind).toBe('rewardPick');
    game.rewardSkip();
    expect(run.activity.kind).toBe('inMap');

    // ---- Move to rest node to end run ----
    // Plant rest node on a current neighbor and travel there
    const remaining = game.getMovableNeighbors();
    if (remaining.length > 0) {
      const restCandidate = remaining[0]!;
      restCandidate.nodeType = 'rest' as any;
      game.moveTo(restCandidate.key);
    } else {
      // If stuck, just call completeRun directly
      game.completeRun();
    }
    expect(game.state.slots[0]!.state).toBe('atRest');
    expect(game.state.run).toBeNull();

    // ---- Rest hub: deck should be available for management ----
    const pending = game.getRestHubPendingDeck();
    expect(pending.length).toBe(5); // 5 cards picked during journey_start

    // ---- Store one card to inventory ----
    const toStore = pending[0]!.instanceId;
    expect(game.restStoreCard(toStore)).toBe(true);
    expect(game.state.global.inventory.cards).toHaveLength(1);
    expect(game.getRestHubPendingDeck().length).toBe(4);

    // ---- Sell one card ----
    const toSell = game.getRestHubPendingDeck()[0]!.instanceId;
    const gold = game.restSellCard(toSell, 'pendingDeck');
    expect(gold).toBeGreaterThan(0);
    expect(game.state.global.gold).toBe(gold);
    expect(game.getRestHubPendingDeck().length).toBe(3);

    // ---- Bulk-sell the rest ----
    const remainingPending = game.getRestHubPendingDeck().length;
    const { totalGold } = game.restAutoSellPendingDeck();
    expect(totalGold).toBeGreaterThan(0);
    void remainingPending;
    expect(game.getRestHubPendingDeck().length).toBe(0);

    // Difficulty incremented from rest return
    expect(game.state.slots[0]!.difficultyLevel).toBe(1);
  });

  it('character death wipes slot, global persists', () => {
    const game = new Game({
      registries: makeRegistries(),
      rngSeed: 'death-1',
      difficulty: makeDefaultDifficultyTable(),
    });
    game.createCharacter(0, 'Doomed');
    // Manually accumulate global state
    game.state.global.gold = 500;
    game.state.global.inventory.cards.push({
      instanceId: 'persist-1' as any,
      defId: strike.id,
      modifiers: [],
      acquired: { kind: 'starter' },
    } as CardInstance);

    // Enter dungeon — skip auto content seed so we control nodes exactly
    game.enterDungeon({ deck: [], skipContentSeed: true });
    const run = game.state.run!;

    // Force combat with overwhelming enemy
    const node = run.map.nodes[run.map.currentNodeKey]!;
    node.nodeType = 'combat_normal' as any;
    node.enemyGroupId = slimeGroup.id;

    const neighbors = game.getMovableNeighbors();
    if (neighbors.length > 0) {
      neighbors[0]!.nodeType = 'combat_normal' as any;
      neighbors[0]!.enemyGroupId = slimeGroup.id;
      game.moveTo(neighbors[0]!.key);
    }

    // Kill the player manually
    game.state.slots[0]!.character!.hp = 0;
    // Trigger combat end check → game-over state
    game.combatEndTurn();
    expect(run.activity.kind).toBe('gameOver');

    // UI acknowledgement wipes the slot
    game.acknowledgeGameOver();
    expect(game.state.slots[0]!.state).toBe('empty');
    expect(game.state.global.gold).toBe(500);
    expect(game.state.global.inventory.cards).toHaveLength(1);
  });

  it('starts with 5 empty slots', () => {
    const game = new Game({
      registries: makeRegistries(),
      rngSeed: 'fresh',
    });
    expect(game.state.slots).toHaveLength(5);
    expect(game.state.slots.every(s => s.state === 'empty')).toBe(true);
    expect(game.state.currentSlotIndex).toBeNull();
  });

  it('selectSlot updates currentSlotIndex', () => {
    const game = new Game({
      registries: makeRegistries(),
      rngSeed: 'sel',
    });
    game.selectSlot(2);
    expect(game.state.currentSlotIndex).toBe(2);
  });
});
