import React, { useState } from 'react';
import { Box, Text, useApp } from 'ink';
import { join } from 'node:path';
import { EngineProvider, useGame } from './EngineContext.js';
import { TitleScreen } from './screens/TitleScreen.js';
import { SlotMenuScreen } from './screens/SlotMenuScreen.js';
import { NewCharacterScreen } from './screens/NewCharacterScreen.js';
import { StartPhaseScreen } from './screens/StartPhaseScreen.js';
import { MapScreen } from './screens/MapScreen.js';
import { EventScreen } from './screens/EventScreen.js';
import { CombatScreen } from './screens/CombatScreen.js';
import { RestHubScreen } from './screens/RestHubScreen.js';
import { RewardScreen } from './screens/RewardScreen.js';
import { DeathScreen } from './screens/DeathScreen.js';
import { Game, type SerializedSession } from '../engine/integration/game.js';
import { makeDemoRegistries } from '../data/demo.js';
import { makeSavePaths } from '../save/paths.js';
import { readResilientJson, writeAtomicJson } from '../save/atomic.js';

/**
 * App — top-level router.
 *
 * Two-level routing:
 *   1. `Screen` enum: title / slot menu / new character / playing
 *   2. When playing: PlayingRouter reads slot.state + run.activity to
 *      pick the in-game screen (start phase / map / event / combat / rest)
 */

type Screen =
  | { kind: 'title' }
  | { kind: 'slotMenu'; slotIndex: number }
  | { kind: 'newCharacter'; slotIndex: number }
  | { kind: 'playing'; slotIndex: number };

const SAVE_FILE = join(makeSavePaths().root, 'session.json');

function loadOrCreateGame(): Game {
  const game = new Game({
    registries: makeDemoRegistries(),
    rngSeed: `demo-${Date.now()}`,
  });
  try {
    const raw = readResilientJson<SerializedSession>(SAVE_FILE);
    if (raw) {
      game.deserialize(raw.value);
    }
  } catch (e) {
    // Bad save → start fresh (game state already initialized in ctor)
    // eslint-disable-next-line no-console
    console.error('Failed to load save, starting fresh:', e);
  }
  return game;
}

function persist(game: Game): void {
  writeAtomicJson(SAVE_FILE, game.serialize());
}

export function App(): React.ReactElement {
  const [game] = useState(loadOrCreateGame);

  return (
    <EngineProvider game={game} onAfterDispatch={persist}>
      <Router />
    </EngineProvider>
  );
}

function Router(): React.ReactElement {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>({ kind: 'title' });

  switch (screen.kind) {
    case 'title':
      return (
        <TitleScreen
          onSlotChosen={i => setScreen({ kind: 'slotMenu', slotIndex: i })}
          onExit={exit}
        />
      );
    case 'slotMenu':
      return (
        <SlotMenuScreen
          slotIndex={screen.slotIndex}
          onBack={() => setScreen({ kind: 'title' })}
          onNewCharacter={i => setScreen({ kind: 'newCharacter', slotIndex: i })}
          onContinue={i => setScreen({ kind: 'playing', slotIndex: i })}
        />
      );
    case 'newCharacter':
      return (
        <NewCharacterScreen
          slotIndex={screen.slotIndex}
          onCancel={() => setScreen({ kind: 'slotMenu', slotIndex: screen.slotIndex })}
          onCreated={i => setScreen({ kind: 'playing', slotIndex: i })}
        />
      );
    case 'playing':
      return (
        <PlayingRouter
          slotIndex={screen.slotIndex}
          onBackToTitle={() => setScreen({ kind: 'title' })}
        />
      );
  }
}

/**
 * PlayingRouter — derives the in-game screen from current slot + run state.
 * Re-evaluates on every render (since useGame() returns the singleton
 * and EngineProvider drives re-renders on dispatch).
 */
function PlayingRouter({
  slotIndex,
  onBackToTitle,
}: {
  slotIndex: number;
  onBackToTitle: () => void;
}): React.ReactElement {
  const game = useGame();
  const slot = game.state.slots[slotIndex]!;

  // Death wipe → back to title automatically
  React.useEffect(() => {
    if (slot.state === 'empty') {
      onBackToTitle();
    }
  }, [slot.state, onBackToTitle]);

  if (slot.state === 'empty') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">캐릭터가 사망했습니다.</Text>
        <Text dimColor>타이틀로 돌아갑니다…</Text>
      </Box>
    );
  }

  if (slot.state === 'inStartPhase') {
    return <StartPhaseScreen onEnteredDungeon={() => { /* re-render covers transition */ }} />;
  }

  if (slot.state === 'atRest') {
    return <RestHubScreen onBackToTitle={onBackToTitle} />;
  }

  if (slot.state === 'inRun') {
    const run = game.state.run;
    if (!run) {
      return <Text color="red">Inconsistent state: inRun but no run object</Text>;
    }
    switch (run.activity.kind) {
      case 'inMap':      return <MapScreen />;
      case 'inEvent':    return <EventScreen />;
      case 'inCombat':   return <CombatScreen />;
      case 'rewardPick': return <RewardScreen />;
      case 'gameOver':   return <DeathScreen onAcknowledged={onBackToTitle} />;
    }
  }

  return <Text dimColor>(unknown slot state)</Text>;
}
