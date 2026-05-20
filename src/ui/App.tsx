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
    // UI plays death-fade + transition animations, so engine must NOT
    // auto-resolve. The CombatScreen calls game.finalizeCombatEnd() once
    // the death animation completes.
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

/** ms between unmounting the old screen and mounting the new one (cross-fade) */
const TRANSITION_MS = 300;

/**
 * PlayingRouter — derives the in-game screen from current slot + run state.
 * Wraps screen swaps in a 0.3s fade so the player sees a beat between
 * map → event, combat → reward, etc., instead of an instant snap.
 */
type ModalKind = 'deck' | 'skills' | null;

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

  // Track which route is currently "shown". When routeKey changes,
  // play a brief fade-out, then update shown to match.
  const [shownKey, setShownKey] = React.useState(routeKey);
  const [transitioning, setTransitioning] = React.useState(false);

  React.useEffect(() => {
    if (routeKey === shownKey) return;
    setTransitioning(true);
    const t = setTimeout(() => {
      setShownKey(routeKey);
      setTransitioning(false);
    }, TRANSITION_MS);
    return () => clearTimeout(t);
  }, [routeKey, shownKey]);

  // Modal overlays for shortcut keys (D = deck, K = skills). Captures
  // 'd'/'k' globally while in-run; suppressed during transitions and
  // when another modal is already open so the modal's own input handler
  // owns the keyboard.
  const [modal, setModal] = React.useState<ModalKind>(null);
  useInput((input, _key) => {
    if (transitioning) return;
    if (modal !== null) return;
    if (input === 'd' || input === 'D') setModal('deck');
    else if (input === 'k' || input === 'K') setModal('skills');
  });

  if (modal === 'deck')   return <DeckViewerScreen onClose={() => setModal(null)} />;
  if (modal === 'skills') return <SkillViewerScreen onClose={() => setModal(null)} />;

  if (transitioning) {
    return <TransitionFade />;
  }

  return renderRoute(shownKey, slot.state, game, onBackToTitle);
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
    return <StartPhaseScreen onEnteredDungeon={() => { /* re-render covers transition */ }} />;
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

/** Light-gray placeholder shown for TRANSITION_MS between screens. */
function TransitionFade(): React.ReactElement {
  return (
    <Box flexDirection="column" justifyContent="center" alignItems="center" minHeight={20}>
      <Text color="gray" dimColor>… 전환 중 …</Text>
    </Box>
  );
}
