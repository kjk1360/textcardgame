import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
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
import { PassivePromoteScreen } from './screens/PassivePromoteScreen.js';
import { DeckViewerScreen } from './screens/DeckViewerScreen.js';
import { SkillViewerScreen } from './screens/SkillViewerScreen.js';
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
 *
 * Scene transitions: NONE. Ink can't layer-composite old/new content, so
 * any animated wipe/fade ends in a noticeable snap. Direct route swap
 * reads cleaner in practice — the player perceives the change via the
 * activity itself (combat panel vs map grid) rather than a CSS-style
 * transition that doesn't exist in terminals.
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
    // UI plays the death-fade animation on enemy portraits, so engine
    // must NOT auto-resolve combat — CombatScreen calls
    // game.finalizeCombatEnd() once the death fade completes.
    autoResolveCombat: false,
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

type ModalKind = 'deck' | 'skills' | null;

/**
 * PlayingRouter — derives the in-game screen from current slot + run state.
 *
 * Renders directly off `routeKey` (no shownKey delay, no transition view).
 * Modal viewers (D/K shortcuts) take over the whole frame when open.
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

  React.useEffect(() => {
    if (slot.state === 'empty') onBackToTitle();
  }, [slot.state, onBackToTitle]);

  const routeKey = computeRouteKey(slot, game.state.run);

  // D opens deck viewer, K opens skill viewer. When a modal is open we
  // suppress the global handler so the modal's own input wiring owns
  // the keyboard.
  const [modal, setModal] = React.useState<ModalKind>(null);
  useInput((input, _key) => {
    if (modal !== null) return;
    if (input === 'd' || input === 'D') setModal('deck');
    else if (input === 'k' || input === 'K') setModal('skills');
  });

  if (modal === 'deck')   return <DeckViewerScreen onClose={() => setModal(null)} />;
  if (modal === 'skills') return <SkillViewerScreen onClose={() => setModal(null)} />;

  return renderRoute(routeKey, slot.state, game, onBackToTitle);
}

function computeRouteKey(slot: { state: string }, run: { activity: { kind: string } } | null): string {
  if (slot.state === 'inRun' && run) return `inRun/${run.activity.kind}`;
  return slot.state;
}

function renderRoute(
  routeKey: string,
  _slotState: string,
  game: ReturnType<typeof useGame>,
  onBackToTitle: () => void,
): React.ReactElement {
  if (routeKey === 'empty') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">캐릭터가 사망했습니다.</Text>
        <Text dimColor>타이틀로 돌아갑니다…</Text>
      </Box>
    );
  }
  if (routeKey === 'inStartPhase') {
    return <StartPhaseScreen onEnteredDungeon={() => { /* state-driven rerender */ }} />;
  }
  if (routeKey === 'atRest') {
    return <RestHubScreen onBackToTitle={onBackToTitle} />;
  }
  const run = game.state.run;
  if (!run) return <Text color="red">Inconsistent state: inRun but no run object</Text>;
  switch (run.activity.kind) {
    case 'inMap':         return <MapScreen />;
    case 'inEvent':       return <EventScreen />;
    case 'inCombat':      return <CombatScreen />;
    case 'rewardPick':    return <RewardScreen />;
    case 'gameOver':      return <DeathScreen onAcknowledged={onBackToTitle} />;
    case 'passivePromote':return <PassivePromoteScreen onCompleted={onBackToTitle} />;
  }
  return <Text dimColor>(unknown route: {routeKey})</Text>;
}
