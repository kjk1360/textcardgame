import { randomUUID } from 'node:crypto';
import type {
  CardDefId,
  CardInstance,
  CardInstanceId,
  EnemyActor,
  EnemyGroupId,
  EventId,
  MapState,
  PlayerActor,
  PlayerCombatState,
  ScenarioId,
  SkillId,
} from '../../types/index.js';
import { generateMap } from '../map/generator.js';
import { getMovableNeighbors, isDeadEnd, moveTo, recoverDeadEnd, type MoveAttempt } from '../map/navigator.js';
import { DEFAULT_CONSTANTS, type GameConstants } from '../constants.js';
import { makeRng, type IRandom } from '../rng.js';
import { applyDifficultyBuffsToEnemies, type DifficultyTable, isAtFinalDifficulty, makeDefaultDifficultyTable } from '../meta/difficulty.js';
import { bulkSellCards, type MetaState } from '../meta/inventory.js';
import { FlowRuntime, type FlowRuntimeContext, type FlowStatus } from '../flow/runtime.js';
import { FlowHostImpl } from './flow-host-impl.js';
import {
  initFromDeck,
  draw,
  discardHand,
} from '../combat/piles.js';
import {
  decideNextIntent,
  endPlayerTurn,
  isCombatOver,
  runEnemyTurn,
  runOneEnemyStep,
  startPlayerTurn,
  type TurnFlowContext,
  type CombatOutcome,
} from '../combat/turn-flow.js';
import {
  canPlayCard,
  playCard,
  type PlayCardOutcome,
} from '../combat/play-card.js';
import type { GameRegistries } from './registries.js';
import { evalCondition, type ConditionContext } from '../conditions/evaluator.js';
import type { CustomEffectHandler, ExecutionContext } from '../effects/executor.js';
import { buildDefaultCustomHandlers } from '../effects/custom-handlers.js';
import { sampleCardsFromPool } from '../cards/pool-sampler.js';
import type { CardPoolId } from '../../types/index.js';
import { collectSkillHooks } from '../skills/engine.js';
import { executeEffects } from '../effects/executor.js';

/**
 * Convention: the event id that always plays as the first node of a new
 * run when present in the registry. Data-driven later — for now a constant
 * matches the design (여정의 시작).
 */
const STARTING_EVENT_ID = 'journey_start' as EventId;

/**
 * Card pool id used for combat-end card rewards. If not present in the
 * registry, the reward screen offers no card pick (just gold).
 */
const POST_COMBAT_REWARD_POOL_ID = 'pool_start_cards' as CardPoolId;
const POST_COMBAT_REWARD_COUNT = 3;

/** Standard event ids for non-combat node types. */
const SHOP_EVENT_ID = 'shop_default' as EventId;
const TREASURE_EVENT_ID = 'treasure_default' as EventId;

/** Fallback gold when final-boss victory yields no eligible skill to promote. */
const FINAL_BOSS_FALLBACK_GOLD = 5000;

/** Version of the persisted save shape — bump on incompatible changes. */
export const SERIALIZATION_VERSION = 1;

export interface SerializedSession {
  schemaVersion: number;
  global: {
    gold: number;
    inventory: { capacity: number; cards: CardInstance[] };
    passiveSkills: SkillId[];
    eventsCleared: EventId[];
    difficultyMaxReached: number;
  };
  slots: ReadonlyArray<{
    slotIndex: number;
    characterName?: string;
    difficultyLevel: number;
    character?: PlayerActor;
    skillIds: SkillId[];
    state: 'empty' | 'atRest';
    pendingDeck?: CardInstance[];
    draftedDeck?: CardInstance[];
  }>;
}

/**
 * Game — the top-level facade.
 *
 * Doc: 08_phase_and_state_machine.md
 *
 * Holds the SessionState (all 5 slots + global + active run) and exposes
 * coarse-grained methods that the UI / driver code can call. Mutates
 * state in place; UI re-reads via getState() after each call.
 *
 * What's NOT in this file:
 *   - Save persistence (SaveStore lives on the side — Game.persistTo(store))
 *   - UI rendering
 *   - Network or input
 */

// ====================================================================
// State shapes
// ====================================================================

export interface SlotData {
  slotIndex: number;
  characterName?: string;
  /** difficulty counter — increments on rest hub return */
  difficultyLevel: number;
  state: SlotKind;
  /** Character actor (energy/hp/maxHp/statuses), present unless 'empty'. */
  character?: PlayerActor;
  /** Per-character skills (live, lost on death). */
  skillIds: SkillId[];
  /**
   * Cards withdrawn from inventory at the start phase, queued for the
   * upcoming dungeon entry. Empty until the player explicitly drafts.
   * Cleared on enterDungeon.
   */
  draftedDeck?: CardInstance[];
}

/** Default cap on how many cards can be drafted out of inventory per run. */
export const DEFAULT_DRAFT_CAPACITY = 5;

export type SlotKind =
  | 'empty'
  | 'atRest'
  | 'inStartPhase'
  | 'inRun';

export interface SessionState {
  global: GlobalSessionState;
  slots: SlotData[];
  currentSlotIndex: number | null;
  /** Active run state when current slot kind === 'inRun'. */
  run: RunSessionState | null;
}

export interface GlobalSessionState extends MetaState {
  /** SkillIds永久 across characters. */
  passiveSkills: SkillId[];
  /** Set serialized as array for save. */
  eventsCleared: Set<EventId>;
  difficultyMaxReached: number;
}

export interface RunSessionState {
  slotIndex: number;
  /** Single-source-of-truth deck outside combat. */
  deck: CardInstance[];
  /** Run-local gold (enemy drops, event rewards). Converts to meta gold at rest. */
  gold: number;
  map: MapState;
  activity: RunActivity;
}

export type RunActivity =
  | { kind: 'inMap' }
  | { kind: 'inEvent'; eventId: EventId; runtime: FlowRuntime }
  | {
      kind: 'inCombat';
      enemies: EnemyActor[];
      piles: PlayerCombatState;
      turn: number;
      /** Carries the flow runtime when combat was initiated via a combatStart step. */
      resumingFlow?: { runtime: FlowRuntime; eventId: EventId };
      /**
       * When combat reaches a terminal outcome (won/lost) but the UI hasn't
       * finalized yet (e.g. during the death-fade animation), this field is
       * set. The UI calls finalizeCombatEnd() once its animations complete
       * to actually trigger resolveCombatEnd.
       *
       * Engine tests use autoResolveCombat=true (default in ctor) so this
       * never gets set during test runs.
       */
      pendingResolve?: { outcome: CombatOutcome };
      /**
       * Stepped enemy turn queue (UI mode). Set by `combatEndTurn` when
       * `autoResolveCombat=false`; each entry corresponds to one enemy's
       * action. The UI walks the queue via `combatStepEnemyTurn()` with
       * Enter + animations between steps. Once `cursor === steps.length`
       * the UI calls `combatBeginNextPlayerTurn()` to advance the turn.
       *
       * Tests with autoResolveCombat=true never see this — runEnemyTurn
       * runs all enemies inline.
       */
      pendingEnemyTurn?: {
        steps: ReadonlyArray<{ enemyInstanceId: string; description: string }>;
        cursor: number;
      };
      /**
       * Discover pending state — set by the `discoverFromPool` custom
       * handler. Pause combat input until UI calls `combatPickDiscover`
       * to commit (or skip).
       */
      pendingDiscover?: {
        choices: CardDefId[];
        canSkip: boolean;
      };
    }
  | {
      kind: 'rewardPick';
      /** CardDefIds offered as combat-end reward (pick 1 or skip). */
      choices: ReadonlyArray<import('../../types/index.js').CardDefId>;
      /** Gold earned from the combat. Already added to run.gold; shown for UX. */
      goldEarned: number;
      /** Carry-through flow context if combat was launched mid-flow. */
      resumingFlow?: { runtime: FlowRuntime; eventId: EventId };
    }
  | {
      kind: 'gameOver';
      /** Summary shown on the death screen. */
      reason: 'died-in-combat' | 'died-other';
      runStatsSnapshot: {
        difficultyReached: number;
        nodesVisited: number;
        cardsCarried: number;
      };
    }
  | {
      kind: 'passivePromote';
      /** Eligible skills the player can promote to global passive.
       *  Empty array → no eligible skill; player gets fallbackGold instead. */
      candidates: ReadonlyArray<SkillId>;
      fallbackGold?: number;
    };

// ====================================================================
// Construction
// ====================================================================

export interface GameOptions {
  registries: GameRegistries;
  rngSeed?: string;
  constants?: GameConstants;
  difficulty?: DifficultyTable;
  /**
   * When true (default), combat auto-resolves the moment all enemies
   * die or the player dies — useful for tests. When false, the engine
   * stages a pendingResolve marker on the inCombat activity, and the
   * caller (UI) must invoke `finalizeCombatEnd()` once its animations
   * have played out.
   */
  autoResolveCombat?: boolean;
  /**
   * Additional / override custom-effect handlers. Merged on top of the
   * defaults from `buildDefaultCustomHandlers`.
   */
  customHandlers?: ReadonlyMap<string, CustomEffectHandler>;
}

export function createInitialState(): SessionState {
  return {
    global: {
      gold: 0,
      inventory: { capacity: 20, cards: [] },
      passiveSkills: [],
      eventsCleared: new Set(),
      difficultyMaxReached: 0,
    },
    slots: Array.from({ length: 5 }, (_, i) => ({
      slotIndex: i,
      difficultyLevel: 0,
      state: 'empty' as SlotKind,
      skillIds: [],
    })),
    currentSlotIndex: null,
    run: null,
  };
}

export class Game {
  readonly registries: GameRegistries;
  readonly constants: GameConstants;
  readonly difficultyTable: DifficultyTable;
  readonly rng: IRandom;
  readonly autoResolveCombat: boolean;
  /** Effect handlers for `{ kind: 'custom' }` effects (poison tick, etc.). */
  readonly customHandlers: ReadonlyMap<string, CustomEffectHandler>;
  state: SessionState;

  constructor(opts: GameOptions) {
    this.registries = opts.registries;
    this.constants = opts.constants ?? DEFAULT_CONSTANTS;
    this.difficultyTable = opts.difficulty ?? makeDefaultDifficultyTable();
    this.rng = makeRng(opts.rngSeed ?? `game-${Date.now()}`);
    this.autoResolveCombat = opts.autoResolveCombat ?? true;
    this.customHandlers = buildDefaultCustomHandlers(
      { cardPools: this.registries.cardPools, rng: this.rng },
      opts.customHandlers,
    );
    this.state = createInitialState();
  }

  // ====================================================================
  // Serialization (for auto-save)
  // ====================================================================
  //
  // v1 strategy: save only between runs (slot.state === 'empty' | 'atRest').
  // Slots that are inStartPhase / inRun are downgraded to atRest on save —
  // the in-flight run state itself doesn't persist. Player respawns at the
  // rest hub on next load.
  //
  // Schema versioning: bump SERIALIZATION_VERSION whenever the shape
  // changes; add a migration in the deserialize() switch.

  serialize(): SerializedSession {
    return {
      schemaVersion: SERIALIZATION_VERSION,
      global: {
        gold: this.state.global.gold,
        inventory: this.state.global.inventory,
        passiveSkills: this.state.global.passiveSkills,
        eventsCleared: [...this.state.global.eventsCleared],
        difficultyMaxReached: this.state.global.difficultyMaxReached,
      },
      slots: this.state.slots.map(s => {
        // Downgrade inStartPhase/inRun → atRest with whatever character data exists
        const stableState: 'empty' | 'atRest' =
          s.state === 'empty' ? 'empty' : 'atRest';
        return {
          slotIndex: s.slotIndex,
          characterName: s.characterName,
          difficultyLevel: s.difficultyLevel,
          character: s.character,
          skillIds: s.skillIds,
          state: stableState,
          pendingDeck: ((s as any).pendingDeck as CardInstance[] | undefined) ?? [],
          draftedDeck: s.draftedDeck ?? [],
        };
      }),
    };
  }

  deserialize(json: SerializedSession): void {
    if (json.schemaVersion !== SERIALIZATION_VERSION) {
      throw new Error(`Save schema v${json.schemaVersion} != current v${SERIALIZATION_VERSION}`);
    }
    this.state = {
      global: {
        gold: json.global.gold,
        inventory: { ...json.global.inventory },
        passiveSkills: [...json.global.passiveSkills],
        eventsCleared: new Set(json.global.eventsCleared),
        difficultyMaxReached: json.global.difficultyMaxReached,
      },
      slots: json.slots.map(s => {
        const slot: SlotData = {
          slotIndex: s.slotIndex,
          characterName: s.characterName,
          difficultyLevel: s.difficultyLevel,
          state: s.state,
          character: s.character,
          skillIds: [...s.skillIds],
        };
        if (s.pendingDeck && s.pendingDeck.length > 0) {
          (slot as any).pendingDeck = [...s.pendingDeck];
        }
        if (s.draftedDeck && s.draftedDeck.length > 0) {
          slot.draftedDeck = [...s.draftedDeck];
        }
        return slot;
      }),
      currentSlotIndex: null,
      run: null,
    };
  }

  // ====================================================================
  // Slot lifecycle
  // ====================================================================

  selectSlot(slotIndex: number): void {
    this.requireSlotIndex(slotIndex);
    this.state.currentSlotIndex = slotIndex;
  }

  createCharacter(slotIndex: number, name: string, opts?: { startHp?: number; maxHp?: number }): void {
    this.requireSlotIndex(slotIndex);
    const maxHp = opts?.maxHp ?? 70;
    const startHp = opts?.startHp ?? maxHp;
    this.state.slots[slotIndex] = {
      slotIndex,
      characterName: name,
      difficultyLevel: 0,
      state: 'inStartPhase',
      character: {
        kind: 'player',
        hp: startHp,
        maxHp,
        block: 0,
        energy: this.constants.energy.base,
        maxEnergy: this.constants.energy.base,
        statuses: [],
      },
      skillIds: [],
    };
    this.state.currentSlotIndex = slotIndex;
  }

  deleteSlot(slotIndex: number): void {
    this.requireSlotIndex(slotIndex);
    this.state.slots[slotIndex] = {
      slotIndex,
      difficultyLevel: 0,
      state: 'empty',
      skillIds: [],
    };
    if (this.state.currentSlotIndex === slotIndex) {
      this.state.currentSlotIndex = null;
      this.state.run = null;
    }
  }

  // ====================================================================
  // Start phase — for now skip the skill-box prompt (handled by UI calling
  // purchaseSkillBox before enterDungeon). We just go straight to dungeon.
  // ====================================================================

  // ====================================================================
  // Departure deck drafting (rest hub → start phase)
  // ====================================================================

  /**
   * Returns the slot's draft-in-progress: cards withdrawn from inventory
   * staged for the next departure.
   */
  getDraftedDeck(): ReadonlyArray<CardInstance> {
    const slot = this.requireCurrentSlot();
    return slot.draftedDeck ?? [];
  }

  /**
   * Move a card from inventory → draftedDeck. Returns false when the
   * draft cap is already at maxDraft or the card isn't in inventory.
   */
  draftCardFromInventory(
    cardInstanceId: CardInstanceId,
    maxDraft: number = DEFAULT_DRAFT_CAPACITY,
  ): boolean {
    const slot = this.requireCurrentSlot();
    slot.draftedDeck ??= [];
    if (slot.draftedDeck.length >= maxDraft) return false;
    const idx = this.state.global.inventory.cards.findIndex(c => c.instanceId === cardInstanceId);
    if (idx < 0) return false;
    const card = this.state.global.inventory.cards.splice(idx, 1)[0]!;
    slot.draftedDeck.push(card);
    return true;
  }

  /**
   * Move a card from draftedDeck → inventory. Returns false when the
   * card isn't in the draft.
   */
  undraftCard(cardInstanceId: CardInstanceId): boolean {
    const slot = this.requireCurrentSlot();
    if (!slot.draftedDeck) return false;
    const idx = slot.draftedDeck.findIndex(c => c.instanceId === cardInstanceId);
    if (idx < 0) return false;
    if (this.state.global.inventory.cards.length >= this.state.global.inventory.capacity) {
      // No room to return → leave in draft (or could force back somehow)
      return false;
    }
    const card = slot.draftedDeck.splice(idx, 1)[0]!;
    this.state.global.inventory.cards.push(card);
    return true;
  }

  /**
   * Generate a dungeon map and enter the first node.
   * Pre-condition: current slot is 'inStartPhase' or 'atRest' (after rest).
   *
   * Deck resolution priority:
   *   1. opts.deck if non-empty (explicit caller-provided deck)
   *   2. slot.draftedDeck (cards drafted during start phase)
   *   3. [] (empty — typically a new char before journey_start)
   */
  enterDungeon(opts: {
    /** Cards to start the run with. */
    deck: ReadonlyArray<CardInstance>;
    /** Optional override of map dimensions. */
    map?: { width?: number; height?: number; startKey?: string; restKey?: string };
    /** Override the start-node event. Defaults to STARTING_EVENT_ID if present. */
    startEventId?: EventId;
    /** When true, skips all map content seeding (events + enemy groups).
     *  Tests use this to install fully manual content. */
    skipContentSeed?: boolean;
  }): void {
    const slot = this.requireCurrentSlot();
    // 15×15 default: rest hub at center; start position = rest hub (player
    // begins at home and must return there). All adjacent edges connected
    // (edgeKeepRatio=1.0) — every cell is a node, no "missing" rooms.
    const width = opts.map?.width ?? 15;
    const height = opts.map?.height ?? 15;
    const centerKey = `${Math.floor(width / 2)},${Math.floor(height / 2)}`;
    const map = generateMap({
      width,
      height,
      startKey: opts.map?.startKey ?? centerKey,
      restKey: opts.map?.restKey ?? centerKey,
      edgeKeepRatio: 1.0,
      nodeDistribution: {
        combat_normal: 5,
        combat_elite: 1,
        shop: 1,
        treasure: 1,
        event_normal: 2,
        event_trigger: 1,
      },
      seed: `${slot.slotIndex}-${slot.difficultyLevel}-${this.rng.intBetween(0, 999999)}`,
    });

    // If this is the final difficulty, the rest node becomes a final boss
    if (isAtFinalDifficulty(this.difficultyTable, slot.difficultyLevel)) {
      const restNode = map.nodes[map.currentNodeKey === (opts.map?.restKey ?? '4,0') ? (opts.map?.restKey ?? '4,0') : (opts.map?.restKey ?? '4,0')];
      // Note: that lookup just returns the rest node key
      const r = map.nodes[opts.map?.restKey ?? '4,0'];
      if (r) {
        r.nodeType = 'combat_boss' as any;
      }
      void restNode;
    }

    // Resolve starting deck: opts.deck (if non-empty) → draftedDeck → []
    let startingDeck: CardInstance[];
    if (opts.deck.length > 0) {
      startingDeck = [...opts.deck];
    } else if (slot.draftedDeck && slot.draftedDeck.length > 0) {
      startingDeck = [...slot.draftedDeck];
      slot.draftedDeck = [];
    } else {
      startingDeck = [];
    }

    slot.state = 'inRun';
    this.state.run = {
      slotIndex: slot.slotIndex,
      deck: startingDeck,
      gold: 0,
      map,
      activity: { kind: 'inMap' },
    };

    // Seed events + enemy groups onto map nodes (unless caller opts out)
    if (!opts.skipContentSeed) {
      this.seedMapContent(opts.startEventId);
    }

    // Trigger first node event if it's an event node
    this.maybeTriggerCurrentNodeEvent();
  }

  /**
   * Post-process generated map to assign concrete eventIds and
   * enemyGroupIds. Uses registries' `.all()` for random pick.
   */
  private seedMapContent(startEventOverride?: EventId): void {
    const run = this.requireRun();
    const slot = this.requireCurrentSlot();
    const startNode = run.map.nodes[run.map.currentNodeKey]!;

    // Start node event:
    //   - If caller passed an explicit override, use it.
    //   - Otherwise default to journey_start ONLY on the character's first
    //     run (difficultyLevel === 0). Returning characters from rest just
    //     start in the empty start node.
    const isFirstRun = slot.difficultyLevel === 0;
    const starterId = startEventOverride
      ?? (isFirstRun && this.registries.events.has(STARTING_EVENT_ID) ? STARTING_EVENT_ID : null);
    if (starterId) {
      startNode.eventId = starterId;
      // Preserve 'rest' node type — the rest hub must stay a rest hub even
      // while it carries a one-shot starter event. Other types: take the
      // event's nodeType to make the icon match.
      if (startNode.nodeType !== 'rest') {
        const ev = this.registries.events.get(starterId);
        startNode.nodeType = ev.nodeType;
      }
    }

    // Assign content to other nodes
    const enemyGroups = this.registries.enemyGroups.all();
    // Random event pool excludes:
    //   - the starter event (already placed at the start node)
    //   - any oneShot event already cleared by this character
    //   - events flagged `startOnly` (e.g. 여정의 시작) — those only
    //     make sense at the start node, never as a random encounter.
    const events = this.registries.events.all().filter(e =>
      e.id !== starterId
        && !(e.oneShot && this.state.global.eventsCleared.has(e.id))
        && !e.startOnly
    );

    for (const node of Object.values(run.map.nodes)) {
      if (node === startNode) continue;
      if (node.nodeType === 'rest') continue;
      if (node.nodeType.startsWith('combat')) {
        if (!node.enemyGroupId && enemyGroups.length > 0) {
          node.enemyGroupId = this.rng.pick(enemyGroups).id;
        }
      } else if (node.nodeType.startsWith('event')) {
        if (!node.eventId && events.length > 0) {
          node.eventId = this.rng.pick(events).id;
        }
      } else if (node.nodeType === 'shop') {
        if (!node.eventId && this.registries.events.has(SHOP_EVENT_ID)) {
          node.eventId = SHOP_EVENT_ID;
        }
      } else if (node.nodeType === 'treasure') {
        if (!node.eventId && this.registries.events.has(TREASURE_EVENT_ID)) {
          node.eventId = TREASURE_EVENT_ID;
        }
      }
    }
  }

  // ====================================================================
  // Map navigation
  // ====================================================================

  getMovableNeighbors() {
    const run = this.requireRun();
    return getMovableNeighbors(run.map);
  }

  moveTo(nodeKey: string): MoveAttempt {
    const run = this.requireRun();
    if (run.activity.kind !== 'inMap') {
      throw new Error(`Cannot move while in ${run.activity.kind}`);
    }
    const attempt = moveTo(run.map, nodeKey);
    if (!attempt.ok) return attempt;

    const node = run.map.nodes[run.map.currentNodeKey]!;
    // Rest node → end run
    if (node.nodeType === 'rest') {
      this.completeRun();
      return attempt;
    }
    // Trigger event on first entry
    if (attempt.newlyEntered) {
      this.maybeTriggerCurrentNodeEvent();
    }
    this.ensureMapPlayable();
    return attempt;
  }

  /**
   * Called at every transition back to inMap. If the player is dead-ended,
   * auto-recovers (elitizes a previously-visited node + revives a path).
   * Also seeds an enemy group on the freshly elitized node.
   *
   * Idempotent — safe to call multiple times.
   */
  private ensureMapPlayable(): void {
    const run = this.state.run;
    if (!run || run.activity.kind !== 'inMap') return;
    if (!isDeadEnd(run.map)) return;
    const recovery = recoverDeadEnd(run.map, this.rng);
    if (recovery && recovery.elitizedNodeKey) {
      const elite = run.map.nodes[recovery.elitizedNodeKey];
      if (elite && !elite.enemyGroupId) {
        const groups = this.registries.enemyGroups.all();
        if (groups.length > 0) {
          elite.enemyGroupId = this.rng.pick(groups).id;
        }
      }
    }
  }

  checkDeadEnd(): boolean {
    const run = this.requireRun();
    if (run.activity.kind !== 'inMap') return false;
    return isDeadEnd(run.map);
  }

  /** Returns the elitized node key, or null if recovery wasn't needed. */
  recoverFromDeadEnd(): string | null {
    const run = this.requireRun();
    const r = recoverDeadEnd(run.map, this.rng);
    return r?.elitizedNodeKey ?? null;
  }

  // ====================================================================
  // Event/flow
  // ====================================================================

  flowStatus(): FlowStatus {
    const run = this.requireRun();
    if (run.activity.kind !== 'inEvent') {
      throw new Error('No active event flow');
    }
    return run.activity.runtime.getStatus();
  }

  flowAdvance(): FlowStatus {
    return this.runFlow(rt => rt.advance(this.buildFlowCtx()));
  }
  flowChoose(optionIndex: number): FlowStatus {
    return this.runFlow(rt => rt.choose(optionIndex, this.buildFlowCtx()));
  }
  flowPickCard(cardDefId: CardDefId): FlowStatus {
    return this.runFlow(rt => rt.pickCard(cardDefId, this.buildFlowCtx()));
  }
  flowSkipCardPick(): FlowStatus {
    return this.runFlow(rt => rt.skipCardPick(this.buildFlowCtx()));
  }
  flowPickSkill(skillId: SkillId): FlowStatus {
    return this.runFlow(rt => rt.pickSkill(skillId, this.buildFlowCtx()));
  }
  flowSkipSkillPick(): FlowStatus {
    return this.runFlow(rt => rt.skipSkillPick(this.buildFlowCtx()));
  }
  flowPickCardToUpgrade(cardInstanceId: CardInstanceId): FlowStatus {
    return this.runFlow(rt => rt.pickCardToUpgrade(cardInstanceId, this.buildFlowCtx()));
  }
  flowSkipCardUpgrade(): FlowStatus {
    return this.runFlow(rt => rt.skipCardUpgrade(this.buildFlowCtx()));
  }
  flowPickModifier(modifierId: import('../../types/index.js').ModifierId): FlowStatus {
    return this.runFlow(rt => rt.pickModifier(modifierId, this.buildFlowCtx()));
  }
  flowPickCardForModifierAttach(cardInstanceId: CardInstanceId): FlowStatus {
    return this.runFlow(rt => rt.pickCardForModifierAttach(cardInstanceId, this.buildFlowCtx()));
  }

  // ====================================================================
  // Combat
  // ====================================================================

  combatPlayCard(
    cardInstanceId: CardInstanceId,
    targetEnemyId?: string,
  ): PlayCardOutcome {
    const run = this.requireRun();
    if (run.activity.kind !== 'inCombat') {
      throw new Error('Not in combat');
    }
    const target = targetEnemyId
      ? run.activity.enemies.find(e => e.instanceId === targetEnemyId)
      : undefined;
    const ctx = this.buildExecutionContextForCombat();
    const outcome = playCard(
      cardInstanceId,
      ctx,
      this.registries.cards,
      this.registries.modifiers,
      target ? { target } : undefined,
    );

    // skill_sacrifice — re-execute the resolved effects once more
    // (don't re-spend energy, don't re-move card from hand; that already
    //  happened in playCard). Only run if combat is still in progress.
    const slot = this.requireCurrentSlot();
    if (
      outcome.kind === 'played'
      && slot.skillIds.includes('skill_sacrifice' as SkillId)
      && run.activity.kind === 'inCombat'
    ) {
      const reExecCtx = this.buildExecutionContextForCombat();
      reExecCtx.target = target;
      reExecCtx.source = slot.character!;
      executeEffects(outcome.resolved.effects, reExecCtx);
    }

    // End-of-combat check
    if (run.activity.kind === 'inCombat') {
      const tfCtx = this.buildTurnFlowContext();
      const combatStatus = isCombatOver(tfCtx);
      if (combatStatus !== 'inProgress') {
        if (this.autoResolveCombat) {
          this.resolveCombatEnd(combatStatus);
        } else {
          // Defer — UI will animate then call finalizeCombatEnd()
          run.activity.pendingResolve = { outcome: combatStatus };
        }
      }
    }
    return outcome;
  }

  /**
   * Called by the UI once death/win animations have played out. Triggers
   * the deferred resolveCombatEnd that combatPlayCard / combatEndTurn
   * staged via run.activity.pendingResolve.
   */
  finalizeCombatEnd(): void {
    const run = this.state.run;
    if (!run || run.activity.kind !== 'inCombat') return;
    const pending = run.activity.pendingResolve;
    if (!pending) return;
    run.activity.pendingResolve = undefined;
    this.resolveCombatEnd(pending.outcome);
  }

  combatCanPlayCard(cardInstanceId: CardInstanceId, targetEnemyId?: string) {
    const run = this.requireRun();
    if (run.activity.kind !== 'inCombat') return { ok: false as const, reason: 'not-in-combat' };
    const target = targetEnemyId
      ? run.activity.enemies.find(e => e.instanceId === targetEnemyId)
      : undefined;
    const ctx = this.buildExecutionContextForCombat();
    return canPlayCard(cardInstanceId, ctx, this.registries.cards, this.registries.modifiers, target ? { target } : undefined);
  }

  combatEndTurn(): CombatOutcome {
    const run = this.requireRun();
    if (run.activity.kind !== 'inCombat') {
      throw new Error('Not in combat');
    }
    const tfCtx = this.buildTurnFlowContext();
    endPlayerTurn(tfCtx);
    const outAfterEnd = isCombatOver(tfCtx);
    if (outAfterEnd !== 'inProgress') {
      if (this.autoResolveCombat) return this.resolveCombatEnd(outAfterEnd);
      if (run.activity.kind === 'inCombat') run.activity.pendingResolve = { outcome: outAfterEnd };
      return outAfterEnd;
    }

    // ----- Branching for enemy turn -----
    //
    // autoResolveCombat=true (engine tests):
    //   Run every enemy inline, then start next player turn — synchronous.
    //
    // autoResolveCombat=false (UI):
    //   Queue the enemy actions in pendingEnemyTurn. UI walks the queue
    //   via combatStepEnemyTurn() with Enter + animations between, then
    //   calls combatBeginNextPlayerTurn() to advance.
    if (!this.autoResolveCombat) {
      const steps = run.activity.enemies
        .filter(e => e.hp > 0)
        .map(e => ({
          enemyInstanceId: e.instanceId,
          description: this.formatEnemyIntent(e),
        }));
      run.activity.pendingEnemyTurn = { steps, cursor: 0 };
      // No enemies alive somehow — finalize immediately so the UI can
      // resume picking phase.
      if (steps.length === 0) this.beginNextPlayerTurnInternal();
      return 'inProgress';
    }

    // Enemy turn — re-derive intent scripts from enemy defs each call
    const intentScripts = this.buildIntentScripts(run.activity.enemies);
    runEnemyTurn(tfCtx, intentScripts);
    const outAfterEnemy = isCombatOver(tfCtx);
    if (outAfterEnemy !== 'inProgress') {
      if (this.autoResolveCombat) return this.resolveCombatEnd(outAfterEnemy);
      if (run.activity.kind === 'inCombat') run.activity.pendingResolve = { outcome: outAfterEnemy };
      return outAfterEnemy;
    }

    // Back to player turn — sacrifice skill reduces draw count by 1
    run.activity.turn++;
    const slot = this.requireCurrentSlot();
    const hasSacrifice = slot.skillIds.includes('skill_sacrifice' as SkillId);
    const drawCount = Math.max(0, this.constants.draw.perTurn - (hasSacrifice ? 1 : 0));
    startPlayerTurn(tfCtx, drawCount);
    return 'inProgress';
  }

  // --------------------------------------------------------------------
  // Stepped enemy turn (UI mode)
  // --------------------------------------------------------------------

  /**
   * Execute the next pending enemy action. Returns a descriptor for the
   * UI's bottom-line announcement, plus the combat outcome after this
   * step. The UI is responsible for playing animations between calls.
   *
   * Returns description=null when there's no pending step (queue empty
   * or cursor past end — the UI should call combatBeginNextPlayerTurn
   * in that case).
   */
  combatStepEnemyTurn(): { description: string | null; outcome: CombatOutcome } {
    const run = this.requireRun();
    if (run.activity.kind !== 'inCombat') throw new Error('Not in combat');
    const pending = run.activity.pendingEnemyTurn;
    if (!pending) return { description: null, outcome: 'inProgress' };
    const step = pending.steps[pending.cursor];
    if (!step) return { description: null, outcome: 'inProgress' };

    const enemy = run.activity.enemies.find(e => e.instanceId === step.enemyInstanceId);
    if (enemy) {
      const tfCtx = this.buildTurnFlowContext();
      const intentScripts = this.buildIntentScripts(run.activity.enemies);
      runOneEnemyStep(enemy, intentScripts, tfCtx);
    }
    pending.cursor++;

    const tfCtx = this.buildTurnFlowContext();
    const outcome = isCombatOver(tfCtx);
    if (outcome !== 'inProgress') {
      // Combat ended — drop the queue and stage pendingResolve for the
      // UI's death-fade flow.
      run.activity.pendingEnemyTurn = undefined;
      if (this.autoResolveCombat) {
        return { description: step.description, outcome: this.resolveCombatEnd(outcome) };
      }
      run.activity.pendingResolve = { outcome };
      return { description: step.description, outcome };
    }

    return { description: step.description, outcome: 'inProgress' };
  }

  /**
   * After the UI has shown every queued enemy step, advance the turn
   * and start the next player turn (draw new hand, etc.). Clears
   * pendingEnemyTurn.
   */
  combatBeginNextPlayerTurn(): void {
    const run = this.requireRun();
    if (run.activity.kind !== 'inCombat') return;
    if (!run.activity.pendingEnemyTurn) return;
    this.beginNextPlayerTurnInternal();
  }

  private beginNextPlayerTurnInternal(): void {
    const run = this.requireRun();
    if (run.activity.kind !== 'inCombat') return;
    run.activity.pendingEnemyTurn = undefined;
    run.activity.turn++;
    const tfCtx = this.buildTurnFlowContext();
    const slot = this.requireCurrentSlot();
    const hasSacrifice = slot.skillIds.includes('skill_sacrifice' as SkillId);
    const drawCount = Math.max(0, this.constants.draw.perTurn - (hasSacrifice ? 1 : 0));
    startPlayerTurn(tfCtx, drawCount);
  }

  // --------------------------------------------------------------------
  // Discover (전투 중 카드 선택)
  // --------------------------------------------------------------------

  /**
   * 발견 (Discover) 선택 처리. `pendingDiscover.choices`에서 cardDefId를
   * 골라 손에 임시 카드(temporary=true)로 추가. cardDefId === null 이면
   * 건너뛰기 (canSkip이 true일 때만 의미 있음). pendingDiscover 클리어.
   *
   * 핸드 한도(hand.hardLimit) 초과 시 추가 자체가 무시될 수 있음 —
   * addCardToPile의 정책과 동일.
   */
  combatPickDiscover(cardDefId: CardDefId | null): void {
    const run = this.requireRun();
    if (run.activity.kind !== 'inCombat') return;
    const pending = run.activity.pendingDiscover;
    if (!pending) return;
    if (cardDefId !== null) {
      // 안전 검증: 후보에 있는 카드인지
      if (!pending.choices.includes(cardDefId)) {
        run.activity.pendingDiscover = undefined;
        throw new Error(`discover pick ${cardDefId} not in choices`);
      }
      const ctx = this.buildExecutionContextForCombat();
      executeEffects(
        [{ kind: 'addCardToPile', cardDefId, pile: 'hand' }],
        ctx,
      );
    }
    run.activity.pendingDiscover = undefined;
  }

  /** Format an enemy's current intent as a short line for the UI. */
  private formatEnemyIntent(enemy: EnemyActor): string {
    const name = this.registries.enemies.has(enemy.defId)
      ? this.registries.enemies.get(enemy.defId).name
      : '적';
    const intent = enemy.intent;
    if (!intent) return `${name}: 행동 없음`;
    const v = intent.display.value;
    switch (intent.display.kind) {
      case 'attack': return `${name}이(가) ${v ?? '?'} 피해로 공격`;
      case 'defend': return `${name}이(가) 방어도 ${v ?? '?'} 획득`;
      case 'buff':   return `${name}이(가) 자신을 강화`;
      case 'debuff': return `${name}이(가) 약화 부여 시도`;
      case 'unknown': return `${name}이(가) ???`;
      default:       return `${name}이(가) 행동`;
    }
  }

  // ====================================================================
  // Run / rest lifecycle
  // ====================================================================

  /**
   * Called when player reaches the rest node (or via designer-triggered
   * end of run). Collects pile cards back to the deck.
   */
  completeRun(): void {
    const slot = this.requireCurrentSlot();
    const run = this.requireRun();
    // If in combat, collapse piles into deck first
    if (run.activity.kind === 'inCombat') {
      run.deck = this.collectAllPilesToDeck(run.deck, run.activity.piles);
    }
    // Convert run gold → meta gold
    this.state.global.gold += run.gold;
    slot.difficultyLevel++;
    slot.state = 'atRest';
    // Stash deck on slot for rest-hub UI to display + manage
    (slot as any).pendingDeck = run.deck;
    this.state.run = null;
  }

  /**
   * Rest hub action: bulk-convert all undeposited cards to gold.
   * Caller decides whether to first transfer some to inventory.
   */
  restAutoSellPendingDeck(): { totalGold: number } {
    const slot = this.requireCurrentSlot();
    const pending = (slot as any).pendingDeck as CardInstance[] | undefined;
    if (!pending || pending.length === 0) return { totalGold: 0 };
    const r = bulkSellCards(this.state.global, pending, this.registries.cards);
    (slot as any).pendingDeck = [];
    return { totalGold: r.totalGold };
  }

  getRestHubPendingDeck(): ReadonlyArray<CardInstance> {
    const slot = this.requireCurrentSlot();
    return (slot as any).pendingDeck ?? [];
  }

  /**
   * Move a specific card from pending-deck into shared inventory.
   * Returns true on success, false if inventory full.
   */
  restStoreCard(cardInstanceId: CardInstanceId): boolean {
    const slot = this.requireCurrentSlot();
    const pending = (slot as any).pendingDeck as CardInstance[] | undefined;
    if (!pending) return false;
    const idx = pending.findIndex(c => c.instanceId === cardInstanceId);
    if (idx < 0) return false;
    if (this.state.global.inventory.cards.length >= this.state.global.inventory.capacity) {
      return false;
    }
    const card = pending.splice(idx, 1)[0]!;
    this.state.global.inventory.cards.push(card);
    return true;
  }

  /**
   * Sell a specific pending-deck card (or inventory card) for gold.
   */
  restSellCard(cardInstanceId: CardInstanceId, from: 'pendingDeck' | 'inventory'): number {
    if (from === 'pendingDeck') {
      const slot = this.requireCurrentSlot();
      const pending = (slot as any).pendingDeck as CardInstance[] | undefined;
      if (!pending) return 0;
      const idx = pending.findIndex(c => c.instanceId === cardInstanceId);
      if (idx < 0) return 0;
      const card = pending[idx]!;
      const r = bulkSellCards(this.state.global, [card], this.registries.cards);
      pending.splice(idx, 1);
      return r.totalGold;
    } else {
      const idx = this.state.global.inventory.cards.findIndex(c => c.instanceId === cardInstanceId);
      if (idx < 0) return 0;
      const card = this.state.global.inventory.cards[idx]!;
      const r = bulkSellCards(this.state.global, [card], this.registries.cards);
      this.state.global.inventory.cards.splice(idx, 1);
      return r.totalGold;
    }
  }

  // ====================================================================
  // Internals
  // ====================================================================

  private maybeTriggerCurrentNodeEvent(): void {
    const run = this.requireRun();
    const node = run.map.nodes[run.map.currentNodeKey]!;
    // Combat node → start combat with the node's enemy group (need eventId or enemyGroupId)
    if (node.nodeType.startsWith('combat_')) {
      const groupId = node.enemyGroupId ?? this.defaultEnemyGroupForNodeType(node.nodeType);
      if (groupId) this.beginCombatWithGroup(groupId);
      return;
    }
    if (node.eventId && this.registries.events.has(node.eventId)) {
      this.beginEvent(node.eventId);
    }
    // shop/treasure/rest — left to UI for now
  }

  private defaultEnemyGroupForNodeType(_type: string): EnemyGroupId | null {
    // Test/integration shim — real impl picks from data pool
    return null;
  }

  private beginEvent(eventId: EventId): void {
    const run = this.requireRun();
    const event = this.registries.events.get(eventId);
    const flow = this.registries.flows.get(event.flowId);
    const runtime = new FlowRuntime();
    run.activity = { kind: 'inEvent', eventId, runtime };
    runtime.start(event, flow, this.buildFlowCtx());

    // If flow finished immediately (no input needed), close it
    if (runtime.getStatus().kind === 'finished') {
      this.finishEvent(eventId);
    }
  }

  private finishEvent(eventId: EventId): void {
    const run = this.requireRun();
    const event = this.registries.events.get(eventId);
    if (event.oneShot) {
      this.state.global.eventsCleared.add(eventId);
    }
    run.activity = { kind: 'inMap' };
    this.ensureMapPlayable();
  }

  beginCombatWithGroup(groupId: EnemyGroupId): void {
    const run = this.requireRun();
    const slot = this.requireCurrentSlot();
    const group = this.registries.enemyGroups.get(groupId);

    // Materialize enemies
    const enemies: EnemyActor[] = group.members.map(eId => {
      const def = this.registries.enemies.get(eId);
      const hp = this.rng.intBetween(def.hpRange[0], def.hpRange[1]);
      const enemy: EnemyActor = {
        kind: 'enemy',
        instanceId: randomUUID(),
        defId: eId,
        hp,
        maxHp: hp,
        block: 0,
        statuses: [],
        intentCursor: 0,
      };
      enemy.intent = decideNextIntent(enemy, def.intentScript, this.rng);
      return enemy;
    });

    // Apply difficulty buffs
    applyDifficultyBuffsToEnemies(enemies, slot.difficultyLevel, this.difficultyTable, this.registries.statuses);

    // Build piles + draw opening hand (skill_sacrifice reduces draw by 1)
    const piles: PlayerCombatState = { hand: [], drawPile: [], discardPile: [], exhaustPile: [] };
    initFromDeck(piles, run.deck, this.rng);
    const hasSacrifice = slot.skillIds.includes('skill_sacrifice' as SkillId);
    const openingDraw = Math.max(0,
      this.constants.draw.perTurn + this.constants.draw.firstTurnAdditional - (hasSacrifice ? 1 : 0),
    );
    draw(piles, openingDraw, this.rng, this.constants.hand.hardLimit);

    // Reset player combat state
    slot.character!.energy = this.constants.energy.base;
    slot.character!.block = 0;
    // Note: statuses persist across combats? Slay-the-Spire clears them.
    // For now, clear at combat start.
    slot.character!.statuses = [];

    const previousFlow =
      run.activity.kind === 'inEvent'
        ? { runtime: run.activity.runtime, eventId: run.activity.eventId }
        : undefined;

    run.activity = {
      kind: 'inCombat',
      enemies,
      piles,
      turn: 1,
      resumingFlow: previousFlow,
    };

    // Fire onCombatStart skill hooks (e.g., 힘증가 grants strength stacks
    // to the player for this combat only — clears at next combat start).
    this.fireSkillHooksAtCombatBoundary('onCombatStart');
  }

  /**
   * Collect + execute all skill hooks (character + global passives) that
   * respond to `event`. Each hook runs with the player as source.
   */
  private fireSkillHooksAtCombatBoundary(event: 'onCombatStart' | 'onCombatEnd' | 'onTurnStart' | 'onTurnEnd'): void {
    const slot = this.requireCurrentSlot();
    const hooks = collectSkillHooks(
      slot.skillIds,
      this.state.global.passiveSkills,
      event,
      this.registries.skills,
    );
    if (hooks.length === 0) return;
    const ctx = this.buildExecutionContextForCombat();
    for (const h of hooks) {
      const def = this.registries.skills.get(h.skillId);
      const hook = def.hooks[h.hookIndex]!;
      executeEffects(hook.effects, ctx);
    }
  }

  private resolveCombatEnd(outcome: CombatOutcome): CombatOutcome {
    const run = this.requireRun();
    const slot = this.requireCurrentSlot();
    if (run.activity.kind !== 'inCombat') return outcome;

    // Snapshot before piles get reset
    const enemies = run.activity.enemies;
    const resumingFlow = run.activity.resumingFlow;

    // Collect piles back to run deck
    run.deck = this.collectAllPilesToDeck(run.deck, run.activity.piles);

    if (outcome === 'lost') {
      // Switch to game-over screen so UI can show the death summary.
      // The actual slot wipe happens when the UI acknowledges via
      // acknowledgeGameOver().
      run.activity = {
        kind: 'gameOver',
        reason: 'died-in-combat',
        runStatsSnapshot: {
          difficultyReached: slot.difficultyLevel,
          nodesVisited: run.map.visitedNodeKeys.size,
          cardsCarried: run.deck.length,
        },
      };
      return outcome;
    }

    // Final boss check — if the current node is the boss AND we're at
    // max difficulty, route to the passive-promote screen instead of
    // the standard reward.
    const currentNode = run.map.nodes[run.map.currentNodeKey]!;
    const isFinalBossKill =
      currentNode.nodeType === ('combat_boss' as typeof currentNode.nodeType) &&
      isAtFinalDifficulty(this.difficultyTable, slot.difficultyLevel);

    if (isFinalBossKill) {
      this.state.global.difficultyMaxReached = Math.max(
        this.state.global.difficultyMaxReached,
        slot.difficultyLevel + 1,
      );
      const candidates = this.eligiblePassiveCandidates(slot.skillIds);
      if (candidates.length === 0) {
        // No eligible skill → fallback gold
        this.state.global.gold += FINAL_BOSS_FALLBACK_GOLD;
        run.activity = {
          kind: 'passivePromote',
          candidates: [],
          fallbackGold: FINAL_BOSS_FALLBACK_GOLD,
        };
      } else {
        run.activity = { kind: 'passivePromote', candidates };
      }
      return outcome;
    }

    // Standard victory — calculate gold reward and stage card-pick state.
    let goldEarned = 0;
    for (const enemy of enemies) {
      const def = this.registries.enemies.get(enemy.defId);
      if (def.rewards?.goldRange) {
        goldEarned += this.rng.intBetween(def.rewards.goldRange[0], def.rewards.goldRange[1]);
      }
    }
    run.gold += goldEarned;

    // Sample card choices from the post-combat reward pool
    let choices: ReadonlyArray<CardDefId> = [];
    if (this.registries.cardPools.has(POST_COMBAT_REWARD_POOL_ID)) {
      const pool = this.registries.cardPools.get(POST_COMBAT_REWARD_POOL_ID)!;
      choices = sampleCardsFromPool(pool, POST_COMBAT_REWARD_COUNT, this.rng);
    }

    run.activity = {
      kind: 'rewardPick',
      choices,
      goldEarned,
      resumingFlow,
    };

    return outcome;
  }

  /**
   * Resolve passive promotion. Pass a skillId from the candidates array
   * (or null to take the fallback / no-op). Either way, the character
   * retires — slot is wiped and the player returns to title.
   */
  choosePassivePromote(skillId: SkillId | null): void {
    const run = this.requireRun();
    if (run.activity.kind !== 'passivePromote') {
      throw new Error('choosePassivePromote called outside passivePromote');
    }
    if (skillId !== null) {
      if (!run.activity.candidates.includes(skillId)) {
        throw new Error(`Skill ${skillId} not in passive candidates`);
      }
      this.state.global.passiveSkills.push(skillId);
    }
    // Character retires after the final boss — wipe slot, return to title.
    const slot = this.requireCurrentSlot();
    this.deleteSlot(slot.slotIndex);
  }

  /** Helper: filter character skills down to those that can be promoted. */
  private eligiblePassiveCandidates(characterSkillIds: ReadonlyArray<SkillId>): SkillId[] {
    const out: SkillId[] = [];
    for (const sid of characterSkillIds) {
      if (this.state.global.passiveSkills.includes(sid)) continue;
      if (!this.registries.skills.has(sid)) continue;
      const def = this.registries.skills.get(sid);
      if (!def.passiveEligible) continue;
      out.push(sid);
    }
    return out;
  }

  // ====================================================================
  // Reward pick (post-combat)
  // ====================================================================

  /**
   * Take a chosen reward card (or null for skip), then resume to map
   * or to the paused flow.
   */
  rewardPickCard(cardDefId: CardDefId | null): void {
    const run = this.requireRun();
    if (run.activity.kind !== 'rewardPick') {
      throw new Error('rewardPickCard called outside rewardPick activity');
    }
    if (cardDefId !== null) {
      if (!run.activity.choices.includes(cardDefId)) {
        throw new Error(`Card ${cardDefId} not in reward choices`);
      }
      const card: CardInstance = {
        instanceId: randomUUID() as CardInstanceId,
        defId: cardDefId,
        modifiers: [],
        acquired: { kind: 'reward', runId: String(run.slotIndex) },
      };
      run.deck.push(card);
    }
    this.finishReward();
  }

  rewardSkip(): void {
    const run = this.requireRun();
    if (run.activity.kind !== 'rewardPick') {
      throw new Error('rewardSkip called outside rewardPick activity');
    }
    this.finishReward();
  }

  private finishReward(): void {
    const run = this.requireRun();
    if (run.activity.kind !== 'rewardPick') return;
    const resumingFlow = run.activity.resumingFlow;
    run.activity = { kind: 'inMap' };
    if (resumingFlow) {
      const status = resumingFlow.runtime.combatResolved('won', this.buildFlowCtx());
      run.activity = { kind: 'inEvent', eventId: resumingFlow.eventId, runtime: resumingFlow.runtime };
      if (status.kind === 'finished') {
        this.finishEvent(resumingFlow.eventId);
      }
    }
    this.ensureMapPlayable();
  }

  // ====================================================================
  // Game over acknowledgement
  // ====================================================================

  /**
   * Player saw the death summary — now actually wipe the slot.
   * Global state (gold/inventory/passives) is preserved.
   */
  acknowledgeGameOver(): void {
    const slot = this.requireCurrentSlot();
    this.deleteSlot(slot.slotIndex);
  }

  private collectAllPilesToDeck(deck: CardInstance[], piles: PlayerCombatState): CardInstance[] {
    const result: CardInstance[] = [];
    const seen = new Set<CardInstanceId>();
    // 전투 종료 시 임시 카드(temporary)는 자동 폐기. 발견/자기복제/단검마술
    // 같이 전투 중 즉석 생성된 카드들은 다음 전투/덱으로 가져가지 않는다.
    for (const c of [...piles.hand, ...piles.drawPile, ...piles.discardPile, ...piles.exhaustPile]) {
      if (c.temporary) continue;
      if (seen.has(c.instanceId)) continue;
      seen.add(c.instanceId);
      result.push(c);
    }
    // Also include any deck cards that somehow weren't in piles (defensive)
    for (const c of deck) {
      if (c.temporary) continue;
      if (!seen.has(c.instanceId)) {
        seen.add(c.instanceId);
        result.push(c);
      }
    }
    return result;
  }

  // ---------- context builders ----------

  private buildFlowCtx(): FlowRuntimeContext {
    const slot = this.requireCurrentSlot();
    const run = this.requireRun();
    const condition: ConditionContext = {
      run: {
        difficultyLevel: slot.difficultyLevel,
        player: {
          hp: slot.character!.hp,
          maxHp: slot.character!.maxHp,
          gold: run.gold,
          deck: run.deck,
          skillIds: slot.skillIds,
        },
      },
      global: {
        gold: this.state.global.gold,
        inventory: { cards: this.state.global.inventory.cards },
        passiveSkills: this.state.global.passiveSkills,
        eventsCleared: this.state.global.eventsCleared,
      },
      rng: this.rng,
      cards: this.registries.cards,
    };
    const execution: ExecutionContext = {
      source: slot.character,
      enemies: [],
      player: slot.character!,
      piles: { hand: [], drawPile: [], discardPile: [], exhaustPile: [] },
      statuses: this.registries.statuses,
      rng: this.rng,
      constants: this.constants,
      run: run,
    };
    const host = new FlowHostImpl({
      cards: this.registries.cards,
      cardPools: this.registries.cardPools,
      modifiers: this.registries.modifiers,
      modifierPools: this.registries.modifierPools,
      skillBoxes: this.registries.skillBoxes,
      runDeck: { cards: run.deck },
      meta: this.state.global,
      character: { skillIds: slot.skillIds, difficultyLevel: slot.difficultyLevel },
      rng: this.rng,
      onBeginCombat: (egId) => { this.beginCombatWithGroup(egId); },
    });
    return { condition, execution, rng: this.rng, host };
  }

  private buildExecutionContextForCombat(): ExecutionContext {
    const slot = this.requireCurrentSlot();
    const run = this.requireRun();
    if (run.activity.kind !== 'inCombat') throw new Error('not in combat');
    return {
      source: slot.character,
      enemies: run.activity.enemies,
      player: slot.character!,
      piles: run.activity.piles,
      statuses: this.registries.statuses,
      rng: this.rng,
      constants: this.constants,
      // Point at the run's actual gold holder so loseGold/gainGold mutate it.
      run: run,
      customHandlers: this.customHandlers,
      cards: this.registries.cards,
    };
  }

  private buildTurnFlowContext(): TurnFlowContext {
    const slot = this.requireCurrentSlot();
    const run = this.requireRun();
    if (run.activity.kind !== 'inCombat') throw new Error('not in combat');
    return {
      player: slot.character!,
      enemies: run.activity.enemies,
      piles: run.activity.piles,
      statuses: this.registries.statuses,
      rng: this.rng,
      constants: this.constants,
      run: run,
      customHandlers: this.customHandlers,
      cards: this.registries.cards,
    };
  }

  private buildIntentScripts(enemies: EnemyActor[]) {
    const m = new Map<string, import('../../types/index.js').IntentScript>();
    for (const e of enemies) {
      const def = this.registries.enemies.get(e.defId);
      m.set(e.instanceId, def.intentScript);
    }
    return m;
  }

  private runFlow(action: (rt: FlowRuntime) => FlowStatus): FlowStatus {
    const run = this.requireRun();
    if (run.activity.kind !== 'inEvent') {
      throw new Error('No active event flow');
    }
    const status = action(run.activity.runtime);
    if (status.kind === 'finished') {
      this.finishEvent(run.activity.eventId);
    }
    return status;
  }

  private requireSlotIndex(i: number): void {
    if (i < 0 || i >= this.state.slots.length) {
      throw new RangeError(`Slot index out of range: ${i}`);
    }
  }
  private requireCurrentSlot(): SlotData {
    if (this.state.currentSlotIndex === null) {
      throw new Error('No current slot selected');
    }
    return this.state.slots[this.state.currentSlotIndex]!;
  }
  private requireRun(): RunSessionState {
    if (!this.state.run) {
      throw new Error('No active run');
    }
    return this.state.run;
  }

  // ====================================================================
  // Read-only inspectors (for UI)
  // ====================================================================

  /** Unused right now but kept so the condition-eval `random` path works. */
  evalCondition(c: import('../../types/index.js').ConditionExpr): boolean {
    return evalCondition(c, this.buildFlowCtx().condition);
  }
}
