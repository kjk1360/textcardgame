import type {
  AcquisitionMeta,
  CardDefId,
  CardFilter,
  CardInstance,
  CardInstanceId,
  EffectTag,
  EnemyGroupId,
  ModifierId,
} from '../../types/index.js';
import type { SkillGrade } from '../meta/skill-box.js';
import type { PoolOverride } from '../modifiers/sampler.js';
import type { SkillId } from '../../types/index.js';

/**
 * FlowHost — side-effecting operations that the FlowRuntime needs
 * to drive cardOffer / skillOffer / cardUpgrade / cardModifierAttach
 * / combatStart steps.
 *
 * The runtime itself doesn't know about CardPool registries, modifier
 * samplers, or combat lifecycle. The host owns all of those.
 *
 * This is a sealed interface — adding a method is a breaking change.
 * Adding-only-optional is OK (host implementations can leave the new
 * method unimplemented if their step never appears in their data).
 */

export interface FlowHost {
  // ---- cardOffer ----
  /**
   * Sample N CardDefIds from a CardPool. Returns fewer than N when the
   * pool is exhausted of unique candidates.
   */
  sampleCardsFromPool(poolId: string, count: number): CardDefId[];

  /**
   * Receive a CardDefId that the player picked from an offer; place it
   * in the destination (deck or inventory). Returns the freshly-minted
   * CardInstance + ok flag (false when inventory was full, etc.).
   */
  attachCardToDestination(
    cardDefId: CardDefId,
    destination: 'currentDeck' | 'inventory',
    acquired: AcquisitionMeta,
  ): { ok: true; cardInstance: CardInstance } | { ok: false; reason: string };

  // ---- skillOffer ----
  sampleSkillsForOffer(opts: {
    grade?: SkillGrade;
    poolOverride?: ReadonlyArray<SkillId>;
    count: number;
  }): SkillId[];

  /** Add a skill to the current character. Idempotent for non-stackable skills. */
  addSkillToCharacter(skillId: SkillId, acquired: AcquisitionMeta): void;

  // ---- cardUpgrade ----
  filterCardsForUpgrade(
    source: 'currentDeck' | 'inventory',
    filter?: CardFilter,
  ): CardInstance[];

  sampleModifierUpgrades(
    cardInstance: CardInstance,
    count: number,
    override?: PoolOverride,
  ): ModifierId[];

  attachModifierToCard(
    cardInstanceId: CardInstanceId,
    modifierId: ModifierId,
    source: AcquisitionMeta,
  ): boolean;

  // ---- cardModifierAttach (forced) ----
  /**
   * Force-attach a modifier to one or more cards by selector:
   *   - 'choose': caller passes a single instanceId after the runtime
   *     prompted the player. (Same path as cardUpgrade target pick.)
   *   - 'allInDeck': attach to every card in current run deck
   *   - 'allWithTag': attach to every card whose def has the tag
   * Returns number of cards affected.
   */
  forceAttachModifier(opts: {
    selector: 'allInDeck' | 'allWithTag';
    tag?: EffectTag;
    modifierId: ModifierId;
    source: AcquisitionMeta;
  }): { matched: number };

  // ---- combatStart ----
  /**
   * Start combat against an enemy group. The host owns the combat
   * lifecycle — the runtime simply pauses in 'inCombat' state until
   * the host calls FlowRuntime.combatResolved() with the outcome.
   *
   * Returning nothing — runtime status will transition; host triggers
   * the resume call asynchronously.
   */
  beginCombat(enemyGroupId: EnemyGroupId): void;
}
