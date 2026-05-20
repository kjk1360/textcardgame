import { randomUUID } from 'node:crypto';
import type {
  AcquisitionMeta,
  CardDefId,
  CardFilter,
  CardInstance,
  CardInstanceId,
  CardPoolId,
  CardPoolRegistry,
  EffectTag,
  EnemyGroupId,
  ModifierId,
  SkillId,
} from '../../types/index.js';
import { sampleCardsFromPool, sampleCardsFromPools } from '../cards/pool-sampler.js';
import type { FlowHost } from '../flow/host.js';
import type { CardRegistryLookup } from '../combat/play-card.js';
import type { ModifierLookup } from '../modifiers/resolver.js';
import { sampleModifierUpgrades, type PoolLookup, type PoolOverride, type PoolSampleContext } from '../modifiers/sampler.js';
import type { IRandom } from '../rng.js';
import type { MetaState } from '../meta/inventory.js';
import { addCardToInventory } from '../meta/inventory.js';
import type {
  SkillBoxRegistry,
  SkillGrade,
} from '../meta/skill-box.js';
import { isGoldMarker, goldMarkerAmount, makeGoldMarker } from '../flow/skill-offer-gold.js';

/**
 * Concrete FlowHost — bridges the FlowRuntime to the rest of the engine.
 *
 * Doc: 04_event_flow_system.md, 06_meta_progression.md
 *
 * Holds *references* to:
 *   - Registries (cards / modifier pools / card pools / skill boxes)
 *   - The current run's mutable deck
 *   - The (global) inventory
 *   - The current slot's character (mutable skill list)
 *   - RNG (shared with engine)
 *   - A combat-launcher callback (so the runtime stays decoupled from
 *     the concrete turn-flow / combat machinery)
 *
 * Methods MUTATE the passed-in state — this is the integration glue.
 * Tests for the host are end-to-end through Game (integration.test.ts).
 */

export interface FlowHostDeps {
  // Registries
  readonly cards: CardRegistryLookup;
  readonly cardPools: CardPoolRegistry;
  readonly modifiers: ModifierLookup;
  readonly modifierPools: PoolLookup;
  readonly skillBoxes: SkillBoxRegistry;

  // Mutable state references (host mutates these in place)
  /** Current run's deck. Cards added via cardOffer 'currentDeck' destination land here. */
  readonly runDeck: { cards: CardInstance[] };
  /** Global inventory + meta gold (skill purchases would go through Game, not host). */
  readonly meta: MetaState;
  /** Current slot character's skills. */
  readonly character: { skillIds: SkillId[]; difficultyLevel: number };

  // Utilities
  readonly rng: IRandom;

  // Callbacks
  /** Invoked when a combatStart step fires. Game must orchestrate the
   *  actual combat and later call FlowRuntime.combatResolved(). */
  readonly onBeginCombat: (enemyGroupId: EnemyGroupId) => void;
}

export class FlowHostImpl implements FlowHost {
  constructor(private readonly deps: FlowHostDeps) {}

  // ====================================================================
  // cardOffer
  // ====================================================================

  sampleCardsFromPool(poolId: string, count: number): CardDefId[] {
    const pool = this.deps.cardPools.get(poolId as CardPoolId);
    if (!pool) return [];
    return sampleCardsFromPool(pool, count, this.deps.rng);
  }

  sampleCardsFromPools(poolIds: ReadonlyArray<string>, count: number): CardDefId[] {
    const pools = poolIds
      .map(id => this.deps.cardPools.get(id as CardPoolId))
      .filter((p): p is NonNullable<typeof p> => p !== undefined);
    if (pools.length === 0) return [];
    return sampleCardsFromPools(pools, count, this.deps.rng);
  }

  attachCardToDestination(
    cardDefId: CardDefId,
    destination: 'currentDeck' | 'inventory',
    acquired: AcquisitionMeta,
  ): { ok: true; cardInstance: CardInstance } | { ok: false; reason: string } {
    const instance: CardInstance = {
      instanceId: randomUUID() as CardInstanceId,
      defId: cardDefId,
      modifiers: [],
      acquired,
    };
    if (destination === 'currentDeck') {
      this.deps.runDeck.cards.push(instance);
      return { ok: true, cardInstance: instance };
    }
    // inventory
    const r = addCardToInventory(this.deps.meta, instance);
    if (!r.ok) {
      return { ok: false, reason: `inventory ${r.reason} (${r.used}/${r.capacity})` };
    }
    return { ok: true, cardInstance: instance };
  }

  // ====================================================================
  // skillOffer
  // ====================================================================

  sampleSkillsForOffer(opts: {
    grade?: SkillGrade;
    poolOverride?: ReadonlyArray<SkillId>;
    count: number;
    excludeOwned?: boolean;
    fillRestWithGoldAmount?: number;
  }): SkillId[] {
    // poolOverride wins over grade lookup
    let candidates: SkillId[];
    if (opts.poolOverride && opts.poolOverride.length > 0) {
      candidates = [...opts.poolOverride];
    } else if (opts.grade) {
      const box = this.deps.skillBoxes.get(opts.grade);
      if (!box) candidates = [];
      else candidates = box.entries.map(e => e.skillId);
    } else {
      const all = new Set<SkillId>();
      for (const b of this.deps.skillBoxes.all()) {
        for (const e of b.entries) all.add(e.skillId);
      }
      candidates = [...all];
    }

    // Exclude already-owned skills when requested OR when a gold fallback
    // is configured (we never want to offer something they have).
    if (opts.excludeOwned || opts.fillRestWithGoldAmount !== undefined) {
      const owned = new Set(this.deps.character.skillIds);
      candidates = candidates.filter(s => !owned.has(s));
    }

    const picked = pickN(candidates, opts.count, this.deps.rng);

    // Pad with gold markers if there are still slots to fill
    if (opts.fillRestWithGoldAmount !== undefined && picked.length < opts.count) {
      const needed = opts.count - picked.length;
      for (let i = 0; i < needed; i++) {
        picked.push(makeGoldMarker(opts.fillRestWithGoldAmount));
      }
    }
    return picked;
  }

  addSkillToCharacter(skillId: SkillId, _acquired: AcquisitionMeta): void {
    // Gold-marker pseudo-skill → just add meta gold
    if (isGoldMarker(skillId)) {
      this.deps.meta.gold += goldMarkerAmount(skillId);
      return;
    }
    if (this.deps.character.skillIds.includes(skillId)) return;
    this.deps.character.skillIds.push(skillId);
  }

  // ====================================================================
  // cardUpgrade
  // ====================================================================

  filterCardsForUpgrade(
    source: 'currentDeck' | 'inventory',
    filter?: CardFilter,
  ): CardInstance[] {
    const src = source === 'currentDeck'
      ? this.deps.runDeck.cards
      : this.deps.meta.inventory.cards;
    if (!filter) return [...src];
    return src.filter(card => this.cardMatchesFilter(card, filter));
  }

  sampleModifierUpgrades(
    cardInstance: CardInstance,
    count: number,
    override?: PoolOverride,
  ): ModifierId[] {
    const cardDef = this.deps.cards.get(cardInstance.defId);
    const ctx: PoolSampleContext = {
      cardDef,
      difficultyLevel: this.deps.character.difficultyLevel,
    };
    return sampleModifierUpgrades(
      cardInstance,
      count,
      this.deps.modifierPools,
      this.deps.modifiers,
      ctx,
      this.deps.rng,
      override,
    );
  }

  attachModifierToCard(
    cardInstanceId: CardInstanceId,
    modifierId: ModifierId,
    source: AcquisitionMeta,
  ): boolean {
    const card = this.findCardAnywhere(cardInstanceId);
    if (!card) return false;
    card.modifiers.push({
      id: modifierId,
      appliedAt: Date.now(),
      source,
    });
    return true;
  }

  // ====================================================================
  // cardModifierAttach (bulk)
  // ====================================================================

  forceAttachModifier(opts: {
    selector: 'allInDeck' | 'allWithTag';
    tag?: EffectTag;
    modifierId: ModifierId;
    source: AcquisitionMeta;
  }): { matched: number } {
    const candidates = opts.selector === 'allInDeck'
      ? this.deps.runDeck.cards
      : this.deps.runDeck.cards.filter(c => {
        if (!opts.tag) return false;
        const def = this.deps.cards.get(c.defId);
        return def.tags.includes(opts.tag);
      });
    for (const c of candidates) {
      c.modifiers.push({
        id: opts.modifierId,
        appliedAt: Date.now(),
        source: opts.source,
      });
    }
    return { matched: candidates.length };
  }

  // ====================================================================
  // combatStart
  // ====================================================================

  beginCombat(enemyGroupId: EnemyGroupId): void {
    this.deps.onBeginCombat(enemyGroupId);
  }

  // ====================================================================
  // Queries
  // ====================================================================

  getCurrentDeckSize(): number {
    return this.deps.runDeck.cards.length;
  }

  // ====================================================================
  // Internals
  // ====================================================================

  private findCardAnywhere(instanceId: CardInstanceId): CardInstance | undefined {
    return (
      this.deps.runDeck.cards.find(c => c.instanceId === instanceId) ??
      this.deps.meta.inventory.cards.find(c => c.instanceId === instanceId)
    );
  }

  private cardMatchesFilter(card: CardInstance, filter: CardFilter): boolean {
    const def = this.deps.cards.get(card.defId);
    if (filter.tags && !filter.tags.every(t => def.tags.includes(t))) return false;
    if (filter.types && !filter.types.includes(def.type)) return false;
    if (filter.excludeKeywords && filter.excludeKeywords.some(k => def.keywords.includes(k))) return false;
    if (filter.minRarity && rarityRank(def.rarity) < rarityRank(filter.minRarity)) return false;
    if (filter.maxRarity && rarityRank(def.rarity) > rarityRank(filter.maxRarity)) return false;
    return true;
  }
}

// ====================================================================
// Helpers
// ====================================================================

const RARITY_ORDER: Record<string, number> = {
  starter: 0, common: 1, uncommon: 2, rare: 3, special: 4,
};
function rarityRank(r: string): number {
  return RARITY_ORDER[r] ?? 0;
}

function pickN<T>(arr: ReadonlyArray<T>, n: number, rng: IRandom): T[] {
  if (arr.length === 0 || n <= 0) return [];
  const pool = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = rng.intBetween(0, pool.length - 1);
    out.push(pool[idx]!);
    pool.splice(idx, 1);
  }
  return out;
}
