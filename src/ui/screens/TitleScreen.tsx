import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useDispatch, useGame } from '../EngineContext.js';
import { FocusList, type FocusListItem } from '../layout/FocusList.js';
import { ThreeBoxLayout } from '../layout/ThreeBoxLayout.js';
import type { SlotData } from '../../engine/integration/game.js';

/**
 * Title screen — slot list + system options.
 *
 * Layout:
 *   MAIN: header + slot list (focusable)
 *   RIGHT: focused slot details (HP / Lv / state)
 *   BOTTOM: input help
 */

export interface TitleScreenProps {
  onSlotChosen: (slotIndex: number) => void;
  onExit: () => void;
}

type TitleListValue =
  | { kind: 'slot'; slotIndex: number }
  | { kind: 'exit' };

export function TitleScreen({ onSlotChosen, onExit }: TitleScreenProps): React.ReactElement {
  const game = useGame();
  const _dispatch = useDispatch();
  void _dispatch;

  const [focused, setFocused] = useState<TitleListValue>({ kind: 'slot', slotIndex: 0 });

  const items: FocusListItem<TitleListValue>[] = [
    ...game.state.slots.map<FocusListItem<TitleListValue>>(slot => ({
      id: `slot-${slot.slotIndex}`,
      label: formatSlotLabel(slot),
      value: { kind: 'slot', slotIndex: slot.slotIndex },
    })),
    { id: 'exit', label: '종료', value: { kind: 'exit' } },
  ];

  return (
    <ThreeBoxLayout
      title="🎴  textcrawlergame"
      main={
        <Box flexDirection="column">
          <Text color="gray">슬롯 5개 + 종료</Text>
          <Box marginTop={1}>
            <FocusList
              items={items}
              onFocusChange={item => setFocused(item?.value ?? { kind: 'exit' })}
              onSelect={item => {
                if (item.value.kind === 'slot') onSlotChosen(item.value.slotIndex);
                else onExit();
              }}
            />
          </Box>
        </Box>
      }
      right={<TitleRightPanel focused={focused} />}
      bottom={
        <Box flexDirection="column">
          <Text dimColor>↑↓ 선택  Enter 확정  Esc 뒤로</Text>
          <Text dimColor>
            메타 골드 {game.state.global.gold}G · 인벤 {game.state.global.inventory.cards.length}/
            {game.state.global.inventory.capacity}
          </Text>
        </Box>
      }
    />
  );
}

function TitleRightPanel({ focused }: { focused: TitleListValue }): React.ReactElement {
  const game = useGame();
  if (focused.kind === 'exit') {
    return (
      <Box flexDirection="column">
        <Text bold>종료</Text>
        <Text dimColor>저장 후 게임을 닫습니다.</Text>
      </Box>
    );
  }
  const slot = game.state.slots[focused.slotIndex];
  if (!slot) return <Text dimColor>(슬롯 없음)</Text>;
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">슬롯 {slot.slotIndex + 1}</Text>
      <Box marginTop={1} flexDirection="column">
        {slot.state === 'empty' ? (
          <Text dimColor>(빈 슬롯)</Text>
        ) : (
          <>
            <Text>이름: {slot.characterName ?? '?'}</Text>
            <Text>난이도: Lv {slot.difficultyLevel}</Text>
            <Text>상태: {labelForSlotState(slot)}</Text>
            {slot.character && (
              <Text>
                HP {slot.character.hp}/{slot.character.maxHp}
              </Text>
            )}
            <Text>보유 스킬: {slot.skillIds.length}</Text>
          </>
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Enter로 선택</Text>
      </Box>
    </Box>
  );
}

function formatSlotLabel(slot: SlotData): string {
  if (slot.state === 'empty') {
    return `슬롯 ${slot.slotIndex + 1}: (빈 슬롯)`;
  }
  const stateText = labelForSlotState(slot);
  return `슬롯 ${slot.slotIndex + 1}: ${slot.characterName ?? '?'} — Lv ${slot.difficultyLevel} (${stateText})`;
}

function labelForSlotState(slot: SlotData): string {
  switch (slot.state) {
    case 'empty':         return '빈 슬롯';
    case 'atRest':        return '휴식처';
    case 'inStartPhase':  return '시작 페이즈';
    case 'inRun':         return '탐험 중';
  }
}
