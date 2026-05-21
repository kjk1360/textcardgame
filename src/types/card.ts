import type { Effect } from './effect.js';
import type {
  CardDefId,
  CardInstanceId,
  EffectTag,
  ModifierId,
  ModifierPoolId,
} from './ids.js';

export type CardType = 'attack' | 'skill' | 'power' | 'curse' | 'status';

export type Cost =
  | { kind: 'fixed'; value: number }
  | { kind: 'x' }
  | { kind: 'unplayable' };

/**
 * 카드 등급 — 보상/풀 가중치·가격 등에 사용. 'starter'(시작 덱)는 등급이 아니라
 * 카드 풀(`POOL_START_CARDS`)로 분류되므로 여기엔 없음.
 */
export type Rarity = 'common' | 'rare' | 'legendary';

export type CardKeyword =
  | 'exhaust'
  | 'retain'
  | 'ethereal'
  | 'innate'
  | 'unplayable';

/**
 * TargetSpec — structured target rule on CardDefinition.
 * Inside Effect we use the flat TargetKind string for simplicity.
 */
export type TargetSpec =
  | { kind: 'none' }
  | { kind: 'self' }
  | { kind: 'enemy' }
  | { kind: 'allEnemies' }
  | { kind: 'randomEnemy' }
  | { kind: 'ally' }
  | { kind: 'choice'; from: 'hand' | 'discard' | 'draw' | 'exhaust' };

/**
 * CardDefinition — immutable card "template".
 *
 * Doc: 01_engine_primitives.md §1
 */
export interface CardDefinition {
  readonly id: CardDefId;
  readonly name: string;
  readonly cost: Cost;
  readonly type: CardType;
  readonly target: TargetSpec;
  readonly rarity: Rarity;
  readonly tags: readonly EffectTag[];
  readonly keywords: readonly CardKeyword[];
  readonly baseDescription: string;
  readonly baseEffects: readonly Effect[];
  readonly modifierPoolRefs: readonly ModifierPoolId[];
  readonly maxModifiers?: number;
}

/**
 * AcquisitionMeta — how/where a card was obtained.
 */
export interface AcquisitionMeta {
  readonly kind: 'starter' | 'event' | 'shop' | 'reward' | 'warehouse';
  readonly contextId?: string;
  readonly runId?: string;
}

/**
 * ModifierInstance — a modifier attached to a specific CardInstance.
 */
export interface ModifierInstance {
  readonly id: ModifierId;
  readonly appliedAt: number;        // epoch ms
  readonly source: AcquisitionMeta;
}

/**
 * CardInstance — a live card in the game world.
 *
 * Mutability: `modifiers` is mutable (push on upgrade), the rest immutable.
 *
 * Doc: 01_engine_primitives.md §1, 02_card_and_modifier_system.md
 */
export interface CardInstance {
  readonly instanceId: CardInstanceId;
  readonly defId: CardDefId;
  modifiers: ModifierInstance[];
  acquired: AcquisitionMeta;
}

/**
 * ResolvedCard — result of running a CardInstance through the modifier
 * pipeline. The final shape used for cost-check, targeting, execution,
 * and UI display.
 *
 * Doc: 02_card_and_modifier_system.md §"카드 1장의 생애주기" + §"모디파이어 합성"
 */
export interface ResolvedCard {
  readonly defId: CardDefId;
  readonly cost: Cost;
  readonly type: CardType;
  readonly target: TargetSpec;
  readonly keywords: readonly CardKeyword[];
  readonly effects: readonly Effect[];
  readonly modifierIdsApplied: readonly ModifierId[];
}
