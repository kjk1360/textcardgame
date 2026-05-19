import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useDispatch, useGame } from '../EngineContext.js';
import { FocusList, type FocusListItem } from '../layout/FocusList.js';
import { ThreeBoxLayout } from '../layout/ThreeBoxLayout.js';
import type { SkillId } from '../../types/index.js';

/**
 * Final-boss reward screen — pick one of the character's eligible skills
 * to promote to a global永久 passive (applied to all current + future
 * characters).
 *
 * If no eligible skill: shows fallback gold notice + Enter to acknowledge.
 *
 * Either way, after confirmation the character retires (slot wipes).
 */

export interface PassivePromoteScreenProps {
  onCompleted: () => void;
}

export function PassivePromoteScreen({ onCompleted }: PassivePromoteScreenProps): React.ReactElement {
  const game = useGame();
  const dispatch = useDispatch();
  const run = game.state.run!;
  if (run.activity.kind !== 'passivePromote') {
    return <Text color="red">PassivePromoteScreen rendered outside passivePromote</Text>;
  }
  const activity = run.activity;
  const isFallback = activity.candidates.length === 0;

  const [focused, setFocused] = useState<SkillId | null>(activity.candidates[0] ?? null);

  // Hooks at the top — useInput always called, but only fires when fallback.
  useInput((_input, key) => {
    if (isFallback && key.return) {
      dispatch(() => game.choosePassivePromote(null));
      onCompleted();
    }
  });

  // Fallback path — no eligible skills
  if (isFallback) {
    return (
      <ThreeBoxLayout
        title="🏆 최종보스 격파"
        main={
          <Box flexDirection="column">
            <Text color="yellow" bold>차원의 핵심을 정복했다!</Text>
            <Box marginTop={1} flexDirection="column">
              <Text>영구화 가능한 스킬이 없어 대체 보상으로</Text>
              <Text>{activity.fallbackGold ?? 0}G 를 받았다.</Text>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>(캐릭터는 은퇴합니다.)</Text>
            </Box>
          </Box>
        }
        bottom={<Text dimColor>Enter ▶ 타이틀로</Text>}
        right={null}
      />
    );
  }

  // Choice path — pick a skill to make permanent
  const items: FocusListItem<SkillId>[] = activity.candidates.map(sid => ({
    id: sid,
    label: game.registries.skills.get(sid).name,
    value: sid,
  }));

  return (
    <ThreeBoxLayout
      title="🏆 최종보스 격파 — 스킬 영구화"
      main={
        <Box flexDirection="column">
          <Text color="yellow" bold>차원의 핵심을 정복했다!</Text>
          <Box marginTop={1}>
            <Text>아래 스킬 중 하나를 모든 캐릭터에게 영구 적용시킬 수 있습니다.</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>(이 캐릭터는 은퇴합니다.)</Text>
          </Box>
          <Box marginTop={1}>
            <FocusList
              items={items}
              onFocusChange={it => setFocused(it?.value ?? null)}
              onSelect={it => {
                dispatch(() => game.choosePassivePromote(it.value));
                onCompleted();
              }}
            />
          </Box>
        </Box>
      }
      bottom={<Text dimColor>↑↓ 선택  Enter 확정</Text>}
      right={focused ? (
        <Box flexDirection="column">
          <Text bold color="cyan">{game.registries.skills.get(focused).name}</Text>
          <Text>등급: {game.registries.skills.get(focused).grade}</Text>
          <Box marginTop={1}><Text>{game.registries.skills.get(focused).description}</Text></Box>
          <Box marginTop={1} flexDirection="column">
            <Text color="magenta">영구 패시브화 시:</Text>
            <Text dimColor>모든 슬롯 캐릭터에 자동 적용</Text>
            <Text dimColor>신규 캐릭터에도 적용</Text>
          </Box>
        </Box>
      ) : null}
    />
  );
}
