import type { CardDefId, CardPoolId, EffectTag } from './ids.js';
import type { CardKeyword, CardType, Rarity } from './card.js';
import type { Effect } from './effect.js';
import type { ConditionExpr } from './condition.js';
import type { ModifierId, ModifierPoolId } from './ids.js';
import type { SkillId, ScenarioId, EventId, NodeTypeId, EnemyGroupId } from './ids.js';
import type { SkillGrade } from './skill.js';

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
  /**
   * When true, this event is excluded from the random event-node pool
   * during seedMapContent. Use for events that only make sense at the
   * fixed start node (여정의 시작 etc.) so they don't pop up mid-run.
   */
  readonly startOnly?: boolean;
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
  | ShopOfferStep
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

/**
 * A pool reference with an optional gating condition. Used in
 * CardOfferStep.poolRefs to express "this pool is always available;
 * that pool only adds if the player meets condition X".
 *
 * `condition` is evaluated against the live RunSnapshot/GlobalSnapshot
 * at step-begin time — so "이전 이벤트 클리어 시 드롭 풀 추가" /
 * "특정 카드 보유 시 단검 풀 추가" 같은 트리거가 그대로 표현됩니다.
 */
export interface ConditionalCardPoolRef {
  readonly poolId: CardPoolId;
  readonly condition?: ConditionExpr;
}

export interface CardOfferStep {
  readonly kind: 'cardOffer';
  /**
   * Convenience single-pool form — still supported, equivalent to
   * `poolRefs: [{ poolId }]`. Either `poolId` or `poolRefs` must be set.
   */
  readonly poolId?: string;
  /**
   * Multi-pool form. The runtime merges every eligible pool (whose
   * `condition` evaluates true OR is omitted) into one weighted bag
   * and samples without replacement. A card appearing in multiple
   * pools is deduped — weights are taken via MAX (mirroring the
   * modifier sampler), so being in N pools is "valid in either
   * context", not "more likely".
   */
  readonly poolRefs?: ReadonlyArray<ConditionalCardPoolRef>;
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
  readonly grade?: SkillGrade;
  readonly poolOverride?: ReadonlyArray<SkillId>;
  readonly count: number;
  readonly allowSkip?: boolean;
  readonly next: string;
  /**
   * When set, the offer EXCLUDES skills the character already owns.
   * If fewer than `count` skills remain, the remaining option slots
   * are filled with gold-pseudo-skills worth this many gold each.
   * The pseudo-skill id pattern is '__gold_<N>__' — runtime + UI
   * detect and route to gainGoldMeta(N).
   */
  readonly fillRestWithGoldAmount?: number;
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

/**
 * ShopOffer step — 상점 진열. POOL_MERCHANT 등에서 itemCount만큼 카드 진열,
 * 각 카드별 가격은 등급에 따라 priceTable에서 결정. 플레이어는 골드 허용
 * 한도 내에서 여러 장 구매 가능. 별도로 engraveCost 골드로 능력 각인
 * (engraveNext 단계 — 보통 cardUpgrade) 선택 가능.
 */
export interface ShopOfferStep {
  readonly kind: 'shopOffer';
  readonly poolId: CardPoolId;
  readonly itemCount: number;
  /** Map rarity → priceGold. Defaults: common=50 / rare=150 / legendary=350. */
  readonly priceTable?: Readonly<Record<string, number>>;
  /** 능력 각인 골드 비용. undefined면 옵션 자체가 안 뜸. */
  readonly engraveCost?: number;
  /** 각인 옵션 선택 시 이동할 step id (보통 cardUpgrade 스텝). */
  readonly engraveNext?: string;
  /** "나간다" 선택 시 이동할 step id. */
  readonly leaveNext: string;
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
