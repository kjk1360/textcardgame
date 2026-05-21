import type {
  CardDefId,
  CardDefinition,
  EffectTag,
  ModifierPoolId,
} from '../types/index.js';
import { STATUS_VULNERABLE } from './statuses.js';

const id = <T extends string>(s: string): T => s as T;

// --------------------------------------------------------------------
// Tags — internal "kind" markers used to drive which modifier pools
// a card pulls from on upgrade. Not surfaced in the UI.
// --------------------------------------------------------------------
export const TAG_DAGGER:          EffectTag = id<EffectTag>('dagger');
export const TAG_PHYSICAL:        EffectTag = id<EffectTag>('physical');
export const TAG_SINGLE_ATTACK:   EffectTag = id<EffectTag>('single_attack');
export const TAG_SINGLE_DEFENSE:  EffectTag = id<EffectTag>('single_defense');

// --------------------------------------------------------------------
// Modifier pool ids — referenced from cards' modifierPoolRefs and
// defined in `modifier-pools.ts`. Centralized here so both modules
// agree on the literal id string.
// --------------------------------------------------------------------
export const POOL_DAGGER_ID         = id<ModifierPoolId>('pool_dagger');
export const POOL_PHYSICAL_ID       = id<ModifierPoolId>('pool_physical');
export const POOL_SINGLE_ATTACK_ID  = id<ModifierPoolId>('pool_single_attack');
export const POOL_SINGLE_DEFENSE_ID = id<ModifierPoolId>('pool_single_defense');

// --------------------------------------------------------------------
// Cards
// --------------------------------------------------------------------

export const CARD_STRIKE: CardDefinition = {
  id: id<CardDefId>('strike'), name: '타격',
  cost: { kind: 'fixed', value: 1 }, type: 'attack', target: { kind: 'enemy' },
  rarity: 'starter', tags: [TAG_PHYSICAL, TAG_SINGLE_ATTACK], keywords: [],
  baseDescription: '적에게 6의 피해를 줍니다.',
  baseEffects: [{ kind: 'damage', amount: 6, target: 'enemy' }],
  modifierPoolRefs: [POOL_PHYSICAL_ID, POOL_SINGLE_ATTACK_ID],
};

export const CARD_DEFEND: CardDefinition = {
  id: id<CardDefId>('defend'), name: '수비',
  cost: { kind: 'fixed', value: 1 }, type: 'skill', target: { kind: 'self' },
  rarity: 'starter', tags: [TAG_SINGLE_DEFENSE], keywords: [],
  baseDescription: '방어도 5를 얻습니다.',
  baseEffects: [{ kind: 'gainBlock', amount: 5 }],
  modifierPoolRefs: [POOL_SINGLE_DEFENSE_ID],
};

export const CARD_HEAVY_STRIKE: CardDefinition = {
  id: id<CardDefId>('heavy_strike'), name: '강타',
  cost: { kind: 'fixed', value: 2 }, type: 'attack', target: { kind: 'enemy' },
  rarity: 'common', tags: [TAG_PHYSICAL, TAG_SINGLE_ATTACK], keywords: [],
  baseDescription: '적에게 10의 피해를 줍니다.',
  baseEffects: [{ kind: 'damage', amount: 10, target: 'enemy' }],
  modifierPoolRefs: [POOL_PHYSICAL_ID, POOL_SINGLE_ATTACK_ID],
};

export const CARD_DAGGER_THROW: CardDefinition = {
  id: id<CardDefId>('dagger_throw'), name: '단검투척',
  cost: { kind: 'fixed', value: 0 }, type: 'attack', target: { kind: 'enemy' },
  rarity: 'common', tags: [TAG_DAGGER, TAG_PHYSICAL, TAG_SINGLE_ATTACK], keywords: ['exhaust'],
  baseDescription: '적에게 4의 피해. 소멸.',
  baseEffects: [{ kind: 'damage', amount: 4, target: 'enemy' }],
  modifierPoolRefs: [POOL_DAGGER_ID, POOL_PHYSICAL_ID, POOL_SINGLE_ATTACK_ID],
};

export const CARD_BASH: CardDefinition = {
  id: id<CardDefId>('bash'), name: '강타·취약',
  cost: { kind: 'fixed', value: 2 }, type: 'attack', target: { kind: 'enemy' },
  rarity: 'common', tags: [TAG_PHYSICAL, TAG_SINGLE_ATTACK], keywords: [],
  baseDescription: '적에게 8의 피해 + 취약 2 부여.',
  baseEffects: [
    { kind: 'damage', amount: 8, target: 'enemy' },
    { kind: 'applyStatus', status: STATUS_VULNERABLE.id, stacks: 2, target: 'enemy' },
  ],
  modifierPoolRefs: [POOL_PHYSICAL_ID, POOL_SINGLE_ATTACK_ID],
};

export const ALL_CARDS: ReadonlyArray<CardDefinition> = [
  CARD_STRIKE, CARD_DEFEND, CARD_HEAVY_STRIKE, CARD_DAGGER_THROW, CARD_BASH,
];
