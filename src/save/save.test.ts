import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeSavePaths, NUM_SLOTS, validateSlotIndex } from './paths.js';
import {
  deleteSaveFile,
  readResilientJson,
  writeAtomicJson,
} from './atomic.js';
import {
  CURRENT_SCHEMA_VERSION,
  GlobalSaveSchema,
  SlotSaveSchema,
  newEmptySlotSave,
  newGlobalSave,
} from './schemas.js';
import { SaveStore } from './store.js';

// ====================================================================
// Test helpers
// ====================================================================

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'tcg-save-'));
}

function makeStore(): SaveStore {
  const root = makeTempDir();
  return new SaveStore(makeSavePaths(root));
}

// ====================================================================
// paths
// ====================================================================

describe('paths', () => {
  it('makeSavePaths(override) uses the override root', () => {
    const root = makeTempDir();
    const p = makeSavePaths(root);
    expect(p.root).toBe(root);
    expect(p.globalFile).toBe(join(root, 'global.json'));
    expect(p.slotFile(0)).toBe(join(root, 'slots', 'slot1.json'));
    expect(p.slotFile(4)).toBe(join(root, 'slots', 'slot5.json'));
    rmSync(root, { recursive: true, force: true });
  });

  it('validateSlotIndex rejects out-of-range', () => {
    expect(() => validateSlotIndex(-1)).toThrow();
    expect(() => validateSlotIndex(NUM_SLOTS)).toThrow();
    expect(() => validateSlotIndex(1.5)).toThrow();
  });

  it('makeSavePaths default uses env-paths (smoke)', () => {
    const p = makeSavePaths();
    expect(p.root.length).toBeGreaterThan(0);
    expect(p.globalFile.endsWith('global.json')).toBe(true);
  });
});

// ====================================================================
// atomic
// ====================================================================

describe('atomic IO', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('writeAtomicJson + readResilientJson round-trips', () => {
    const path = join(tmpDir, 'a.json');
    const value = { foo: 1, bar: 'two', arr: [1, 2, 3] };
    writeAtomicJson(path, value);
    const r = readResilientJson<typeof value>(path);
    expect(r?.value).toEqual(value);
    expect(r?.recoveredFromBackup).toBe(false);
  });

  it('writeAtomicJson creates parent directory', () => {
    const nested = join(tmpDir, 'a', 'b', 'c.json');
    writeAtomicJson(nested, { x: 1 });
    expect(existsSync(nested)).toBe(true);
  });

  it('second write creates .bak from previous content', () => {
    const path = join(tmpDir, 'v.json');
    writeAtomicJson(path, { v: 1 });
    writeAtomicJson(path, { v: 2 });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ v: 2 });
    expect(JSON.parse(readFileSync(`${path}.bak`, 'utf8'))).toEqual({ v: 1 });
  });

  it('readResilientJson returns null when nothing exists', () => {
    const r = readResilientJson(join(tmpDir, 'missing.json'));
    expect(r).toBeNull();
  });

  it('readResilientJson recovers from .bak when main is corrupt', () => {
    const path = join(tmpDir, 'recover.json');
    writeAtomicJson(path, { ok: true });
    writeAtomicJson(path, { ok: true, v: 2 });
    // Corrupt main
    writeFileSync(path, '{not valid json', 'utf8');
    const r = readResilientJson<{ ok: boolean }>(path);
    expect(r?.value.ok).toBe(true);
    expect(r?.recoveredFromBackup).toBe(true);
    // After recovery, main is restored from bak
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ ok: true });
  });

  it('readResilientJson falls back to .bak when only .bak exists', () => {
    const path = join(tmpDir, 'only-bak.json');
    writeFileSync(`${path}.bak`, JSON.stringify({ fromBak: true }), 'utf8');
    const r = readResilientJson<{ fromBak: boolean }>(path);
    expect(r?.value.fromBak).toBe(true);
    expect(r?.recoveredFromBackup).toBe(true);
  });

  it('deleteSaveFile removes main + .bak idempotently', () => {
    const path = join(tmpDir, 'del.json');
    writeAtomicJson(path, { a: 1 });
    writeAtomicJson(path, { a: 2 });
    expect(existsSync(path)).toBe(true);
    expect(existsSync(`${path}.bak`)).toBe(true);
    deleteSaveFile(path);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(`${path}.bak`)).toBe(false);
    // Calling again is a no-op
    expect(() => deleteSaveFile(path)).not.toThrow();
  });
});

// ====================================================================
// schemas
// ====================================================================

describe('schemas', () => {
  it('newGlobalSave is valid against GlobalSaveSchema', () => {
    const g = newGlobalSave();
    expect(GlobalSaveSchema.parse(g)).toEqual(g);
    expect(g.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('newEmptySlotSave is valid', () => {
    const s = newEmptySlotSave(0);
    expect(SlotSaveSchema.parse(s)).toEqual(s);
    expect(s.state.kind).toBe('empty');
  });

  it('GlobalSave rejects negative gold', () => {
    const bad = { ...newGlobalSave(), gold: -1 };
    expect(() => GlobalSaveSchema.parse(bad)).toThrow();
  });

  it('SlotSave rejects slotIndex out of range', () => {
    const bad = { ...newEmptySlotSave(0), slotIndex: 99 };
    expect(() => SlotSaveSchema.parse(bad)).toThrow();
  });

  it('Slot state discriminated union accepts all variants', () => {
    const variants = [
      { kind: 'empty' as const },
      { kind: 'atRest' as const },
      { kind: 'inStartPhase' as const },
      { kind: 'inRun' as const, run: { whatever: true } },
    ];
    for (const v of variants) {
      const s = { ...newEmptySlotSave(0), state: v };
      expect(() => SlotSaveSchema.parse(s)).not.toThrow();
    }
  });
});

// ====================================================================
// SaveStore — high-level
// ====================================================================

describe('SaveStore — global', () => {
  it('loadGlobal returns defaults when file missing', () => {
    const store = makeStore();
    const r = store.loadGlobal();
    expect(r.usedDefault).toBe(true);
    expect(r.value).toEqual(newGlobalSave());
    rmSync(store.paths.root, { recursive: true, force: true });
  });

  it('saveGlobal then loadGlobal round-trips', () => {
    const store = makeStore();
    const g = newGlobalSave();
    g.gold = 1234;
    g.passiveSkills = ['s_a', 's_b'];
    g.eventsCleared = ['e_x'];
    store.saveGlobal(g);
    const r = store.loadGlobal();
    expect(r.usedDefault).toBe(false);
    expect(r.value.gold).toBe(1234);
    expect(r.value.passiveSkills).toEqual(['s_a', 's_b']);
    rmSync(store.paths.root, { recursive: true, force: true });
  });

  it('loadGlobal returns defaults on validation failure', () => {
    const store = makeStore();
    writeFileSync(store.paths.globalFile, JSON.stringify({ bogus: true }), 'utf8');
    const r = store.loadGlobal();
    expect(r.usedDefault).toBe(true);
    rmSync(store.paths.root, { recursive: true, force: true });
  });

  it('loadGlobal recovers from backup on corrupt main', () => {
    const store = makeStore();
    store.saveGlobal(newGlobalSave());
    store.saveGlobal({ ...newGlobalSave(), gold: 50 });
    writeFileSync(store.paths.globalFile, 'corrupt!', 'utf8');
    const r = store.loadGlobal();
    expect(r.recoveredFromBackup).toBe(true);
    expect(r.value.gold).toBe(0); // original .bak was first save with gold=0
    rmSync(store.paths.root, { recursive: true, force: true });
  });

  it('saveGlobal validates before write (throws on bad input)', () => {
    const store = makeStore();
    const bad: any = { ...newGlobalSave(), gold: -10 };
    expect(() => store.saveGlobal(bad)).toThrow();
    rmSync(store.paths.root, { recursive: true, force: true });
  });
});

describe('SaveStore — slots', () => {
  it('loadSlot returns empty when missing', () => {
    const store = makeStore();
    const r = store.loadSlot(2);
    expect(r.usedDefault).toBe(true);
    expect(r.value.state.kind).toBe('empty');
    expect(r.value.slotIndex).toBe(2);
    rmSync(store.paths.root, { recursive: true, force: true });
  });

  it('saveSlot then loadSlot round-trips', () => {
    const store = makeStore();
    const s = newEmptySlotSave(1);
    s.characterName = 'Hero';
    s.difficultyLevel = 3;
    s.state = { kind: 'atRest' };
    store.saveSlot(s);
    const r = store.loadSlot(1);
    expect(r.usedDefault).toBe(false);
    expect(r.value.characterName).toBe('Hero');
    expect(r.value.difficultyLevel).toBe(3);
    expect(r.value.state.kind).toBe('atRest');
    rmSync(store.paths.root, { recursive: true, force: true });
  });

  it('loadAllSlots returns 5 entries', () => {
    const store = makeStore();
    const results = store.loadAllSlots();
    expect(results).toHaveLength(5);
    expect(results.every(r => r.value.state.kind === 'empty')).toBe(true);
    rmSync(store.paths.root, { recursive: true, force: true });
  });

  it('wipeSlot removes data + saves empty stub', () => {
    const store = makeStore();
    const s = newEmptySlotSave(0);
    s.characterName = 'Will-Die';
    store.saveSlot(s);
    store.wipeSlot(0);
    const r = store.loadSlot(0);
    expect(r.value.state.kind).toBe('empty');
    expect(r.value.characterName).toBeUndefined();
    rmSync(store.paths.root, { recursive: true, force: true });
  });

  it('saveSlot rejects out-of-range slotIndex', () => {
    const store = makeStore();
    const s: any = { ...newEmptySlotSave(0), slotIndex: 99 };
    expect(() => store.saveSlot(s)).toThrow();
    rmSync(store.paths.root, { recursive: true, force: true });
  });
});

describe('SaveStore — meta progression scenario', () => {
  it('character death wipes slot but preserves global', () => {
    const store = makeStore();
    // Global: 1000G, passive
    const g = newGlobalSave();
    g.gold = 1000;
    g.passiveSkills = ['lifesteal'];
    store.saveGlobal(g);

    // Slot 0: live character
    const slot = newEmptySlotSave(0);
    slot.characterName = 'Doomed';
    slot.difficultyLevel = 5;
    slot.state = { kind: 'inRun', run: { hp: 0 } };
    store.saveSlot(slot);

    // Death: wipe slot
    store.wipeSlot(0);

    // Slot is empty
    const slotR = store.loadSlot(0);
    expect(slotR.value.state.kind).toBe('empty');

    // Global preserved
    const globalR = store.loadGlobal();
    expect(globalR.value.gold).toBe(1000);
    expect(globalR.value.passiveSkills).toEqual(['lifesteal']);

    rmSync(store.paths.root, { recursive: true, force: true });
  });
});
