import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { EngineProvider, useGame } from './EngineContext.js';
import { TitleScreen } from './screens/TitleScreen.js';
import { SlotMenuScreen } from './screens/SlotMenuScreen.js';
import { NewCharacterScreen } from './screens/NewCharacterScreen.js';
import { Game } from '../engine/integration/game.js';
import { makeDemoRegistries } from '../data/demo.js';

/**
 * App — top-level router.
 *
 * Currently supports the title flow: title → slot menu → new character.
 * In-run flows (start phase / dungeon / combat / event / rest) are
 * scaffolded under construction; placeholder screens render until each
 * is wired.
 */

type Screen =
  | { kind: 'title' }
  | { kind: 'slotMenu'; slotIndex: number }
  | { kind: 'newCharacter'; slotIndex: number }
  | { kind: 'playing'; slotIndex: number };

export function App(): React.ReactElement {
  const [game] = useState(() => new Game({
    registries: makeDemoRegistries(),
    rngSeed: `demo-${Date.now()}`,
  }));

  return (
    <EngineProvider game={game}>
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
      return <PlayingPlaceholder slotIndex={screen.slotIndex} onBack={() => setScreen({ kind: 'title' })} />;
  }
}

/**
 * Placeholder screen for when a character is in-game. Subsequent UI
 * slices will replace this with start-phase / map / event / combat /
 * rest-hub screens.
 */
function PlayingPlaceholder({
  slotIndex,
  onBack,
}: {
  slotIndex: number;
  onBack: () => void;
}): React.ReactElement {
  const game = useGame();
  const slot = game.state.slots[slotIndex]!;
  // Esc back to title for now
  React.useEffect(() => {
    // no-op
  }, []);
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">슬롯 {slotIndex + 1} — {slot.characterName ?? '?'}</Text>
      <Text color="gray">상태: {slot.state}</Text>
      <Box marginTop={1}>
        <Text>탐험/전투/이벤트 화면은 다음 UI 슬라이스에서 추가됩니다.</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>(현재는 화면이 비어 있습니다 — Ctrl+C 또는 곧 추가될 화면 확인)</Text>
      </Box>
      <Box marginTop={1}>
        <PlaceholderBack onBack={onBack} />
      </Box>
    </Box>
  );
}

function PlaceholderBack({ onBack }: { onBack: () => void }): React.ReactElement {
  useInput((_input, key) => {
    if (key.escape) onBack();
  });
  return <Text dimColor>Esc → 타이틀로</Text>;
}
