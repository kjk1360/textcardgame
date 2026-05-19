import React from 'react';
import { Box, Text } from 'ink';
import { useDispatch, useGame } from '../EngineContext.js';
import { FocusList, type FocusListItem } from '../layout/FocusList.js';
import { ThreeBoxLayout } from '../layout/ThreeBoxLayout.js';
import { purchaseSkillBox, type SkillGrade } from '../../engine/meta/skill-box.js';
import { affordableGrades } from '../../engine/meta/skill-box.js';

/**
 * Start Phase — gateway before entering the dungeon.
 *
 * Shows skill-box purchase options gated by current meta gold.
 * After choice (or skip), calls game.enterDungeon() which
 * triggers the first map node's event (여정의 시작).
 */

export interface StartPhaseScreenProps {
  onEnteredDungeon: () => void;
}

export function StartPhaseScreen({ onEnteredDungeon }: StartPhaseScreenProps): React.ReactElement {
  const game = useGame();
  const dispatch = useDispatch();

  const slot = game.state.slots[game.state.currentSlotIndex!]!;
  const allBoxes = game.registries.skillBoxes.all();
  const affordable = affordableGrades(game.state.global, game.registries.skillBoxes);

  type Item = { kind: 'box'; grade: SkillGrade } | { kind: 'skip' };

  const items: FocusListItem<Item>[] = [
    ...[...allBoxes]
      .sort((a, b) => a.priceGold - b.priceGold)
      .map<FocusListItem<Item>>(b => {
        const can = affordable.includes(b.grade);
        return {
          id: `box-${b.grade}`,
          label: `${gradeLabel(b.grade)} 상자 구매 (${b.priceGold}G)`,
          value: { kind: 'box', grade: b.grade },
          disabled: !can,
          disabledReason: !can ? `${b.priceGold}G 필요, 보유 ${game.state.global.gold}G` : undefined,
        };
      }),
    { id: 'skip', label: '구매하지 않고 출발', value: { kind: 'skip' } },
  ];

  const onSelect = (item: FocusListItem<Item>) => {
    dispatch(() => {
      if (item.value.kind === 'box') {
        const result = purchaseSkillBox(
          game.state.global,
          item.value.grade,
          game.registries.skillBoxes,
          game.rng,
        );
        if (result.ok) {
          slot.skillIds.push(result.skillId);
        }
      }
      game.enterDungeon({ deck: [] });
    });
    onEnteredDungeon();
  };

  return (
    <ThreeBoxLayout
      title={`${slot.characterName} — 시작 페이즈`}
      main={
        <Box flexDirection="column">
          <Text>차원의 안내자가 묻는다:</Text>
          <Text>"스킬 상자를 구매하겠는가?"</Text>
          <Box marginTop={1}>
            <Text dimColor>메타 골드: {game.state.global.gold}G</Text>
          </Box>
          <Box marginTop={1}>
            <FocusList items={items} onSelect={onSelect} />
          </Box>
        </Box>
      }
      bottom={
        <Text dimColor>↑↓ 선택  Enter 확정  (구매 후 즉시 출발)</Text>
      }
      right={
        <Box flexDirection="column">
          <Text bold color="cyan">시작 페이즈</Text>
          <Box marginTop={1} flexDirection="column">
            <Text>스킬 상자 = 무작위 스킬 1개 보상</Text>
            <Text>상자 등급이 높을수록 강한 스킬</Text>
            <Text>골드는 모든 슬롯에 공유됨</Text>
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>현재 보유:</Text>
            <Text dimColor>스킬 {slot.skillIds.length}개</Text>
            <Text dimColor>인벤 {game.state.global.inventory.cards.length}/{game.state.global.inventory.capacity}</Text>
          </Box>
        </Box>
      }
    />
  );
}

function gradeLabel(grade: SkillGrade): string {
  switch (grade) {
    case 'lowest':  return '최하급';
    case 'low':     return '하급';
    case 'mid':     return '중급';
    case 'high':    return '상급';
    case 'highest': return '최상급';
  }
}
