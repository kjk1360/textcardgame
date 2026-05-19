import type {
  Actor,
  EnemyActor,
  StatusId,
} from '../../types/index.js';
import {
  applyStatus,
  type StatusRegistry,
} from '../statuses/engine.js';
import { applyBlockGain } from '../combat/damage.js';

/**
 * Difficulty system — escalating enemy buffs per "회차" (rest-hub visit).
 *
 * Doc: 06_meta_progression.md §"난이도 시스템"
 *
 * Per-character counter (slot.difficultyLevel) indexes into a table of
 * buffs to apply to enemies at the start of every combat in that run.
 *
 * Data file (this module) holds a default in-code table — Phase 4
 * migrates to authoring/difficulty/difficulty_table.yaml.
 * Migration note: docs/migration/01_ts_to_excel.md.
 */

// ====================================================================
// Types
// ====================================================================

export interface DifficultyEntry {
  readonly level: number;
  readonly enemyHpMultiplier: number;
  readonly enemyStrengthBonus: number;
  readonly enemyDexterityBonus?: number;
  readonly specialBuffs?: ReadonlyArray<SpecialBuff>;
  readonly description?: string;
}

export type SpecialBuff =
  | { kind: 'thorns'; statusId: StatusId; amount: number }
  | { kind: 'firstHitInvuln'; statusId: StatusId }
  | { kind: 'startWithBlock'; amount: number }
  | { kind: 'regenPerTurn'; statusId: StatusId; amount: number }
  | { kind: 'extraIntent' }                              // wire-up needed in turn-flow
  | { kind: 'applyStatus'; statusId: StatusId; stacks: number }
  | { kind: 'custom'; handlerId: string };

export interface DifficultyTable {
  /** Lowest defined level (typically 0). */
  readonly min: number;
  /** Highest defined level — beyond this, rest hub becomes final boss. */
  readonly max: number;
  /** Entries keyed by level. Must cover [min..max] inclusive. */
  readonly entries: ReadonlyMap<number, DifficultyEntry>;
}

export type DifficultyCustomBuffHandler = (
  enemy: EnemyActor,
  params: Record<string, unknown> | undefined,
  registry: StatusRegistry,
) => void;

// ====================================================================
// Default table (mock data; final values in authoring/ later)
// ====================================================================

/**
 * Mock default table. Real balance comes from data later. The pattern
 * (~+10% hp / +1 strength per level + special twists at milestones)
 * mirrors the design doc.
 */
export function makeDefaultDifficultyTable(opts?: {
  vulnerableStatusId?: StatusId;     // unused but reserved
  thornsStatusId?: StatusId;
  regenStatusId?: StatusId;
  firstHitInvulnStatusId?: StatusId;
}): DifficultyTable {
  const thornsId = opts?.thornsStatusId ?? ('thorns' as StatusId);
  const regenId = opts?.regenStatusId ?? ('regen' as StatusId);
  const fhId = opts?.firstHitInvulnStatusId ?? ('firstHitInvuln' as StatusId);
  const entries = new Map<number, DifficultyEntry>();

  for (let lvl = 0; lvl <= 20; lvl++) {
    const hpMul = 1 + lvl * 0.1;
    const strBonus = lvl;
    const specials: SpecialBuff[] = [];
    if (lvl === 3)  specials.push({ kind: 'thorns', statusId: thornsId, amount: 2 });
    if (lvl === 5)  specials.push({ kind: 'firstHitInvuln', statusId: fhId });
    if (lvl === 7)  specials.push({ kind: 'startWithBlock', amount: 5 });
    if (lvl === 10) specials.push({ kind: 'regenPerTurn', statusId: regenId, amount: 1 });
    if (lvl === 15) specials.push({ kind: 'extraIntent' });
    if (lvl === 20) specials.push(
      { kind: 'regenPerTurn', statusId: regenId, amount: 3 },
      { kind: 'thorns', statusId: thornsId, amount: 5 },
    );
    entries.set(lvl, {
      level: lvl,
      enemyHpMultiplier: hpMul,
      enemyStrengthBonus: strBonus,
      specialBuffs: specials.length > 0 ? specials : undefined,
      description: lvl === 20 ? '차원의 핵심 — 최종보스 차원문' : undefined,
    });
  }

  return { min: 0, max: 20, entries };
}

// ====================================================================
// Operations
// ====================================================================

/**
 * Lookup helper: clamps to [min, max].
 */
export function getDifficultyEntry(table: DifficultyTable, level: number): DifficultyEntry {
  const clamped = Math.max(table.min, Math.min(table.max, level));
  const e = table.entries.get(clamped);
  if (!e) {
    throw new Error(`DifficultyTable missing entry for level ${clamped}`);
  }
  return e;
}

/** True when the slot's level has hit max — rest hub becomes final boss. */
export function isAtFinalDifficulty(table: DifficultyTable, level: number): boolean {
  return level >= table.max;
}

/**
 * Apply a difficulty entry's buffs to a list of enemies. Mutates them.
 * Idempotency: do NOT call this twice for the same combat — it stacks.
 *
 * Statuses used by difficulty buffs are passed in by id so the data
 * stays decoupled from the engine's specific status names.
 */
export function applyDifficultyBuffsToEnemies(
  enemies: ReadonlyArray<EnemyActor>,
  level: number,
  table: DifficultyTable,
  statuses: StatusRegistry,
  opts?: {
    strengthStatusId?: StatusId;
    dexterityStatusId?: StatusId;
    customBuffHandlers?: ReadonlyMap<string, DifficultyCustomBuffHandler>;
  },
): void {
  const entry = getDifficultyEntry(table, level);
  const strId = opts?.strengthStatusId ?? ('strength' as StatusId);
  const dexId = opts?.dexterityStatusId ?? ('dexterity' as StatusId);

  for (const enemy of enemies) {
    // HP scaling — apply to max, then restore to full
    if (entry.enemyHpMultiplier !== 1) {
      enemy.maxHp = Math.round(enemy.maxHp * entry.enemyHpMultiplier);
      enemy.hp = enemy.maxHp;
    }
    if (entry.enemyStrengthBonus > 0) {
      applyStatus(enemy, strId, entry.enemyStrengthBonus, statuses);
    }
    if ((entry.enemyDexterityBonus ?? 0) > 0) {
      applyStatus(enemy, dexId, entry.enemyDexterityBonus!, statuses);
    }
    for (const buff of entry.specialBuffs ?? []) {
      applySpecialBuff(enemy, buff, statuses, opts?.customBuffHandlers);
    }
  }
}

function applySpecialBuff(
  enemy: EnemyActor,
  buff: SpecialBuff,
  statuses: StatusRegistry,
  custom?: ReadonlyMap<string, DifficultyCustomBuffHandler>,
): void {
  switch (buff.kind) {
    case 'thorns':
      applyStatus(enemy, buff.statusId, buff.amount, statuses);
      return;
    case 'firstHitInvuln':
      applyStatus(enemy, buff.statusId, 1, statuses);
      return;
    case 'startWithBlock':
      applyBlockGain(enemy as Actor, buff.amount, statuses);
      return;
    case 'regenPerTurn':
      applyStatus(enemy, buff.statusId, buff.amount, statuses);
      return;
    case 'applyStatus':
      applyStatus(enemy, buff.statusId, buff.stacks, statuses);
      return;
    case 'extraIntent':
      // Wired in turn-flow: enemy with extraIntent runs intent twice.
      // Marker only — the actual double-action lives in runEnemyTurn.
      // We tag via enemy.meta? But EnemyActor has no meta field, so
      // store in statuses with id 'meta_extra_intent' as a marker.
      applyStatus(enemy, 'meta_extra_intent' as StatusId, 1, statuses);
      return;
    case 'custom': {
      if (!custom) {
        throw new Error(`Difficulty custom handler not provided: ${buff.handlerId}`);
      }
      const fn = custom.get(buff.handlerId);
      if (!fn) {
        throw new Error(`Difficulty custom handler not registered: ${buff.handlerId}`);
      }
      fn(enemy, undefined, statuses);
      return;
    }
  }
}
