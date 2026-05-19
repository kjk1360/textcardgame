import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

/**
 * Atomic file IO helpers — survive process crash mid-write.
 *
 * `writeAtomicJson` strategy:
 *   1. Write to `${path}.tmp`
 *   2. fsync the tmp file (durability)
 *   3. If destination exists, rename existing to `${path}.bak`
 *   4. Rename tmp → destination
 *
 * If a crash happens between (3) and (4), the user can read .bak (and
 * readResilient does this transparently on parse failure).
 *
 * `readResilientJson` strategy:
 *   - try main file
 *   - on parse failure, fall back to .bak (warn caller via console)
 *
 * No assumptions about content shape — caller validates after read
 * (typically Zod parse).
 */

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function writeAtomicJson(path: string, value: unknown): void {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp`;
  const json = JSON.stringify(value, null, 2);
  writeFileSync(tmp, json, 'utf8');

  // Force fsync for durability
  const fd = openSync(tmp, 'r+');
  try { fsyncSync(fd); } finally { closeSync(fd); }

  // Backup existing
  if (existsSync(path)) {
    const bak = `${path}.bak`;
    // Best-effort: if bak rename fails (concurrent access etc.), let
    // it throw so we don't silently lose the old data.
    if (existsSync(bak)) unlinkSync(bak);
    renameSync(path, bak);
  }
  renameSync(tmp, path);
}

export interface ReadResult<T> {
  readonly value: T;
  /** True when value came from .bak after main file failed to parse. */
  readonly recoveredFromBackup: boolean;
}

export function readResilientJson<T = unknown>(path: string): ReadResult<T> | null {
  if (!existsSync(path)) {
    // Try backup as last resort
    const bak = `${path}.bak`;
    if (existsSync(bak)) {
      try {
        const raw = readFileSync(bak, 'utf8');
        return { value: JSON.parse(raw) as T, recoveredFromBackup: true };
      } catch {
        return null;
      }
    }
    return null;
  }
  try {
    const raw = readFileSync(path, 'utf8');
    return { value: JSON.parse(raw) as T, recoveredFromBackup: false };
  } catch {
    // Main corrupt — try .bak
    const bak = `${path}.bak`;
    if (existsSync(bak)) {
      try {
        const raw = readFileSync(bak, 'utf8');
        const value = JSON.parse(raw) as T;
        // Restore main from bak so subsequent reads find it
        copyFileSync(bak, path);
        return { value, recoveredFromBackup: true };
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Delete a save file (and its backup). Idempotent.
 */
export function deleteSaveFile(path: string): void {
  if (existsSync(path)) unlinkSync(path);
  const bak = `${path}.bak`;
  if (existsSync(bak)) unlinkSync(bak);
}
