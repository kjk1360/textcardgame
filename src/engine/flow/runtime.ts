import type {
  CardDefId,
  CardInstance,
  CardInstanceId,
  ChoiceOption,
  EventDefinition,
  FlowDefinition,
  FlowStep,
  ModifierId,
  ProbabilisticBranch,
} from '../../types/index.js';
import {
  evalCondition,
  type ConditionContext,
} from '../conditions/evaluator.js';
import {
  executeEffects,
  type EffectResult,
  type ExecutionContext,
} from '../effects/executor.js';
import type { IRandom } from '../rng.js';
import type { FlowHost } from './host.js';

/**
 * Flow runtime — interprets a FlowDefinition's step graph.
 *
 * Doc: 04_event_flow_system.md §"FlowRuntime"
 *
 * State machine. Host calls `start()`, polls `getStatus()`, drives forward
 * via type-specific resolver methods.
 *
 * Step kinds & status mapping:
 *   dialogue            → awaitingDialogue       (advance)
 *   choice              → awaitingChoice         (choose)
 *   cardOffer           → awaitingCardPick       (pickCard / skipCardPick)
 *   skillOffer          → awaitingSkillPick      (pickSkill / skipSkillPick)
 *   cardUpgrade         → awaitingCardUpgradeTarget → awaitingModifierPick
 *                                                  (pickCardToUpgrade,
 *                                                   skipCardUpgrade,
 *                                                   pickModifier)
 *   cardModifierAttach  → either awaitingCardUpgradeTarget ('choose')
 *                          or auto-applies for 'allInDeck' / 'allWithTag'
 *   applyEffect         → auto
 *   branch              → auto
 *   combatStart         → inCombat              (combatResolved)
 *   goto                → auto
 *   end                 → finished
 *
 * cardOffer / skillOffer / cardUpgrade / cardModifierAttach / combatStart
 * all require `ctx.host` to be supplied. They throw a clear error if not.
 */

export interface FlowRuntimeContext {
  readonly condition: ConditionContext;
  readonly execution: ExecutionContext;
  readonly rng: IRandom;
  /** Required for cardOffer / skillOffer / cardUpgrade / cardModifierAttach / combatStart. */
  readonly host?: FlowHost;
}

export type FlowStatus =
  | { kind: 'idle' }
  | { kind: 'awaitingDialogue'; stepId: string; speaker?: string; text: string }
  | { kind: 'awaitingChoice'; stepId: string; prompt?: string; options: ResolvedChoiceOption[] }
  | {
      kind: 'awaitingCardPick';
      stepId: string;
      iteration: number;             // 1-based current iteration
      totalIterations: number;
      choices: ReadonlyArray<CardDefId>;
      destination: 'currentDeck' | 'inventory';
      canSkip: boolean;
    }
  | {
      kind: 'awaitingSkillPick';
      stepId: string;
      choices: ReadonlyArray<import('../../types/index.js').SkillId>;
      canSkip: boolean;
    }
  | {
      kind: 'awaitingCardUpgradeTarget';
      stepId: string;
      iteration: number;
      totalIterations: number;
      candidates: ReadonlyArray<CardInstance>;
      source: 'currentDeck' | 'inventory';
      forcedModifierId?: ModifierId;  // when set, no awaitingModifierPick after
      canSkip: boolean;
    }
  | {
      kind: 'awaitingModifierPick';
      stepId: string;
      cardInstance: CardInstance;
      choices: ReadonlyArray<ModifierId>;
    }
  | {
      kind: 'inCombat';
      stepId: string;
      enemyGroupId: import('../../types/index.js').EnemyGroupId;
    }
  | { kind: 'finished'; outcome: 'success' | 'failure' | 'neutral' };

export interface ResolvedChoiceOption {
  readonly index: number;
  readonly label: string;
  readonly enabled: boolean;
  readonly disabledReason?: string;
}

// ====================================================================
// Internal pending-state tracking
// ====================================================================

type PendingStepState =
  | {
      kind: 'cardOffer';
      iteration: number;          // 0-based
      totalIterations: number;
      choices: CardDefId[];
      destination: 'currentDeck' | 'inventory';
      canSkip: boolean;
    }
  | {
      kind: 'cardUpgrade';
      iteration: number;          // 0-based
      totalIterations: number;
      candidates: CardInstance[];
      source: 'currentDeck' | 'inventory';
      canSkip: boolean;
      pendingTarget?: CardInstance;          // chosen card, awaiting modifier
      modifierChoices?: ModifierId[];
    }
  | {
      kind: 'cardModifierAttachChoose';
      candidates: CardInstance[];
      forcedModifierId: ModifierId;
    }
  | {
      kind: 'inCombat';
    };

interface InternalState {
  event: EventDefinition;
  flow: FlowDefinition;
  currentStepId: string;
  variables: Record<string, unknown>;
  history: string[];
  effectLog: EffectResult[];
  pending?: PendingStepState;
}

// ====================================================================
// Runtime class
// ====================================================================

export class FlowRuntime {
  private internal: InternalState | null = null;
  private cachedStatus: FlowStatus = { kind: 'idle' };

  start(event: EventDefinition, flow: FlowDefinition, ctx: FlowRuntimeContext): FlowStatus {
    this.internal = {
      event,
      flow,
      currentStepId: flow.entryStepId,
      variables: {},
      history: [],
      effectLog: [],
    };
    return this.executeUntilBlocked(ctx);
  }

  getStatus(): FlowStatus { return this.cachedStatus; }
  getEffectLog(): ReadonlyArray<EffectResult> { return this.internal?.effectLog ?? []; }
  getVariables(): Readonly<Record<string, unknown>> { return this.internal?.variables ?? {}; }

  // -------- dialogue --------
  advance(ctx: FlowRuntimeContext): FlowStatus {
    this.requireRunning();
    const step = this.currentStep();
    if (step.kind !== 'dialogue') {
      throw new Error(`advance() called but current step is '${step.kind}', expected 'dialogue'`);
    }
    this.goto(step.next);
    return this.executeUntilBlocked(ctx);
  }

  // -------- choice --------
  choose(optionIndex: number, ctx: FlowRuntimeContext): FlowStatus {
    this.requireRunning();
    const step = this.currentStep();
    if (step.kind !== 'choice') {
      throw new Error(`choose() called but current step is '${step.kind}', expected 'choice'`);
    }
    const resolved = this.resolveChoiceOptions(step.options, ctx);
    const opt = resolved.find(o => o.index === optionIndex);
    if (!opt) throw new Error(`Option index ${optionIndex} not in current choice`);
    if (!opt.enabled) throw new Error(`Option index ${optionIndex} is disabled`);
    const original = step.options[optionIndex]!;
    this.applyChoiceOption(original, ctx);
    return this.executeUntilBlocked(ctx);
  }

  // -------- cardOffer --------
  pickCard(cardDefId: CardDefId, ctx: FlowRuntimeContext): FlowStatus {
    this.requireRunning();
    const pending = this.requirePending('cardOffer');
    if (!pending.choices.includes(cardDefId)) {
      throw new Error(`pickCard: ${cardDefId} not in current offer`);
    }
    const host = this.requireHost(ctx, 'cardOffer.pickCard');
    const result = host.attachCardToDestination(cardDefId, pending.destination, {
      kind: 'event',
      contextId: this.internal!.event.id,
    });
    if (!result.ok) {
      throw new Error(`attachCardToDestination failed: ${result.reason}`);
    }
    return this.advanceCardOfferIteration(ctx);
  }

  skipCardPick(ctx: FlowRuntimeContext): FlowStatus {
    this.requireRunning();
    const pending = this.requirePending('cardOffer');
    if (!pending.canSkip) {
      throw new Error('Current cardOffer does not allow skip');
    }
    return this.advanceCardOfferIteration(ctx);
  }

  // -------- skillOffer --------
  pickSkill(
    skillId: import('../../types/index.js').SkillId,
    ctx: FlowRuntimeContext,
  ): FlowStatus {
    this.requireRunning();
    const status = this.cachedStatus;
    if (status.kind !== 'awaitingSkillPick') {
      throw new Error(`pickSkill called outside awaitingSkillPick`);
    }
    if (!status.choices.includes(skillId)) {
      throw new Error(`pickSkill: ${skillId} not in current offer`);
    }
    const host = this.requireHost(ctx, 'skillOffer.pickSkill');
    host.addSkillToCharacter(skillId, {
      kind: 'event',
      contextId: this.internal!.event.id,
    });
    return this.finishSkillOffer(ctx);
  }

  skipSkillPick(ctx: FlowRuntimeContext): FlowStatus {
    this.requireRunning();
    const status = this.cachedStatus;
    if (status.kind !== 'awaitingSkillPick') {
      throw new Error(`skipSkillPick called outside awaitingSkillPick`);
    }
    if (!status.canSkip) {
      throw new Error('Current skillOffer does not allow skip');
    }
    return this.finishSkillOffer(ctx);
  }

  // -------- cardUpgrade --------
  pickCardToUpgrade(cardInstanceId: CardInstanceId, ctx: FlowRuntimeContext): FlowStatus {
    this.requireRunning();
    const pending = this.requirePending('cardUpgrade');
    const card = pending.candidates.find(c => c.instanceId === cardInstanceId);
    if (!card) throw new Error(`pickCardToUpgrade: card ${cardInstanceId} not in candidates`);

    const step = this.currentStep();
    if (step.kind !== 'cardUpgrade') throw new Error('current step is not cardUpgrade');

    if (step.forceModifierId) {
      // Skip modifier picking — force-attach the configured modifier
      const host = this.requireHost(ctx, 'cardUpgrade.pickCardToUpgrade(forced)');
      host.attachModifierToCard(card.instanceId, step.forceModifierId, {
        kind: 'event',
        contextId: this.internal!.event.id,
      });
      return this.advanceCardUpgradeIteration(ctx);
    }

    // Sample modifier candidates
    const host = this.requireHost(ctx, 'cardUpgrade.pickCardToUpgrade');
    const choices = host.sampleModifierUpgrades(
      card,
      3, // default N candidates; could be data-driven later
      step.modifierPoolOverride ? {
        add: step.modifierPoolOverride.add,
        remove: step.modifierPoolOverride.remove,
      } : undefined,
    );

    pending.pendingTarget = card;
    pending.modifierChoices = choices;

    if (choices.length === 0) {
      // No valid modifiers for this card — auto-skip this iteration
      return this.advanceCardUpgradeIteration(ctx);
    }

    this.cachedStatus = {
      kind: 'awaitingModifierPick',
      stepId: this.internal!.currentStepId,
      cardInstance: card,
      choices,
    };
    return this.cachedStatus;
  }

  skipCardUpgrade(ctx: FlowRuntimeContext): FlowStatus {
    this.requireRunning();
    const pending = this.requirePending('cardUpgrade');
    if (!pending.canSkip) {
      throw new Error('Current cardUpgrade does not allow skip');
    }
    // Skip the entire step (all remaining iterations)
    return this.finishCardUpgrade(ctx);
  }

  pickModifier(modifierId: ModifierId, ctx: FlowRuntimeContext): FlowStatus {
    this.requireRunning();
    const pending = this.requirePending('cardUpgrade');
    if (!pending.pendingTarget || !pending.modifierChoices) {
      throw new Error('pickModifier called without an active modifier choice');
    }
    if (!pending.modifierChoices.includes(modifierId)) {
      throw new Error(`pickModifier: ${modifierId} not in current choices`);
    }
    const host = this.requireHost(ctx, 'cardUpgrade.pickModifier');
    host.attachModifierToCard(pending.pendingTarget.instanceId, modifierId, {
      kind: 'event',
      contextId: this.internal!.event.id,
    });
    pending.pendingTarget = undefined;
    pending.modifierChoices = undefined;
    return this.advanceCardUpgradeIteration(ctx);
  }

  // -------- cardModifierAttach (choose variant) --------
  pickCardForModifierAttach(cardInstanceId: CardInstanceId, ctx: FlowRuntimeContext): FlowStatus {
    this.requireRunning();
    const pending = this.requirePending('cardModifierAttachChoose');
    const card = pending.candidates.find(c => c.instanceId === cardInstanceId);
    if (!card) throw new Error(`pickCardForModifierAttach: card ${cardInstanceId} not in candidates`);
    const host = this.requireHost(ctx, 'cardModifierAttach.pickCard');
    host.attachModifierToCard(card.instanceId, pending.forcedModifierId, {
      kind: 'event',
      contextId: this.internal!.event.id,
    });
    const step = this.currentStep();
    if (step.kind !== 'cardModifierAttach') throw new Error('current step is not cardModifierAttach');
    this.internal!.pending = undefined;
    this.goto(step.next);
    return this.executeUntilBlocked(ctx);
  }

  // -------- combatStart --------
  combatResolved(outcome: 'won' | 'lost', ctx: FlowRuntimeContext): FlowStatus {
    this.requireRunning();
    const pending = this.requirePending('inCombat');
    void pending;
    const step = this.currentStep();
    if (step.kind !== 'combatStart') throw new Error('current step is not combatStart');
    this.internal!.pending = undefined;

    const nextId = outcome === 'won'
      ? step.afterVictoryNext
      : (step.afterDefeatNext ?? null);
    if (!nextId) {
      // Defeat with no defeat path = end with failure
      this.cachedStatus = { kind: 'finished', outcome: 'failure' };
      return this.cachedStatus;
    }
    this.goto(nextId);
    return this.executeUntilBlocked(ctx);
  }

  // ====================================================================
  // Step execution
  // ====================================================================

  private executeUntilBlocked(ctx: FlowRuntimeContext): FlowStatus {
    while (true) {
      const step = this.currentStep();
      switch (step.kind) {
        case 'dialogue':
          this.cachedStatus = {
            kind: 'awaitingDialogue',
            stepId: this.internal!.currentStepId,
            speaker: step.speaker,
            text: this.renderText(step.text, ctx),
          };
          return this.cachedStatus;

        case 'choice': {
          const resolved = this.resolveChoiceOptions(step.options, ctx);
          this.cachedStatus = {
            kind: 'awaitingChoice',
            stepId: this.internal!.currentStepId,
            prompt: step.prompt ? this.renderText(step.prompt, ctx) : undefined,
            options: resolved,
          };
          return this.cachedStatus;
        }

        case 'cardOffer': {
          this.beginCardOffer(ctx);
          return this.cachedStatus;
        }

        case 'skillOffer': {
          this.beginSkillOffer(ctx);
          return this.cachedStatus;
        }

        case 'cardUpgrade': {
          this.beginCardUpgrade(ctx);
          return this.cachedStatus;
        }

        case 'cardModifierAttach': {
          const status = this.runCardModifierAttach(ctx);
          if (status) return status;
          // Auto-advanced cases fall through
          break;
        }

        case 'combatStart': {
          this.beginCombat(ctx);
          return this.cachedStatus;
        }

        case 'applyEffect': {
          const results = executeEffects(step.effects, ctx.execution);
          this.internal!.effectLog.push(...results);
          this.goto(step.next);
          break;
        }

        case 'branch': {
          let nextId = step.defaultNext;
          for (const br of step.branches) {
            if (evalCondition(br.condition, ctx.condition)) {
              nextId = br.next;
              break;
            }
          }
          this.goto(nextId);
          break;
        }

        case 'goto':
          this.goto(step.stepId);
          break;

        case 'end':
          this.cachedStatus = { kind: 'finished', outcome: step.outcome ?? 'neutral' };
          return this.cachedStatus;
      }
    }
  }

  // ---------- cardOffer ----------

  private beginCardOffer(ctx: FlowRuntimeContext): void {
    const step = this.currentStep();
    if (step.kind !== 'cardOffer') throw new Error('not cardOffer');
    const host = this.requireHost(ctx, 'cardOffer');

    // Compute effective iterations. With fillToDeckCount set, we only pick
    // as many as needed to reach the target deck size.
    const effectiveIterations = step.fillToDeckCount !== undefined
      ? Math.max(0, step.fillToDeckCount - host.getCurrentDeckSize())
      : step.iterations;

    if (effectiveIterations === 0) {
      // Nothing to pick — skip the step entirely
      this.goto(step.next);
      this.executeUntilBlocked(ctx);
      return;
    }

    const poolIds = this.resolveCardOfferPoolIds(ctx, step);
    const choices = poolIds.length === 1
      ? host.sampleCardsFromPool(poolIds[0]!, step.picksPerIteration)
      : host.sampleCardsFromPools(poolIds, step.picksPerIteration);
    this.internal!.pending = {
      kind: 'cardOffer',
      iteration: 0,
      totalIterations: effectiveIterations,
      choices,
      destination: step.destination,
      canSkip: step.allowSkip ?? false,
    };
    this.publishCardOfferStatus();
  }

  /**
   * Resolve a CardOfferStep's effective pool ID list given the current
   * run state. Filters `poolRefs` by condition; concatenates the legacy
   * single `poolId` if present; dedupes (set-like). Throws when neither
   * form is set or all conditional refs are gated out.
   */
  private resolveCardOfferPoolIds(
    ctx: FlowRuntimeContext,
    step: { poolId?: string; poolRefs?: ReadonlyArray<{ poolId: string; condition?: import('../../types/index.js').ConditionExpr }> },
  ): string[] {
    const ids: string[] = [];
    if (step.poolId) ids.push(step.poolId);
    for (const ref of step.poolRefs ?? []) {
      if (ref.condition && !evalCondition(ref.condition, ctx.condition)) continue;
      ids.push(ref.poolId);
    }
    if (ids.length === 0) {
      throw new Error('cardOffer step has no eligible pools (poolId/poolRefs missing or all gated out)');
    }
    return Array.from(new Set(ids));
  }

  private advanceCardOfferIteration(ctx: FlowRuntimeContext): FlowStatus {
    const pending = this.requirePending('cardOffer');
    pending.iteration++;
    if (pending.iteration >= pending.totalIterations) {
      const step = this.currentStep();
      if (step.kind !== 'cardOffer') throw new Error('not cardOffer');
      this.internal!.pending = undefined;
      this.goto(step.next);
      return this.executeUntilBlocked(ctx);
    }
    // Re-sample for next iteration
    const step = this.currentStep();
    if (step.kind !== 'cardOffer') throw new Error('not cardOffer');
    const host = this.requireHost(ctx, 'cardOffer.iter');
    const poolIds = this.resolveCardOfferPoolIds(ctx, step);
    pending.choices = poolIds.length === 1
      ? host.sampleCardsFromPool(poolIds[0]!, step.picksPerIteration)
      : host.sampleCardsFromPools(poolIds, step.picksPerIteration);
    this.publishCardOfferStatus();
    return this.cachedStatus;
  }

  private publishCardOfferStatus(): void {
    const pending = this.requirePending('cardOffer');
    this.cachedStatus = {
      kind: 'awaitingCardPick',
      stepId: this.internal!.currentStepId,
      iteration: pending.iteration + 1,
      totalIterations: pending.totalIterations,
      choices: pending.choices,
      destination: pending.destination,
      canSkip: pending.canSkip,
    };
  }

  // ---------- skillOffer ----------

  private beginSkillOffer(ctx: FlowRuntimeContext): void {
    const step = this.currentStep();
    if (step.kind !== 'skillOffer') throw new Error('not skillOffer');
    const host = this.requireHost(ctx, 'skillOffer');
    const choices = host.sampleSkillsForOffer({
      grade: step.grade,
      poolOverride: step.poolOverride,
      count: step.count,
      // When fillRestWithGoldAmount is set, host both excludes owned skills
      // AND pads remaining slots with gold-marker pseudo-skills.
      excludeOwned: step.fillRestWithGoldAmount !== undefined,
      fillRestWithGoldAmount: step.fillRestWithGoldAmount,
    });
    this.cachedStatus = {
      kind: 'awaitingSkillPick',
      stepId: this.internal!.currentStepId,
      choices,
      canSkip: step.allowSkip ?? false,
    };
  }

  private finishSkillOffer(ctx: FlowRuntimeContext): FlowStatus {
    const step = this.currentStep();
    if (step.kind !== 'skillOffer') throw new Error('not skillOffer');
    this.goto(step.next);
    return this.executeUntilBlocked(ctx);
  }

  // ---------- cardUpgrade ----------

  private beginCardUpgrade(ctx: FlowRuntimeContext): void {
    const step = this.currentStep();
    if (step.kind !== 'cardUpgrade') throw new Error('not cardUpgrade');
    const host = this.requireHost(ctx, 'cardUpgrade');
    const candidates = host.filterCardsForUpgrade(step.source, step.cardFilter);
    this.internal!.pending = {
      kind: 'cardUpgrade',
      iteration: 0,
      totalIterations: step.count,
      candidates,
      source: step.source,
      canSkip: step.allowSkip ?? false,
    };
    if (candidates.length === 0) {
      // Nothing to upgrade — auto-finish
      this.finishCardUpgrade(ctx);
      return;
    }
    this.publishCardUpgradeTargetStatus(step.forceModifierId);
  }

  private advanceCardUpgradeIteration(ctx: FlowRuntimeContext): FlowStatus {
    const pending = this.requirePending('cardUpgrade');
    pending.iteration++;
    if (pending.iteration >= pending.totalIterations) {
      return this.finishCardUpgrade(ctx);
    }
    // Re-sample candidates (they may have changed after attaching mods)
    const step = this.currentStep();
    if (step.kind !== 'cardUpgrade') throw new Error('not cardUpgrade');
    const host = this.requireHost(ctx, 'cardUpgrade.iter');
    pending.candidates = host.filterCardsForUpgrade(step.source, step.cardFilter);
    if (pending.candidates.length === 0) {
      return this.finishCardUpgrade(ctx);
    }
    this.publishCardUpgradeTargetStatus(step.forceModifierId);
    return this.cachedStatus;
  }

  private finishCardUpgrade(ctx: FlowRuntimeContext): FlowStatus {
    const step = this.currentStep();
    if (step.kind !== 'cardUpgrade') throw new Error('not cardUpgrade');
    this.internal!.pending = undefined;
    this.goto(step.next);
    return this.executeUntilBlocked(ctx);
  }

  private publishCardUpgradeTargetStatus(forcedModifierId: ModifierId | undefined): void {
    const pending = this.requirePending('cardUpgrade');
    this.cachedStatus = {
      kind: 'awaitingCardUpgradeTarget',
      stepId: this.internal!.currentStepId,
      iteration: pending.iteration + 1,
      totalIterations: pending.totalIterations,
      candidates: pending.candidates,
      source: pending.source,
      forcedModifierId,
      canSkip: pending.canSkip,
    };
  }

  // ---------- cardModifierAttach ----------

  /**
   * Returns null when the step auto-advanced (allInDeck/allWithTag).
   * Returns status when it's waiting for player target pick ('choose').
   */
  private runCardModifierAttach(ctx: FlowRuntimeContext): FlowStatus | null {
    const step = this.currentStep();
    if (step.kind !== 'cardModifierAttach') throw new Error('not cardModifierAttach');
    const host = this.requireHost(ctx, 'cardModifierAttach');

    if (step.cardInstanceSelector === 'choose') {
      // Reuse cardUpgrade source semantics — assume 'currentDeck' for choose mode.
      // (Doc 04 doesn't explicitly say; we default to currentDeck. A future
      // step variant can add a `source` field if needed.)
      const candidates = host.filterCardsForUpgrade('currentDeck');
      if (candidates.length === 0) {
        this.goto(step.next);
        return null; // back to outer loop
      }
      this.internal!.pending = {
        kind: 'cardModifierAttachChoose',
        candidates,
        forcedModifierId: step.modifierId,
      };
      this.cachedStatus = {
        kind: 'awaitingCardUpgradeTarget',
        stepId: this.internal!.currentStepId,
        iteration: 1,
        totalIterations: 1,
        candidates,
        source: 'currentDeck',
        forcedModifierId: step.modifierId,
        canSkip: false,
      };
      return this.cachedStatus;
    }

    // Bulk: attach to allInDeck or allWithTag
    const result = host.forceAttachModifier({
      selector: step.cardInstanceSelector,
      tag: step.tag,
      modifierId: step.modifierId,
      source: { kind: 'event', contextId: this.internal!.event.id },
    });
    void result; // could log to effectLog later
    this.goto(step.next);
    return null;
  }

  // ---------- combatStart ----------

  private beginCombat(ctx: FlowRuntimeContext): void {
    const step = this.currentStep();
    if (step.kind !== 'combatStart') throw new Error('not combatStart');
    const host = this.requireHost(ctx, 'combatStart');
    this.internal!.pending = { kind: 'inCombat' };
    host.beginCombat(step.enemyGroupId);
    this.cachedStatus = {
      kind: 'inCombat',
      stepId: this.internal!.currentStepId,
      enemyGroupId: step.enemyGroupId,
    };
  }

  // ====================================================================
  // Choice helpers (unchanged)
  // ====================================================================

  private resolveChoiceOptions(
    options: ReadonlyArray<ChoiceOption>,
    ctx: FlowRuntimeContext,
  ): ResolvedChoiceOption[] {
    const out: ResolvedChoiceOption[] = [];
    for (let i = 0; i < options.length; i++) {
      const opt = options[i]!;
      if (opt.hidden && evalCondition(opt.hidden, ctx.condition)) continue;
      const enabled = opt.condition ? evalCondition(opt.condition, ctx.condition) : true;
      out.push({
        index: i,
        label: this.renderText(opt.label, ctx),
        enabled,
        disabledReason: enabled ? undefined : opt.disabledLabel,
      });
    }
    return out;
  }

  private applyChoiceOption(opt: ChoiceOption, ctx: FlowRuntimeContext): void {
    if (opt.effects) {
      const results = executeEffects(opt.effects, ctx.execution);
      this.internal!.effectLog.push(...results);
    }
    if (opt.probabilistic) {
      const chance = this.resolveProbabilisticChance(opt.probabilistic, ctx);
      const success = ctx.rng.float() < chance;
      this.goto(success ? opt.probabilistic.successNext : opt.probabilistic.failureNext);
    } else if (opt.next) {
      this.goto(opt.next);
    } else {
      throw new Error('ChoiceOption has neither `next` nor `probabilistic`');
    }
  }

  private resolveProbabilisticChance(
    p: ProbabilisticBranch,
    _ctx: FlowRuntimeContext,
  ): number {
    return Math.max(0, Math.min(1, p.chance));
  }

  // ====================================================================
  // Helpers
  // ====================================================================

  private goto(stepId: string): void {
    if (!this.internal!.flow.steps[stepId]) {
      throw new Error(
        `Flow '${this.internal!.flow.id}' references unknown step id: '${stepId}'`,
      );
    }
    this.internal!.history.push(this.internal!.currentStepId);
    this.internal!.currentStepId = stepId;
  }

  private currentStep(): FlowStep {
    this.requireRunning();
    return this.internal!.flow.steps[this.internal!.currentStepId]!;
  }

  private requireRunning(): void {
    if (!this.internal) {
      throw new Error('FlowRuntime not started — call start() first');
    }
  }

  private requireHost(ctx: FlowRuntimeContext, call: string): FlowHost {
    if (!ctx.host) {
      throw new Error(`FlowRuntimeContext.host is required for ${call}`);
    }
    return ctx.host;
  }

  private requirePending<K extends PendingStepState['kind']>(
    kind: K,
  ): Extract<PendingStepState, { kind: K }> {
    if (!this.internal?.pending) {
      throw new Error(`No pending state — expected '${kind}'`);
    }
    if (this.internal.pending.kind !== kind) {
      throw new Error(
        `Pending state mismatch: expected '${kind}', got '${this.internal.pending.kind}'`,
      );
    }
    return this.internal.pending as Extract<PendingStepState, { kind: K }>;
  }

  private renderText(template: string, ctx: FlowRuntimeContext): string {
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      if (this.internal && key in this.internal.variables) {
        return String(this.internal.variables[key]);
      }
      const run = ctx.condition.run;
      const global = ctx.condition.global;
      switch (key) {
        case 'gold':       return run ? String(run.player.gold) : match;
        case 'goldMeta':   return global ? String(global.gold) : match;
        case 'currentHp':  return run ? String(run.player.hp) : match;
        case 'maxHp':      return run ? String(run.player.maxHp) : match;
        case 'difficulty': return run ? String(run.difficultyLevel) : match;
        default:           return match;
      }
    });
  }
}
