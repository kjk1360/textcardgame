import type { ModifierPool } from '../types/index.js';
import {
  POOL_DAGGER_ID,
  POOL_PHYSICAL_ID,
  POOL_SINGLE_ATTACK_ID,
  POOL_SINGLE_DEFENSE_ID,
} from './cards.js';
import {
  MOD_BARB,
  MOD_BLUR,
  MOD_DAGGER_TRICK,
  MOD_HARDEN,
  MOD_HONE,
  MOD_OIL,
  MOD_OVERPOWER,
  MOD_POISON_COAT,
  MOD_RALLY,
  MOD_SPREAD,
  MOD_SUSTAIN,
} from './modifiers.js';

/**
 * Modifier pools — sets of modifier candidates a card draws from on
 * upgrade. Cards declare which pools they consult via
 * `modifierPoolRefs`; the sampler merges multiple pools by MAX weight
 * (set semantics, not buckets).
 *
 * Same modifier intentionally appears in multiple pools (e.g. 확산 in
 * dagger + single_attack) — that's how a card with both tags gets the
 * shared upgrade as a single option, not a duplicate.
 */

export const POOL_DAGGER: ModifierPool = {
  id: POOL_DAGGER_ID,
  name: '단검 강화 풀',
  entries: [
    { modifierId: MOD_SPREAD.id,       weight: 4 },
    { modifierId: MOD_POISON_COAT.id,  weight: 5 },
    { modifierId: MOD_DAGGER_TRICK.id, weight: 3 },
  ],
};

export const POOL_PHYSICAL: ModifierPool = {
  id: POOL_PHYSICAL_ID,
  name: '물리 강화 풀',
  entries: [
    { modifierId: MOD_HONE.id,      weight: 8 },
    { modifierId: MOD_OIL.id,       weight: 4 },
    { modifierId: MOD_BARB.id,      weight: 5 },
    { modifierId: MOD_OVERPOWER.id, weight: 5 },
  ],
};

export const POOL_SINGLE_ATTACK: ModifierPool = {
  id: POOL_SINGLE_ATTACK_ID,
  name: '단일공격 강화 풀',
  entries: [
    { modifierId: MOD_SPREAD.id,  weight: 4 },
    { modifierId: MOD_SUSTAIN.id, weight: 4 },
    { modifierId: MOD_RALLY.id,   weight: 4 },
  ],
};

export const POOL_SINGLE_DEFENSE: ModifierPool = {
  id: POOL_SINGLE_DEFENSE_ID,
  name: '단일방어 강화 풀',
  entries: [
    { modifierId: MOD_SUSTAIN.id, weight: 4 },
    { modifierId: MOD_HARDEN.id,  weight: 6 },
    { modifierId: MOD_BLUR.id,    weight: 3 },
  ],
};

export const ALL_MODIFIER_POOLS: ReadonlyArray<ModifierPool> = [
  POOL_DAGGER, POOL_PHYSICAL, POOL_SINGLE_ATTACK, POOL_SINGLE_DEFENSE,
];
