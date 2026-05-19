import type {
  GameEventName,
  SkillDefinition,
  SkillId,
} from '../../types/index.js';

/**
 * Skill engine — passive-aware hook collection for character skills.
 *
 * Doc: 01_engine_primitives.md §6, 06_meta_progression.md §"패시브 스킬"
 *
 * Mirrors the status engine's `collectHooks` pattern: hook discovery
 * here is decoupled from hook execution (which lives in turn-flow /
 * play-card / damage modules that already own ExecutionContext).
 *
 * Both per-character (live with the character) and passive (永久
 * across all characters) skills are collected through one entry point
 * — the engine doesn't care which source.
 */

export interface SkillRegistry {
  get(id: SkillId): SkillDefinition;
  has(id: SkillId): boolean;
}

export interface CollectedSkillHook {
  readonly skillId: SkillId;
  readonly hookIndex: number;
  readonly source: 'character' | 'passive';
}

/**
 * Merge character skill ids with global passive skill ids. Used by
 * turn-flow / combat handlers when firing hooks.
 *
 * De-duplication: if a skill is both a character skill AND a passive,
 * we treat it as ONE active skill (avoid double-firing). Passives win
 * the dedup so callers can show "this is permanent" in the UI.
 */
export function getActiveSkillIds(
  characterSkillIds: ReadonlyArray<SkillId>,
  passiveSkillIds: ReadonlyArray<SkillId>,
): ReadonlyArray<{ id: SkillId; source: 'character' | 'passive' }> {
  const seen = new Set<SkillId>();
  const out: Array<{ id: SkillId; source: 'character' | 'passive' }> = [];
  // Passives first so they take precedence on dedup
  for (const id of passiveSkillIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, source: 'passive' });
  }
  for (const id of characterSkillIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, source: 'character' });
  }
  return out;
}

/**
 * Find all hooks across active skills that respond to `event`.
 * Returns (skillId, hookIndex, source) tuples — the caller is
 * responsible for evaluating each hook's `condition` and executing
 * the effects with the proper context.
 */
export function collectSkillHooks(
  characterSkillIds: ReadonlyArray<SkillId>,
  passiveSkillIds: ReadonlyArray<SkillId>,
  event: GameEventName,
  registry: SkillRegistry,
): CollectedSkillHook[] {
  const active = getActiveSkillIds(characterSkillIds, passiveSkillIds);
  const result: CollectedSkillHook[] = [];
  for (const { id, source } of active) {
    if (!registry.has(id)) continue;
    const def = registry.get(id);
    for (let i = 0; i < def.hooks.length; i++) {
      if (def.hooks[i]!.on !== event) continue;
      result.push({ skillId: id, hookIndex: i, source });
    }
  }
  return result;
}
