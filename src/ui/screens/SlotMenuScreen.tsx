import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useDispatch, useGame } from '../EngineContext.js';
import { FocusList, type FocusListItem } from '../layout/FocusList.js';
import { ThreeBoxLayout } from '../layout/ThreeBoxLayout.js';

/**
 * Slot menu — empty vs occupied branches.
 *
 *   empty:
 *     > 새로 시작
 *       ← 돌아가기
 *
 *   occupied:
 *     > 이어하기
 *       새로 시작  (확인 후 덮어쓰기)
 *       ← 돌아가기
 */

export interface SlotMenuScreenProps {
  slotIndex: number;
  onBack: () => void;
  onNewCharacter: (slotIndex: number) => void;
  onContinue: (slotIndex: number) => void;
}

type Action = 'continue' | 'new' | 'back';

export function SlotMenuScreen({
  slotIndex,
  onBack,
  onNewCharacter,
  onContinue,
}: SlotMenuScreenProps): React.ReactElement {
  const game = useGame();
  const dispatch = useDispatch();
  const slot = game.state.slots[slotIndex]!;
  const [confirmingOverwrite, setConfirmingOverwrite] = useState(false);

  const items: FocusListItem<Action>[] = slot.state === 'empty'
    ? [
      { id: 'new',  label: '새로 시작', value: 'new' },
      { id: 'back', label: '← 돌아가기', value: 'back' },
    ]
    : [
      { id: 'cont', label: '이어하기',  value: 'continue' },
      { id: 'new',  label: '새로 시작 (기존 데이터 삭제)', value: 'new' },
      { id: 'back', label: '← 돌아가기', value: 'back' },
    ];

  if (confirmingOverwrite) {
    return (
      <ThreeBoxLayout
        title={`슬롯 ${slotIndex + 1} — 덮어쓰기 확인`}
        main={
          <Box flexDirection="column">
            <Text color="red">⚠ 기존 캐릭터 데이터가 사라집니다.</Text>
            <Text>"{slot.characterName ?? '?'}" 의 진행 상황이 즉시 삭제됩니다.</Text>
            <Text dimColor>인벤토리/메타 골드/패시브 스킬은 유지됩니다.</Text>
          </Box>
        }
        bottom={
          <FocusList
            items={[
              { id: 'no',  label: '취소',          value: 'no' as const },
              { id: 'yes', label: '확인 — 진행', value: 'yes' as const },
            ]}
            onSelect={item => {
              if (item.value === 'yes') {
                dispatch(() => game.deleteSlot(slotIndex));
                onNewCharacter(slotIndex);
              } else {
                setConfirmingOverwrite(false);
              }
            }}
            onCancel={() => setConfirmingOverwrite(false)}
          />
        }
        right={null}
      />
    );
  }

  return (
    <ThreeBoxLayout
      title={`슬롯 ${slotIndex + 1}`}
      main={
        <Box flexDirection="column">
          {slot.state === 'empty' ? (
            <Text dimColor>(빈 슬롯)</Text>
          ) : (
            <>
              <Text bold>{slot.characterName ?? '?'}</Text>
              <Text>난이도: Lv {slot.difficultyLevel}</Text>
              <Text>상태: {slot.state}</Text>
              {slot.character && (
                <Text>HP {slot.character.hp}/{slot.character.maxHp}</Text>
              )}
              <Text>스킬: {slot.skillIds.length}개</Text>
            </>
          )}
          <Box marginTop={1}>
            <FocusList
              items={items}
              onSelect={item => {
                if (item.value === 'back') onBack();
                else if (item.value === 'continue') {
                  dispatch(() => game.selectSlot(slotIndex));
                  onContinue(slotIndex);
                } else if (item.value === 'new') {
                  if (slot.state === 'empty') {
                    onNewCharacter(slotIndex);
                  } else {
                    setConfirmingOverwrite(true);
                  }
                }
              }}
              onCancel={onBack}
            />
          </Box>
        </Box>
      }
      bottom={
        <Text dimColor>↑↓ 선택  Enter 확정  Esc 돌아가기</Text>
      }
      right={null}
    />
  );
}
