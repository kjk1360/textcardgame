import React from 'react';
import { Box, Text } from 'ink';
import { useGame } from '../EngineContext.js';

/**
 * SkillStrip — always-visible compact strip of the player's currently
 * held skills, intended for the top of any right-column panel.
 *
 * Shows skill names color-coded by grade, with passive-skill marker.
 * Renders nothing when there's no active character or no skills.
 */

export function SkillStrip(): React.ReactElement | null {
  const game = useGame();
  if (game.state.currentSlotIndex === null) return null;
  const slot = game.state.slots[game.state.currentSlotIndex]!;

  const characterSkills = slot.skillIds;
  const passives = game.state.global.passiveSkills;
  if (characterSkills.length === 0 && passives.length === 0) return null;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="magenta">보유 스킬</Text>
      {characterSkills.map(sid => {
        if (!game.registries.skills.has(sid)) return null;
        const def = game.registries.skills.get(sid);
        return (
          <Text key={sid} color={gradeColor(def.grade)}>· {def.name}</Text>
        );
      })}
      {passives.map(sid => {
        if (!game.registries.skills.has(sid)) return null;
        const def = game.registries.skills.get(sid);
        return (
          <Text key={`p-${sid}`} color="cyan">★ {def.name} (영구)</Text>
        );
      })}
    </Box>
  );
}

/**
 * RightPanelWithSkills — convenience wrapper that puts SkillStrip at the
 * top of the right column followed by the screen's own right content.
 */
export function RightPanelWithSkills({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <Box flexDirection="column">
      <SkillStrip />
      {children}
    </Box>
  );
}

function gradeColor(grade: string): string {
  switch (grade) {
    case 'lowest':  return 'gray';
    case 'low':     return 'white';
    case 'mid':     return 'yellow';
    case 'high':    return 'magenta';
    case 'highest': return 'red';
    default:        return 'white';
  }
}
