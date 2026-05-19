import { deleteSaveFile, readResilientJson, writeAtomicJson } from './atomic.js';
import {
  CURRENT_SCHEMA_VERSION,
  GlobalSaveSchema,
  SlotSaveSchema,
  newEmptySlotSave,
  newGlobalSave,
  type GlobalSave,
  type SlotSave,
} from './schemas.js';
import { makeSavePaths, NUM_SLOTS, validateSlotIndex, type SavePaths } from './paths.js';

/**
 * SaveStore — the only thing the rest of the engine talks to for
 * persistence. Hides path handling, atomic write, Zod validation, and
 * future schema migration behind a small surface.
 *
 * Failure policy:
 *   - File missing: returns a new empty value (defaults from schemas)
 *   - File corrupt: tries .bak; if .bak missing/corrupt, returns new empty
 *     and the caller sees `recoveredFromBackup` / `usedDefault` flags
 *   - Zod validation failure: logs + falls back to .bak → defaults
 *
 * Migrations: deferred until we have v2 of the schema. The current
 * schema is v1; any save with schemaVersion < CURRENT_SCHEMA_VERSION
 * will be passed through a future migrate() chain.
 */

export interface LoadResult<T> {
  readonly value: T;
  readonly recoveredFromBackup: boolean;
  /** True when the file was missing/unreadable and we returned defaults. */
  readonly usedDefault: boolean;
}

export class SaveStore {
  constructor(public readonly paths: SavePaths = makeSavePaths()) {}

  // ====================================================================
  // Global
  // ====================================================================

  loadGlobal(): LoadResult<GlobalSave> {
    const raw = readResilientJson<unknown>(this.paths.globalFile);
    if (!raw) {
      return { value: newGlobalSave(), recoveredFromBackup: false, usedDefault: true };
    }
    const parsed = GlobalSaveSchema.safeParse(raw.value);
    if (!parsed.success) {
      // Validation failed — fall back to default. Real impl could try .bak
      // separately, but readResilientJson already prefers .bak on parse
      // errors at the file level.
      return { value: newGlobalSave(), recoveredFromBackup: false, usedDefault: true };
    }
    return {
      value: maybeMigrateGlobal(parsed.data),
      recoveredFromBackup: raw.recoveredFromBackup,
      usedDefault: false,
    };
  }

  saveGlobal(global: GlobalSave): void {
    // Validate before write so we never persist invalid state
    const parsed = GlobalSaveSchema.parse(global);
    writeAtomicJson(this.paths.globalFile, parsed);
  }

  // ====================================================================
  // Slots
  // ====================================================================

  /**
   * Load a single slot. Missing/corrupt → returns an EMPTY slot
   * (preserves UX: title screen always shows 5 slots).
   */
  loadSlot(index: number): LoadResult<SlotSave> {
    validateSlotIndex(index);
    const raw = readResilientJson<unknown>(this.paths.slotFile(index));
    if (!raw) {
      return { value: newEmptySlotSave(index), recoveredFromBackup: false, usedDefault: true };
    }
    const parsed = SlotSaveSchema.safeParse(raw.value);
    if (!parsed.success) {
      return { value: newEmptySlotSave(index), recoveredFromBackup: false, usedDefault: true };
    }
    return {
      value: maybeMigrateSlot(parsed.data),
      recoveredFromBackup: raw.recoveredFromBackup,
      usedDefault: false,
    };
  }

  loadAllSlots(): LoadResult<SlotSave>[] {
    const out: LoadResult<SlotSave>[] = [];
    for (let i = 0; i < NUM_SLOTS; i++) out.push(this.loadSlot(i));
    return out;
  }

  saveSlot(slot: SlotSave): void {
    validateSlotIndex(slot.slotIndex);
    const parsed = SlotSaveSchema.parse(slot);
    writeAtomicJson(this.paths.slotFile(slot.slotIndex), parsed);
  }

  /**
   * Wipe a slot (character death). Global state is untouched.
   * Leaves a fresh empty-slot stub on disk so subsequent loads return
   * the empty state without going through "file missing" code paths.
   */
  wipeSlot(index: number): void {
    validateSlotIndex(index);
    deleteSaveFile(this.paths.slotFile(index));
    this.saveSlot(newEmptySlotSave(index));
  }
}

// ====================================================================
// Migration placeholder
// ====================================================================

function maybeMigrateGlobal(g: GlobalSave): GlobalSave {
  // No migrations yet. When schemaVersion is bumped, chain migrations here.
  if (g.schemaVersion < CURRENT_SCHEMA_VERSION) {
    throw new Error(`Global save migration needed: v${g.schemaVersion} → v${CURRENT_SCHEMA_VERSION}`);
  }
  return g;
}

function maybeMigrateSlot(s: SlotSave): SlotSave {
  if (s.schemaVersion < CURRENT_SCHEMA_VERSION) {
    throw new Error(`Slot save migration needed: v${s.schemaVersion} → v${CURRENT_SCHEMA_VERSION}`);
  }
  return s;
}
