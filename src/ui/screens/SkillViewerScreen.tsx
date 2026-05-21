import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useGame } from '../EngineContext.js';
import { FocusList, type FocusListItem } from '../layout/FocusList.js';
import { ThreeBoxLayout } from '../layout/ThreeBoxLayout.js';
import type { SkillId } from '../../types/index.js';

/**
 * SkillViewerScreen — K shortcut.
 *
 * Shows all skills the player currently has:
 *   - Character skills (slot.skillIds)
 *   - Permanent passive skills (global.passiveSkills)
 *
 * FocusList on the left, full skill detail (name + grade + hooks +
 * full description) on the right.
 *
 * Esc closes the viewer.
 */

export function SkillViewerScreen({ onClose }: { onClose: () => void }): React.ReactElement {
  const game = useGame();

  useInput((_input, key) => {
    if (key.escape) onClose();
  });

  if (game.state.currentSlotIndex === null) {
    // Should never render here, but stay safe.
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">활성 캐릭터가 없습니다.</Text>
        <Text dimColor>Esc로 닫기</Text>
      </Box>
    );
  }

  const slot = game.state.slots[game.state.currentSlotIndex]!;
  const characterSkills = slot.skillIds;
  const passives = game.state.global.passiveSkills;

  type Row =
    | { kind: 'skill'; sid: SkillId; isPassive: boolean }
    | { kind: 'back' };

  const items: FocusListItem<Row>[] = [];
  for (const sid of characterSkills) {
    if (!game.registries.skills.has(sid)) continue;
    items.push({
      id: `c-${sid}`,
      label: `· ${game.registries.skills.get(sid).name}`,
      value: { kind: 'skill', sid, isPassive: false },
    });
  }
  for (const sid of passives) {
    if (!game.registries.skills.has(sid)) continue;
    items.push({
      id: `p-${sid}`,
      label: `★ ${game.registries.skills.get(sid).name} (영구)`,
      value: { kind: 'skill', sid, isPassive: true },
    });
  }
  items.push({ id: '__back__', label: '← 닫기 (Esc)', value: { kind: 'back' } });

  const [focused, setFocused] = useState<{ sid: SkillId; isPassive: boolean } | null>(
    items[0]?.value.kind === 'skill'
      ? { sid: items[0].value.sid, isPassive: items[0].value.isPassive }
      : null,
  );

  return (
    <ThreeBoxLayout
      title={`스킬 구성 (캐릭터 ${characterSkills.length} / 영구 ${passives.length})`}
      main={
        <Box flexDirection="column">
          {items.length <= 1 ? (
            <Text dimColor>보유 스킬이 없습니다.</Text>
          ) : (
            <FocusList
              items={items}
              onSelect={it => {
                if (it.value.kind === 'back') onClose();
              }}
              onFocusChange={it => {
                if (!it) { setFocused(null); return; }
                if (it.value.kind === 'skill') {
                  setFocused({ sid: it.value.sid, isPassive: it.value.isPassive });
                } else {
                  setFocused(null);
                }
              }}
              onCancel={onClose}
            />
          )}
        </Box>
      }
      bottom={<Text dimColor>↑↓ 선택  Esc 닫기  · K 단축키로 호출됨</Text>}
      right={focused ? <SkillDetail sid={focused.sid} isPassive={focused.isPassive} /> : null}
    />
  );
}

function SkillDetail({ sid, isPassive }: { sid: SkillId; isPassive: boolean }): React.ReactElement {
  const game = useGame();
  const def = game.registries.skills.get(sid);
  return (
    <Box flexDirection="column">
      <Text bold color={isPassive ? 'cyan' : gradeColor(def.grade)}>{def.name}</Text>
      <Text>등급: {def.grade}{isPassive ? '  (영구)' : ''}</Text>
      <Box marginTop={1}><Text>{def.description}</Text></Box>
      {def.hooks && def.hooks.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>훅:</Text>
          {def.hooks.map((h, i) => (
            <Text key={i} dimColor>· {h.on}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

function gradeColor(grade: string): string {
  switch (grade) {
    case 'common':    return 'white';
    case 'rare':      return 'yellow';
    case 'legendary': return 'magenta';
    default:          return 'white';
  }
}
