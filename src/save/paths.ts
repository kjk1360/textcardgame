import envPaths from 'env-paths';
import { join } from 'node:path';

/**
 * Cross-platform save file paths.
 *
 * Locations (per `env-paths`):
 *   Windows: %APPDATA%\textcrawlergame\
 *   macOS:   ~/Library/Application Support/textcrawlergame/
 *   Linux:   ~/.local/share/textcrawlergame/
 *
 * Layout:
 *   {dataDir}/
 *   ├── global.json              (+ .bak after first overwrite)
 *   ├── slots/
 *   │   ├── slot1.json
 *   │   ├── slot1.json.bak
 *   │   ├── slot2.json
 *   │   └── ...
 *   └── _meta/version.txt
 */

const APP_NAME = 'textcrawlergame';
export const NUM_SLOTS = 5;

export interface SavePaths {
  readonly root: string;
  readonly globalFile: string;
  readonly slotsDir: string;
  readonly metaDir: string;
  slotFile(index: number): string;
}

/**
 * Build the canonical SavePaths struct.
 *
 * `override` lets tests + dev mode redirect to a temp dir.
 */
export function makeSavePaths(override?: string): SavePaths {
  const root = override ?? envPaths(APP_NAME, { suffix: '' }).data;
  return {
    root,
    globalFile: join(root, 'global.json'),
    slotsDir:   join(root, 'slots'),
    metaDir:    join(root, '_meta'),
    slotFile(index: number) {
      validateSlotIndex(index);
      return join(root, 'slots', `slot${index + 1}.json`);
    },
  };
}

export function validateSlotIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= NUM_SLOTS) {
    throw new RangeError(
      `Slot index out of range: ${index}. Valid: 0..${NUM_SLOTS - 1}`,
    );
  }
}
