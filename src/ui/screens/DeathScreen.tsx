import React from 'react';
import { Box, Text, useInput } from 'ink';
import { useDispatch, useGame } from '../EngineContext.js';
import { ThreeBoxLayout } from '../layout/ThreeBoxLayout.js';

/**
 * Death / game-over screen — shown after combat loss, before the slot
 * is wiped. Player presses Enter to acknowledge, then global state
 * (gold, inventory, passives) carries over to a fresh character.
 */

export interface DeathScreenProps {
  onAcknowledged: () => void;
}

export function DeathScreen({ onAcknowledged }: DeathScreenProps): React.ReactElement {
  const game = useGame();
  const dispatch = useDispatch();
  const slot = game.state.slots[game.state.currentSlotIndex!]!;
  const run = game.state.run;

  useInput((_input, key) => {
    if (key.return) {
      dispatch(() => game.acknowledgeGameOver());
      onAcknowledged();
    }
  });

  const stats = run?.activity.kind === 'gameOver' ? run.activity.runStatsSnapshot : null;

  return (
    <ThreeBoxLayout
      title="💀 사망"
      main={
        <Box flexDirection="column">
          <Text color="red" bold>{slot.characterName ?? '?'} 이/가 쓰러졌다.</Text>
          <Box marginTop={1} flexDirection="column">
            {stats ? (
              <>
                <Text>도달 난이도: Lv {stats.difficultyReached}</Text>
                <Text>방문 노드: {stats.nodesVisited}칸</Text>
                <Text>휴대 카드: {stats.cardsCarried}장 (모두 손실)</Text>
              </>
            ) : (
              <Text dimColor>(통계 없음)</Text>
            )}
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>—</Text>
            <Text>유지되는 것:</Text>
            <Text dimColor>· 메타 골드 {game.state.global.gold}G</Text>
            <Text dimColor>· 차원 창고 카드 {game.state.global.inventory.cards.length}장</Text>
            <Text dimColor>· 영구 패시브 스킬 {game.state.global.passiveSkills.length}개</Text>
          </Box>
        </Box>
      }
      bottom={<Text dimColor>Enter ▶ 타이틀로</Text>}
      right={null}
    />
  );
}
