import type { CardDefId, EffectTag } from './ids.js';
import type { CardKeyword, CardType, Rarity } from './card.js';
import type { Effect } from './effect.js';
import type { ConditionExpr } from './condition.js';
import type { ModifierId, ModifierPoolId } from './ids.js';
import type { SkillId, ScenarioId, EventId, NodeTypeId, EnemyGroupId } from './ids.js';

/**
 * Flow definition — the event scenario graph.
 *
 * Doc: 01_engine_primitives.md §7, 04_event_flow_system.md
 */

export interface EventDefinition {
  readonly id: EventId;
  readonly name: string;
  readonly nodeType: NodeTypeId;
  readonly flowId: ScenarioId;
  readonly availability?: AvailabilityRule;
  readonly oneShot?: boolean;
}

export interface AvailabilityRule {
  readonly minDifficulty?: number;
  readonly maxDifficulty?: number;
  readonly requiresEventCleared?: ReadonlyArray<EventId>;
  readonly forbidsEventCleared?: ReadonlyArray<EventId>;
  readonly customPredicateId?: string;
}

export interface FlowDefinition {
  readonly id: ScenarioId;
  readonly entryStepId: string;
  readonly steps: Readonly<Record<string, FlowStep>>;
}

export type FlowStep =
  | DialogueStep
  | ChoiceStep
  | CardOfferStep
  | SkillOfferStep
  | CardUpgradeStep
  | CardModifierAttachStep
  | ApplyEffectStep
  | BranchStep
  | CombatStartStep
  | GotoStep
  | EndStep;

export interface DialogueStep {
  readonly kind: 'dialogue';
  readonly speaker?: string;
  readonly text: string;
  readonly next: string;
}

export interface ChoiceStep {
  readonly kind: 'choice';
  readonly prompt?: string;
  readonly options: ReadonlyArray<ChoiceOption>;
}

export interface ChoiceOption {
  readonly label: string;
  readonly disabledLabel?: string;
  readonly condition?: ConditionExpr;
  readonly hidden?: ConditionExpr;
  readonly effects?: ReadonlyArray<Effect>;
  readonly probabilistic?: ProbabilisticBranch;
  readonly next?: string;
}

export interface ProbabilisticBranch {
  readonly chance: number;
  readonly successNext: string;
  readonly failureNext: string;
  readonly chanceModifierExpr?: string;
}

export interface CardOfferStep {
  readonly kind: 'cardOffer';
  readonly poolId: string;
  readonly picksPerIteration: number;
  readonly iterations: number;
  readonly destination: 'inventory' | 'currentDeck';
  readonly allowSkip?: boolean;
  readonly next: string;
  /**
   * When set, the runtime overrides `iterations` to
   *   max(0, fillToDeckCount - currentDeckSize)
   * so the step picks "only as many cards as needed to bring the deck to N".
   * If the deck is already ≥ N, the step is skipped entirely.
   * Used by 여정의 시작 to fill to 5 minus any inventory-drafted cards.
   */
  readonly fillToDeckCount?: number;
}

export interface SkillOfferStep {
  readonly kind: 'skillOffer';
  readonly grade?: 'lowest' | 'low' | 'mid' | 'high' | 'highest';
  readonly poolOverride?: ReadonlyArray<SkillId>;
  readonly count: number;
  readonly allowSkip?: boolean;
  readonly next: string;
}

export interface CardUpgradeStep {
  readonly kind: 'cardUpgrade';
  readonly source: 'currentDeck' | 'inventory';
  readonly cardFilter?: CardFilter;
  readonly modifierPoolOverride?: {
    readonly add?: ReadonlyArray<ModifierPoolId>;
    readonly remove?: ReadonlyArray<ModifierPoolId>;
  };
  readonly forceModifierId?: ModifierId;
  readonly count: number;
  readonly allowSkip?: boolean;
  readonly next: string;
}

export interface CardModifierAttachStep {
  readonly kind: 'cardModifierAttach';
  readonly cardInstanceSelector: 'choose' | 'allInDeck' | 'allWithTag';
  readonly tag?: EffectTag;
  readonly modifierId: ModifierId;
  readonly next: string;
}

export interface ApplyEffectStep {
  readonly kind: 'applyEffect';
  readonly effects: ReadonlyArray<Effect>;
  readonly next: string;
}

export interface BranchStep {
  readonly kind: 'branch';
  readonly branches: ReadonlyArray<{
    readonly condition: ConditionExpr;
    readonly next: string;
  }>;
  readonly defaultNext: string;
}

export interface CombatStartStep {
  readonly kind: 'combatStart';
  readonly enemyGroupId: EnemyGroupId;
  readonly afterVictoryNext: string;
  readonly afterDefeatNext?: string;
}

export interface GotoStep {
  readonly kind: 'goto';
  readonly stepId: string;
}

export interface EndStep {
  readonly kind: 'end';
  readonly outcome?: 'success' | 'failure' | 'neutral';
}

export interface CardFilter {
  readonly tags?: ReadonlyArray<EffectTag>;
  readonly types?: ReadonlyArray<CardType>;
  readonly minRarity?: Rarity;
  readonly maxRarity?: Rarity;
  readonly excludeKeywords?: ReadonlyArray<CardKeyword>;
}
