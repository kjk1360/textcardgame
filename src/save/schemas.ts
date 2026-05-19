import { z } from 'zod';

/**
 * Zod schemas for save-file content.
 *
 * These mirror the engine's TypeScript types but are the SOURCE OF TRUTH
 * for what's serialized. Adding/changing a field that affects save
 * compatibility requires bumping `CURRENT_SCHEMA_VERSION` and writing
 * a migration in `migrations.ts`.
 *
 * Engine types use branded ID newtypes (CardDefId etc.) — those compile
 * to plain strings, so the Zod schema also uses `z.string()`.
 */

export const CURRENT_SCHEMA_VERSION = 1;

// ---------- Common primitives ----------

const AcquisitionMetaSchema = z.object({
  kind: z.enum(['starter', 'event', 'shop', 'reward', 'warehouse']),
  contextId: z.string().optional(),
  runId: z.string().optional(),
});

const ModifierInstanceSchema = z.object({
  id: z.string(),
  appliedAt: z.number(),
  source: AcquisitionMetaSchema,
});

const CardInstanceSchema = z.object({
  instanceId: z.string(),
  defId: z.string(),
  modifiers: z.array(ModifierInstanceSchema),
  acquired: AcquisitionMetaSchema,
});

// ---------- Global state ----------

const InventoryStateSchema = z.object({
  capacity: z.number().int().nonnegative(),
  cards: z.array(CardInstanceSchema),
});

const GlobalStatisticsSchema = z.object({
  totalRuns: z.number().int().nonnegative().default(0),
  totalRunsCompleted: z.number().int().nonnegative().default(0),
  totalDeaths: z.number().int().nonnegative().default(0),
  totalCardsAcquired: z.number().int().nonnegative().default(0),
  totalCardsModified: z.number().int().nonnegative().default(0),
  totalGoldEarned: z.number().int().nonnegative().default(0),
  finalBossKills: z.number().int().nonnegative().default(0),
  highestDifficultyReached: z.number().int().nonnegative().default(0),
  playTimeMs: z.number().nonnegative().default(0),
});

export const GlobalSaveSchema = z.object({
  schemaVersion: z.number().int().positive(),
  gold: z.number().int().nonnegative(),
  inventory: InventoryStateSchema,
  passiveSkills: z.array(z.string()),
  eventsCleared: z.array(z.string()),     // Set serialized as array
  difficultyMaxReached: z.number().int().nonnegative(),
  statistics: GlobalStatisticsSchema,
});

export type GlobalSave = z.infer<typeof GlobalSaveSchema>;

// ---------- Slot state ----------

// State variants (mirror SlotState discriminated union, sans complex
// in-flight Run/Combat for now — those use loose passthrough until the
// Run save format settles in Phase 2.7).

const SlotStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('empty') }),
  z.object({ kind: z.literal('atRest') }),
  z.object({
    kind: z.literal('inStartPhase'),
    pendingSkillChoice: z.any().optional(),
  }),
  z.object({
    kind: z.literal('inRun'),
    // Loose pass-through for the in-flight run state until Phase 2.7
    // formalizes a serialization-safe RunState schema.
    run: z.unknown(),
  }),
]);

export const SlotSaveSchema = z.object({
  schemaVersion: z.number().int().positive(),
  slotIndex: z.number().int().min(0).max(4),
  characterName: z.string().optional(),
  difficultyLevel: z.number().int().nonnegative().default(0),
  totalRunsCompleted: z.number().int().nonnegative().default(0),
  createdAt: z.number().optional(),
  diedAt: z.number().optional(),
  state: SlotStateSchema,
});

export type SlotSave = z.infer<typeof SlotSaveSchema>;

// ---------- Defaults ----------

export function newGlobalSave(): GlobalSave {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    gold: 0,
    inventory: { capacity: 20, cards: [] },
    passiveSkills: [],
    eventsCleared: [],
    difficultyMaxReached: 0,
    statistics: GlobalStatisticsSchema.parse({}),
  };
}

export function newEmptySlotSave(slotIndex: number): SlotSave {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    slotIndex,
    difficultyLevel: 0,
    totalRunsCompleted: 0,
    state: { kind: 'empty' },
  };
}
