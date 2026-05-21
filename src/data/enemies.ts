import type { EnemyGroupId, EnemyId } from '../types/index.js';
import type {
  EnemyDefinition,
  EnemyGroupDefinition,
} from '../engine/integration/registries.js';

const id = <T extends string>(s: string): T => s as T;

// --------------------------------------------------------------------
// Enemies
// --------------------------------------------------------------------

export const ENEMY_SLIME: EnemyDefinition = {
  id: id<EnemyId>('slime'), name: '슬라임', tier: 'normal',
  hpRange: [12, 14],
  intentScript: {
    mode: 'cycle',
    intents: [
      { id: 'a', display: { kind: 'attack', value: 4 }, effects: [{ kind: 'damage', amount: 4, target: 'enemy' }] },
      { id: 'd', display: { kind: 'defend', value: 3 }, effects: [{ kind: 'gainBlock', amount: 3 }] },
    ],
  },
  rewards: { goldRange: [8, 14] },
  sprite: [
    '    ▄▀▀▀▄    ',
    '   █▒░ ░▒█   ',
    '   █▒ o ▒█   ',
    '   ▀█▒▒▒█▀   ',
    '     ▀▀▀     ',
  ],
};

export const ENEMY_BRUTE: EnemyDefinition = {
  id: id<EnemyId>('brute'), name: '난폭자', tier: 'normal',
  hpRange: [25, 30],
  intentScript: {
    mode: 'cycle',
    intents: [
      { id: 'a', display: { kind: 'attack', value: 8 }, effects: [{ kind: 'damage', amount: 8, target: 'enemy' }] },
      { id: 'a2', display: { kind: 'attack', value: 8 }, effects: [{ kind: 'damage', amount: 8, target: 'enemy' }] },
      { id: 'd', display: { kind: 'defend', value: 6 }, effects: [{ kind: 'gainBlock', amount: 6 }] },
    ],
  },
  rewards: { goldRange: [15, 25] },
  sprite: [
    '   ▄█████▄   ',
    '  █▌▀ ▒ ▀▐█  ',
    '  █▌▖▗▘▝▐█   ',
    '  █▌ ▄▄▄ ▐█  ',
    '   ▀█▄▄▄█▀   ',
    '   ▟█   █▙   ',
    '  ▟▀     ▀▙  ',
  ],
};

export const ALL_ENEMIES: ReadonlyArray<EnemyDefinition> = [ENEMY_SLIME, ENEMY_BRUTE];

// --------------------------------------------------------------------
// Enemy groups
// --------------------------------------------------------------------

export const GROUP_SLIME_SOLO: EnemyGroupDefinition = {
  id: id<EnemyGroupId>('eg_slime_solo'),
  members: [ENEMY_SLIME.id],
};

export const GROUP_BRUTE_SOLO: EnemyGroupDefinition = {
  id: id<EnemyGroupId>('eg_brute_solo'),
  members: [ENEMY_BRUTE.id],
};

export const ALL_ENEMY_GROUPS: ReadonlyArray<EnemyGroupDefinition> = [
  GROUP_SLIME_SOLO, GROUP_BRUTE_SOLO,
];
