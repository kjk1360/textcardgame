#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { render } from 'ink';
import updateNotifier from 'simple-update-notifier';
import { App } from './ui/App.js';

/**
 * Entry point. Exposed as `ccgame` bin in package.json.
 *
 * Distribution:
 *   `npm install -g ccgame` → run `ccgame` from anywhere.
 *   `ccgame --version` prints the installed version.
 *   `ccgame --help` prints usage.
 *
 * Update flow:
 *   Each launch checks the npm registry (cached daily) and prints a
 *   banner if a newer version is available. Run
 *   `npm install -g ccgame@latest` to actually pull it.
 */

const pkg = loadPackageJson();

const argv = process.argv.slice(2);
if (argv.includes('--version') || argv.includes('-v')) {
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}
if (argv.includes('--help') || argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

// Update notification — fire-and-forget. Won't block startup; the
// notifier caches to ~/.config so the network check runs at most once
// per day. If npm registry is unreachable, the promise just rejects
// silently.
try {
  void updateNotifier({ pkg, updateCheckInterval: 1000 * 60 * 60 * 24 });
} catch {
  // Defensive: never let an update check abort game launch.
}

render(<App />);

// ====================================================================
// Helpers
// ====================================================================

function loadPackageJson(): { name: string; version: string; bin?: Record<string, string> } {
  // dist/cli.js sits in `<pkg-root>/dist/`; package.json is one level up.
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(__dirname, '..', 'package.json');
  return JSON.parse(readFileSync(pkgPath, 'utf8'));
}

function printHelp(): void {
  process.stdout.write(`\
ccgame — text-based TCG/RPG dungeon crawler

Usage:
  ccgame                       Launch the game
  ccgame --version, -v         Print installed version
  ccgame --help, -h            Print this help

Update:
  npm install -g ccgame@latest

Issues / source:
  https://github.com/kjk1360/textcardgame
`);
}
