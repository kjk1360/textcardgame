import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useDispatch, useGame } from '../EngineContext.js';
import { ThreeBoxLayout } from '../layout/ThreeBoxLayout.js';

/**
 * New-character screen — ASCII text input for name + confirm.
 *
 * Controls:
 *   any printable key → append to name
 *   backspace → delete last
 *   Enter → if name is non-empty, create + continue
 *   Esc → cancel
 */

export interface NewCharacterScreenProps {
  slotIndex: number;
  onCancel: () => void;
  onCreated: (slotIndex: number) => void;
}

const NAME_MAX = 20;

export function NewCharacterScreen({
  slotIndex,
  onCancel,
  onCreated,
}: NewCharacterScreenProps): React.ReactElement {
  const game = useGame();
  const dispatch = useDispatch();
  const [name, setName] = useState('');

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      if (name.trim().length === 0) return;
      dispatch(() => game.createCharacter(slotIndex, name.trim()));
      onCreated(slotIndex);
      return;
    }
    if (key.backspace || key.delete) {
      setName(s => s.slice(0, -1));
      return;
    }
    // Only printable characters (filter ctrl, arrow keys, etc.)
    if (input && input.length === 1 && !key.ctrl && !key.meta && !key.shift && input >= ' ') {
      if (name.length < NAME_MAX) setName(s => s + input);
      return;
    }
    // Korean (and other multibyte) often comes in as multi-char input
    if (input && input.length > 1 && !key.ctrl && !key.meta) {
      if (name.length + input.length <= NAME_MAX) setName(s => s + input);
    }
  });

  return (
    <ThreeBoxLayout
      title={`슬롯 ${slotIndex + 1} — 새 캐릭터`}
      main={
        <Box flexDirection="column">
          <Text>캐릭터 이름을 입력하세요. (최대 {NAME_MAX}자)</Text>
          <Box marginTop={1}>
            <Text>이름: </Text>
            <Text color="cyan">{name}</Text>
            <Text color="cyan">█</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              {name.trim().length === 0
                ? '(이름을 입력하세요)'
                : 'Enter 로 시작'}
            </Text>
          </Box>
        </Box>
      }
      bottom={
        <Text dimColor>입력 후 Enter · Backspace 지움 · Esc 취소</Text>
      }
      right={null}
    />
  );
}
