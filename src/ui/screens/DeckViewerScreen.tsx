import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useGame } from '../EngineContext.js';
import { FocusList, type FocusListItem } from '../layout/FocusList.js';
import { ThreeBoxLayout } from '../layout/ThreeBoxLayout.js';
import { resolveCardEffects } from '../../engine/modifiers/resolver.js';
import { formatEffectPreview } from '../helpers/card-preview.js';
import { gradeColor, wrapWithGradeBrackets } from '../helpers/grade-style.js';
import type { CardInstance, PlayerActor } from '../../types/index.js';

/**
 * DeckViewerScreen — D shortcut.
 *
 * Shows all cards the player currently owns:
 *   - All cards in the current run (master deck list — during combat this
 *     means union of hand+drawPile+discardPile+exhaustPile; outside combat,
 *     run.deck)
 *   - All cards stored in the meta inventory
 *
 * FocusList on the left, full card detail on the right (mirrors the
 * combat hand-detail panel including the predicted-value preview when
 * a player actor is available).
 *
 * Esc closes the viewer.
 */

export function DeckViewerScreen({ onClose }: { onClose: () => void }): React.ReactElement {
  const game = useGame();
  const run = game.state.run;
  const inventoryCards = game.state.global.inventory.cards;
  const player = pickActivePlayer(game);

  const runCards: ReadonlyArray<CardInstance> = (() => {
    if (!run) return [];
    if (run.activity.kind === 'inCombat') {
      const p = run.activity.piles;
      return [...p.hand, ...p.drawPile, ...p.discardPile, ...p.exhaustPile];
    }
    return run.deck;
  })();

  type Row =
    | { kind: 'card'; card: CardInstance; origin: 'run' | 'inv' }
    | { kind: 'back' };

  const items: FocusListItem<Row>[] = [];
  for (const card of runCards) {
    const def = game.registries.cards.get(card.defId);
    const stars = card.modifiers.length > 0 ? ` +${card.modifiers.length}` : '';
    items.push({
      id: `r-${card.instanceId}`,
      label: `[런] ${wrapWithGradeBrackets(def.name, def.rarity)}${stars}`,
      color: gradeColor(def.rarity),
      value: { kind: 'card', card, origin: 'run' },
    });
  }
  for (const card of inventoryCards) {
    const def = game.registries.cards.get(card.defId);
    const stars = card.modifiers.length > 0 ? ` +${card.modifiers.length}` : '';
    items.push({
      id: `i-${card.instanceId}`,
      label: `[인벤] ${wrapWithGradeBrackets(def.name, def.rarity)}${stars}`,
      color: gradeColor(def.rarity),
      value: { kind: 'card', card, origin: 'inv' },
    });
  }
  items.push({ id: '__back__', label: '← 닫기 (Esc)', value: { kind: 'back' } });

  const [focused, setFocused] = useState<CardInstance | null>(
    items[0]?.value.kind === 'card' ? items[0].value.card : null,
  );

  useInput((_input, key) => {
    if (key.escape) onClose();
  });

  return (
    <ThreeBoxLayout
      title={`덱 구성 (런 ${runCards.length} / 인벤 ${inventoryCards.length})`}
      main={
        <Box flexDirection="column">
          {items.length <= 1 ? (
            <Text dimColor>표시할 카드가 없습니다.</Text>
          ) : (
            <FocusList
              items={items}
              onSelect={it => {
                if (it.value.kind === 'back') onClose();
              }}
              onFocusChange={it => {
                if (!it) { setFocused(null); return; }
                setFocused(it.value.kind === 'card' ? it.value.card : null);
              }}
              onCancel={onClose}
            />
          )}
        </Box>
      }
      bottom={<Text dimColor>↑↓ 선택  Esc 닫기  · D 단축키로 호출됨</Text>}
      right={focused ? <CardDetail card={focused} player={player} /> : null}
    />
  );
}

function CardDetail({
  card,
  player,
}: {
  card: CardInstance;
  player: PlayerActor | null;
}): React.ReactElement {
  const game = useGame();
  const def = game.registries.cards.get(card.defId);
  const resolved = resolveCardEffects(def, card, game.registries.modifiers);
  const previews = player
    ? resolved.effects
        .map(eff => formatEffectPreview(eff, player, game.registries.statuses))
        .filter((s): s is string => s !== null)
    : [];
  return (
    <Box flexDirection="column">
      <Text bold color={gradeColor(def.rarity)}>
        {wrapWithGradeBrackets(def.name, def.rarity)}
      </Text>
      <Text>비용: {resolved.cost.kind === 'fixed' ? resolved.cost.value : resolved.cost.kind}</Text>
      <Text>타입: {def.type}  타겟: {def.target.kind}</Text>
      <Text>등급: {def.rarity}</Text>
      <Box marginTop={1}><Text>{def.baseDescription}</Text></Box>
      {previews.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color="green">예상 효과 (현재 버프 기준)</Text>
          {previews.map((line, i) => (
            <Text key={i} color="green">▸ {line}</Text>
          ))}
        </Box>
      )}
      {resolved.keywords.length > 0 && (
        <Box marginTop={1}><Text color="magenta">{resolved.keywords.join(', ')}</Text></Box>
      )}
      {card.modifiers.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text color="magenta">강화 ({card.modifiers.length}):</Text>
          {card.modifiers.map((m, i) => (
            <Text key={i} color="magenta">• {game.registries.modifiers.get(m.id).name}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

function pickActivePlayer(game: ReturnType<typeof useGame>): PlayerActor | null {
  if (game.state.currentSlotIndex === null) return null;
  const slot = game.state.slots[game.state.currentSlotIndex]!;
  return slot.character ?? null;
}
