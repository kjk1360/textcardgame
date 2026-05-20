import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useDispatch, useGame } from '../EngineContext.js';
import { FocusList, type FocusListItem } from '../layout/FocusList.js';
import { ThreeBoxLayout } from '../layout/ThreeBoxLayout.js';
import { resolveCardEffects } from '../../engine/modifiers/resolver.js';
import { nextCapacityUpgrade, cardSellPrice } from '../../engine/meta/economy.js';
import { upgradeInventoryCapacity } from '../../engine/meta/inventory.js';
import type { CardInstance } from '../../types/index.js';
import { RightPanelWithSkills } from '../layout/SkillStrip.js';

/**
 * Rest Hub — non-paged menu, repeatable until 출발 chosen.
 *
 *   > 이번 런 카드 관리 (N장 미정리)
 *     인벤토리 보기
 *     인벤 용량 업그레이드 (다음: M칸 / KG)
 *     다음 차원문으로 출발
 *     타이틀로 (저장)
 */

type Mode =
  | { kind: 'menu' }
  | { kind: 'pendingDeck' }
  | { kind: 'inventory' };

export function RestHubScreen({ onBackToTitle }: { onBackToTitle: () => void }): React.ReactElement {
  const [mode, setMode] = useState<Mode>({ kind: 'menu' });

  switch (mode.kind) {
    case 'menu':       return <RestMenu setMode={setMode} onBackToTitle={onBackToTitle} />;
    case 'pendingDeck':return <PendingDeckView onBack={() => setMode({ kind: 'menu' })} />;
    case 'inventory':  return <InventoryView onBack={() => setMode({ kind: 'menu' })} />;
  }
}

// ====================================================================
// menu
// ====================================================================

type MenuAction = 'pending' | 'inventory' | 'upgrade' | 'depart' | 'title';

function RestMenu({
  setMode,
  onBackToTitle,
}: {
  setMode: (m: Mode) => void;
  onBackToTitle: () => void;
}): React.ReactElement {
  const game = useGame();
  const dispatch = useDispatch();
  const slot = game.state.slots[game.state.currentSlotIndex!]!;
  const pending = game.getRestHubPendingDeck();
  const nextUp = nextCapacityUpgrade(game.state.global.inventory.capacity);

  const items: FocusListItem<MenuAction>[] = [
    { id: 'pending',   label: `이번 런 카드 관리 (${pending.length}장 미정리)`, value: 'pending' },
    { id: 'inventory', label: `인벤토리 보기 (${game.state.global.inventory.cards.length}/${game.state.global.inventory.capacity})`, value: 'inventory' },
    {
      id: 'upgrade',
      label: nextUp
        ? `인벤 용량 업그레이드 → ${nextUp.toCapacity}칸 (${nextUp.costGold}G)`
        : `인벤 용량 업그레이드 (최대)`,
      value: 'upgrade',
      disabled: !nextUp || game.state.global.gold < nextUp.costGold,
      disabledReason: !nextUp ? '최대' : `${nextUp.costGold}G 필요, 보유 ${game.state.global.gold}G`,
    },
    { id: 'depart',    label: '다음 차원문으로 출발 →', value: 'depart' },
    { id: 'title',     label: '타이틀로 돌아가기 (자동 저장)', value: 'title' },
  ];

  return (
    <ThreeBoxLayout
      title={`휴식처 — ${slot.characterName ?? '?'}`}
      main={
        <Box flexDirection="column">
          <Text>난이도 Lv {slot.difficultyLevel}  ·  HP {slot.character?.hp}/{slot.character?.maxHp}</Text>
          <Text>메타 골드: {game.state.global.gold}G  ·  인벤: {game.state.global.inventory.cards.length}/{game.state.global.inventory.capacity}</Text>
          <Text>스킬: {slot.skillIds.length}개</Text>
          <Box marginTop={1}>
            <FocusList
              items={items}
              onSelect={it => {
                switch (it.value) {
                  case 'pending':   setMode({ kind: 'pendingDeck' }); break;
                  case 'inventory': setMode({ kind: 'inventory' }); break;
                  case 'upgrade':
                    dispatch(() => upgradeInventoryCapacity(game.state.global));
                    break;
                  case 'depart':
                    dispatch(() => {
                      // Auto-sell anything remaining undeposited
                      game.restAutoSellPendingDeck();
                      // Route through start phase so player can buy a skill box
                      // before entering. StartPhaseScreen will call enterDungeon.
                      slot.state = 'inStartPhase';
                    });
                    break;
                  case 'title':
                    onBackToTitle();
                    break;
                }
              }}
            />
          </Box>
        </Box>
      }
      bottom={<Text dimColor>↑↓ 선택  Enter 확정  · 출발 누르면 미보관 카드 자동 골드 환산</Text>}
      right={
        <RightPanelWithSkills>
          <Box flexDirection="column">
            <Text bold color="cyan">휴식처</Text>
            <Box marginTop={1} flexDirection="column">
              <Text>여기서는 자유롭게 메뉴 사용</Text>
              <Text>출발 누르기 전까지 반복 가능</Text>
            </Box>
            {pending.length > 0 && (
              <Box marginTop={1} flexDirection="column">
                <Text color="yellow">미정리 카드 {pending.length}장</Text>
                <Text dimColor>(출발 시 자동 골드 환산)</Text>
              </Box>
            )}
          </Box>
        </RightPanelWithSkills>
      }
    />
  );
}

// ====================================================================
// pending deck
// ====================================================================

function PendingDeckView({ onBack }: { onBack: () => void }): React.ReactElement {
  const game = useGame();
  const dispatch = useDispatch();
  const pending = game.getRestHubPendingDeck();
  const [focused, setFocused] = useState<CardInstance | null>(pending[0] ?? null);

  type Action = { kind: 'store'; card: CardInstance } | { kind: 'sell'; card: CardInstance } | { kind: 'back' };
  const items: FocusListItem<Action>[] = [];
  for (const card of pending) {
    const def = game.registries.cards.get(card.defId);
    const price = cardSellPrice(card, def);
    const stars = card.modifiers.length > 0 ? `+${card.modifiers.length}` : '';
    const invFull = game.state.global.inventory.cards.length >= game.state.global.inventory.capacity;
    items.push({
      id: `store-${card.instanceId}`,
      label: `[보관] ${def.name} ${stars}`,
      value: { kind: 'store', card },
      disabled: invFull,
      disabledReason: invFull ? '인벤 가득 참' : undefined,
    });
    items.push({
      id: `sell-${card.instanceId}`,
      label: `[판매] ${def.name} ${stars}  → ${price}G`,
      value: { kind: 'sell', card },
    });
  }
  items.push({ id: 'back', label: '← 메뉴', value: { kind: 'back' } });

  return (
    <ThreeBoxLayout
      title="이번 런 카드 관리"
      main={
        <Box flexDirection="column">
          {pending.length === 0 ? (
            <Text dimColor>관리할 카드 없음</Text>
          ) : (
            <FocusList
              items={items}
              onSelect={it => {
                if (it.value.kind === 'back') { onBack(); return; }
                dispatch(() => {
                  if (it.value.kind === 'store') game.restStoreCard(it.value.card.instanceId);
                  if (it.value.kind === 'sell')  game.restSellCard(it.value.card.instanceId, 'pendingDeck');
                });
              }}
              onFocusChange={it => {
                if (!it) return;
                if (it.value.kind === 'back') setFocused(null);
                else setFocused(it.value.card);
              }}
              onCancel={onBack}
            />
          )}
        </Box>
      }
      bottom={<Text dimColor>↑↓ 선택  Enter 확정  Esc 메뉴로</Text>}
      right={<RightPanelWithSkills>{focused ? <CardInstanceDetail card={focused} /> : null}</RightPanelWithSkills>}
    />
  );
}

// ====================================================================
// inventory
// ====================================================================

function InventoryView({ onBack }: { onBack: () => void }): React.ReactElement {
  const game = useGame();
  const dispatch = useDispatch();
  const inv = game.state.global.inventory.cards;
  const [focused, setFocused] = useState<CardInstance | null>(inv[0] ?? null);

  type Action = { kind: 'sell'; card: CardInstance } | { kind: 'back' };
  const items: FocusListItem<Action>[] = [];
  for (const card of inv) {
    const def = game.registries.cards.get(card.defId);
    const price = cardSellPrice(card, def);
    const stars = card.modifiers.length > 0 ? `+${card.modifiers.length}` : '';
    items.push({
      id: `sell-${card.instanceId}`,
      label: `[판매] ${def.name} ${stars}  → ${price}G`,
      value: { kind: 'sell', card },
    });
  }
  items.push({ id: 'back', label: '← 메뉴', value: { kind: 'back' } });

  return (
    <ThreeBoxLayout
      title={`인벤토리 (${inv.length}/${game.state.global.inventory.capacity})`}
      main={
        <Box flexDirection="column">
          {inv.length === 0 ? (
            <Text dimColor>인벤토리 비어있음</Text>
          ) : (
            <FocusList
              items={items}
              onSelect={it => {
                const v = it.value;
                if (v.kind === 'back') { onBack(); return; }
                dispatch(() => game.restSellCard(v.card.instanceId, 'inventory'));
              }}
              onFocusChange={it => {
                if (!it) return;
                const v = it.value;
                setFocused(v.kind === 'sell' ? v.card : null);
              }}
              onCancel={onBack}
            />
          )}
        </Box>
      }
      bottom={<Text dimColor>↑↓ 선택  Enter 확정  Esc 메뉴로</Text>}
      right={<RightPanelWithSkills>{focused ? <CardInstanceDetail card={focused} /> : null}</RightPanelWithSkills>}
    />
  );
}

// ====================================================================
// shared
// ====================================================================

function CardInstanceDetail({ card }: { card: CardInstance }): React.ReactElement {
  const game = useGame();
  const def = game.registries.cards.get(card.defId);
  const resolved = resolveCardEffects(def, card, game.registries.modifiers);
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">{def.name}</Text>
      <Text>비용: {resolved.cost.kind === 'fixed' ? resolved.cost.value : resolved.cost.kind}</Text>
      <Text>희귀도: {def.rarity}</Text>
      <Box marginTop={1}><Text>{def.baseDescription}</Text></Box>
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
