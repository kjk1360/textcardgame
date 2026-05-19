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
import type { ExecutionContext } from '../effects/executor.js';

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
}

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
    };

// ====================================================================
// Construction
// ====================================================================

export interface GameOptions {
  registries: GameRegistries;
  rngSeed?: string;
  constants?: GameConstants;
  difficulty?: DifficultyTable;
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
  state: SessionState;

  constructor(opts: GameOptions) {
    this.registries = opts.registries;
    this.constants = opts.constants ?? DEFAULT_CONSTANTS;
    this.difficultyTable = opts.difficulty ?? makeDefaultDifficultyTable();
    this.rng = makeRng(opts.rngSeed ?? `game-${Date.now()}`);
    this.state = createInitialState();
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

  /**
   * Generate a dungeon map and enter the first node.
   * Pre-condition: current slot is 'inStartPhase' or 'atRest' (after rest).
   * Starting deck must be provided by caller (came from prior session or
   * "여정의 시작" event before this call).
   */
  enterDungeon(opts: {
    /** Cards to start the run with. */
    deck: ReadonlyArray<CardInstance>;
    /** Optional override of map dimensions. */
    map?: { width?: number; height?: number; startKey?: string; restKey?: string };
  }): void {
    const slot = this.requireCurrentSlot();
    const map = generateMap({
      width: opts.map?.width ?? 5,
      height: opts.map?.height ?? 5,
      startKey: opts.map?.startKey ?? '0,4',
      restKey: opts.map?.restKey ?? '4,0',
      edgeKeepRatio: 0.8,
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

    slot.state = 'inRun';
    this.state.run = {
      slotIndex: slot.slotIndex,
      deck: [...opts.deck],
      map,
      activity: { kind: 'inMap' },
    };

    // Trigger first node event if it's an event node
    this.maybeTriggerCurrentNodeEvent();
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
    return attempt;
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
    return playCard(
      cardInstanceId,
      ctx,
      this.registries.cards,
      this.registries.modifiers,
      target ? { target } : undefined,
    );
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
      return this.resolveCombatEnd(outAfterEnd);
    }

    // Enemy turn — re-derive intent scripts from enemy defs each call
    const intentScripts = this.buildIntentScripts(run.activity.enemies);
    runEnemyTurn(tfCtx, intentScripts);
    const outAfterEnemy = isCombatOver(tfCtx);
    if (outAfterEnemy !== 'inProgress') {
      return this.resolveCombatEnd(outAfterEnemy);
    }

    // Back to player turn
    run.activity.turn++;
    startPlayerTurn(tfCtx);
    return 'inProgress';
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

    // Build piles + draw opening hand
    const piles: PlayerCombatState = { hand: [], drawPile: [], discardPile: [], exhaustPile: [] };
    initFromDeck(piles, run.deck, this.rng);
    draw(piles, this.constants.draw.perTurn + this.constants.draw.firstTurnAdditional, this.rng, this.constants.hand.hardLimit);

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
  }

  private resolveCombatEnd(outcome: CombatOutcome): CombatOutcome {
    const run = this.requireRun();
    const slot = this.requireCurrentSlot();
    if (run.activity.kind !== 'inCombat') return outcome;

    // Collect piles back to run deck
    run.deck = this.collectAllPilesToDeck(run.deck, run.activity.piles);

    if (outcome === 'lost') {
      // Character death — wipe slot, keep global
      this.deleteSlot(slot.slotIndex);
      return outcome;
    }

    // Won — give rewards (gold only for now; card reward needs Reward Screen integration)
    const resumingFlow = run.activity.resumingFlow;
    run.activity = { kind: 'inMap' };

    if (resumingFlow) {
      // Resume the flow that initiated combat
      const status = resumingFlow.runtime.combatResolved(
        outcome === 'won' ? 'won' : 'lost',
        this.buildFlowCtx(),
      );
      run.activity = { kind: 'inEvent', eventId: resumingFlow.eventId, runtime: resumingFlow.runtime };
      if (status.kind === 'finished') {
        this.finishEvent(resumingFlow.eventId);
      }
    }

    return outcome;
  }

  private collectAllPilesToDeck(deck: CardInstance[], piles: PlayerCombatState): CardInstance[] {
    const result: CardInstance[] = [];
    const seen = new Set<CardInstanceId>();
    for (const c of [...piles.hand, ...piles.drawPile, ...piles.discardPile, ...piles.exhaustPile]) {
      if (seen.has(c.instanceId)) continue;
      seen.add(c.instanceId);
      result.push(c);
    }
    // Also include any deck cards that somehow weren't in piles (defensive)
    for (const c of deck) {
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
          gold: 0, // run gold not yet tracked separately — TBD
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
      run: { gold: 0 },
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
      run: { gold: 0 }, // run gold TBD
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
      run: { gold: 0 },
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
