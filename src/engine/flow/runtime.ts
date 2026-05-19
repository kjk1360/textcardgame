import type {
  ChoiceOption,
  EventDefinition,
  FlowDefinition,
  FlowStep,
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

/**
 * Flow runtime — interprets a FlowDefinition's step graph.
 *
 * Doc: 04_event_flow_system.md §"FlowRuntime"
 *
 * State machine. The host calls `start()`, then poll `getStatus()` to
 * see what's blocking, then drive the runtime forward via type-specific
 * resolver methods (advance / choose / etc.).
 *
 * What's IN this slice (Phase 2.5):
 *   - dialogue, choice (with condition gating), applyEffect, branch,
 *     goto, end
 *   - Variable cell (state.variables) — read by ConditionEvaluator via
 *     custom predicates if needed
 *   - Probabilistic choice branches (success/failure roll)
 *
 * What's DEFERRED to follow-on slices (returns 'awaitingDeferred'):
 *   - cardOffer (needs CardPool registry + sampler)
 *   - skillOffer (needs SkillBox sampling)
 *   - cardUpgrade + cardModifierAttach (needs modifier sampler + run deck mutation API)
 *   - combatStart (needs combat lifecycle integration)
 *
 * Once the host receives 'awaitingDeferred', it currently has no way to
 * resolve it — those handlers come with the meta-progression / combat
 * integration slice.
 */

export interface FlowRuntimeContext {
  /** Condition evaluation + ExecutionContext base. */
  readonly condition: ConditionContext;
  /** Required for applyEffect steps. */
  readonly execution: ExecutionContext;
  /** Used by `random` chance modifier + probabilistic branches. */
  readonly rng: IRandom;
}

export type FlowStatus =
  | { kind: 'idle' }
  | { kind: 'awaitingDialogue'; stepId: string; speaker?: string; text: string }
  | { kind: 'awaitingChoice'; stepId: string; prompt?: string; options: ResolvedChoiceOption[] }
  | { kind: 'awaitingDeferred'; stepId: string; stepKind: FlowStep['kind'] }
  | { kind: 'finished'; outcome: 'success' | 'failure' | 'neutral' };

export interface ResolvedChoiceOption {
  readonly index: number;
  readonly label: string;
  readonly enabled: boolean;
  /** Reason text shown when disabled. Defaults to disabledLabel from option, else generic. */
  readonly disabledReason?: string;
  /** Hidden options are filtered out before reaching the host. */
}

interface InternalState {
  event: EventDefinition;
  flow: FlowDefinition;
  currentStepId: string;
  variables: Record<string, unknown>;
  history: string[];
  /** Accumulated effect results from applyEffect steps and choice effects.
   *  Useful for log / debug. */
  effectLog: EffectResult[];
}

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

  getStatus(): FlowStatus {
    return this.cachedStatus;
  }

  /**
   * Advance from a 'dialogue' or other one-shot step. Throws if called
   * in a non-dialogue state.
   */
  advance(ctx: FlowRuntimeContext): FlowStatus {
    this.requireRunning();
    const step = this.currentStep();
    if (step.kind !== 'dialogue') {
      throw new Error(`advance() called but current step is '${step.kind}', expected 'dialogue'`);
    }
    this.goto(step.next);
    return this.executeUntilBlocked(ctx);
  }

  /**
   * Resolve a 'choice' step by picking an option.
   */
  choose(optionIndex: number, ctx: FlowRuntimeContext): FlowStatus {
    this.requireRunning();
    const step = this.currentStep();
    if (step.kind !== 'choice') {
      throw new Error(`choose() called but current step is '${step.kind}', expected 'choice'`);
    }
    // Re-resolve options (some may be hidden / disabled at pick time)
    const resolved = this.resolveChoiceOptions(step.options, ctx);
    const opt = resolved.find(o => o.index === optionIndex);
    if (!opt) throw new Error(`Option index ${optionIndex} not in current choice`);
    if (!opt.enabled) throw new Error(`Option index ${optionIndex} is disabled`);

    const original = step.options[optionIndex]!;
    this.applyChoiceOption(original, ctx);
    return this.executeUntilBlocked(ctx);
  }

  /** Read-only view of accumulated effect results (for UI log). */
  getEffectLog(): ReadonlyArray<EffectResult> {
    return this.internal?.effectLog ?? [];
  }

  /** Read-only view of internal variables (for debug / custom predicates). */
  getVariables(): Readonly<Record<string, unknown>> {
    return this.internal?.variables ?? {};
  }

  // ====================================================================
  // Internal: step execution
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

        // Deferred kinds — return awaitingDeferred and stop.
        case 'cardOffer':
        case 'skillOffer':
        case 'cardUpgrade':
        case 'cardModifierAttach':
        case 'combatStart':
          this.cachedStatus = {
            kind: 'awaitingDeferred',
            stepId: this.internal!.currentStepId,
            stepKind: step.kind,
          };
          return this.cachedStatus;
      }
    }
  }

  private resolveChoiceOptions(
    options: ReadonlyArray<ChoiceOption>,
    ctx: FlowRuntimeContext,
  ): ResolvedChoiceOption[] {
    const out: ResolvedChoiceOption[] = [];
    for (let i = 0; i < options.length; i++) {
      const opt = options[i]!;
      // hidden first — completely filter out
      if (opt.hidden && evalCondition(opt.hidden, ctx.condition)) continue;
      const enabled = opt.condition
        ? evalCondition(opt.condition, ctx.condition)
        : true;
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
    // Run option effects first (so cost-deducting effects fire even if next step is end)
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
      // No next specified and no probabilistic — implicit end?
      // For safety treat as a missing transition.
      throw new Error('ChoiceOption has neither `next` nor `probabilistic`');
    }
  }

  private resolveProbabilisticChance(
    p: import('../../types/index.js').ProbabilisticBranch,
    _ctx: FlowRuntimeContext,
  ): number {
    // chanceModifierExpr is a future hook; for now base chance only.
    return Math.max(0, Math.min(1, p.chance));
  }

  // ====================================================================
  // Internal: navigation
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

  // ====================================================================
  // Variable substitution
  // ====================================================================

  /**
   * Substitute `{variable}` references in dialogue / choice labels.
   * Supports: {playerName} (TODO), {gold}, {difficulty}, {currentHp},
   * {maxHp}, and any key in internal variables.
   *
   * Unknown variables left as-is (helps catch typos in playtest).
   */
  private renderText(template: string, ctx: FlowRuntimeContext): string {
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      // Try internal variables first
      if (this.internal && key in this.internal.variables) {
        return String(this.internal.variables[key]);
      }
      // Standard substitutions from snapshots
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
