import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useDispatch, useGame } from '../EngineContext.js';
import { FocusList, type FocusListItem } from '../layout/FocusList.js';
import { ThreeBoxLayout } from '../layout/ThreeBoxLayout.js';
import type { CardDefId } from '../../types/index.js';
import { RightPanelWithSkills } from '../layout/SkillStrip.js';

/**
 * Post-combat reward screen.
 *
 * Shows:
 *   - Gold earned
 *   - 3 card choices (sampled from POST_COMBAT_REWARD_POOL)
 *   - Skip option
 *
 * Right panel: focused card def detail.
 */

export function RewardScreen(): React.ReactElement {
  const game = useGame();
  const dispatch = useDispatch();
  const run = game.state.run!;
  if (run.activity.kind !== 'rewardPick') {
    return <Text color="red">RewardScreen rendered outside rewardPick activity</Text>;
  }

  const [focused, setFocused] = useState<CardDefId | null>(run.activity.choices[0] ?? null);

  const items: FocusListItem<CardDefId | null>[] = [
    ...run.activity.choices.map<FocusListItem<CardDefId | null>>(cid => ({
      id: cid,
      label: game.registries.cards.get(cid).name,
      value: cid,
    })),
    { id: '__skip__', label: '— 건너뛰기 —', value: null },
  ];

  return (
    <ThreeBoxLayout
      title="승리! 보상 선택"
      main={
        <Box flexDirection="column">
          <Text color="yellow">획득 골드: +{run.activity.goldEarned}G  (런 골드 {run.gold}G)</Text>
          <Box marginTop={1}>
            <Text>카드 1장 선택 또는 건너뛰기:</Text>
          </Box>
          <Box marginTop={1}>
            {run.activity.choices.length === 0 ? (
              <Text dimColor>(보상 카드 풀 비어있음 — 건너뛰기)</Text>
            ) : (
              <FocusList
                items={items}
                onSelect={it => dispatch(() => game.rewardPickCard(it.value))}
                onFocusChange={it => setFocused(it?.value ?? null)}
              />
            )}
          </Box>
        </Box>
      }
      bottom={<Text dimColor>↑↓ 선택  Enter 확정</Text>}
      right={<RightPanelWithSkills>{focused ? <CardDefDetail defId={focused} /> : null}</RightPanelWithSkills>}
    />
  );
}

function CardDefDetail({ defId }: { defId: CardDefId }): React.ReactElement {
  const game = useGame();
  const def = game.registries.cards.get(defId);
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">{def.name}</Text>
      <Text>비용: {def.cost.kind === 'fixed' ? def.cost.value : def.cost.kind}</Text>
      <Text>타입: {def.type}  타겟: {def.target.kind}</Text>
      <Text>희귀도: {def.rarity}</Text>
      <Box marginTop={1}><Text>{def.baseDescription}</Text></Box>
      {def.keywords.length > 0 && (
        <Box marginTop={1}><Text color="magenta">키워드: {def.keywords.join(', ')}</Text></Box>
      )}
    </Box>
  );
}
