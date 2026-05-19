import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useDispatch, useGame } from '../EngineContext.js';
import { FocusList, type FocusListItem } from '../layout/FocusList.js';
import { ThreeBoxLayout } from '../layout/ThreeBoxLayout.js';
import { affordableGrades, purchaseSkillBox, type SkillGrade } from '../../engine/meta/skill-box.js';
import { resolveCardEffects } from '../../engine/modifiers/resolver.js';
import { DEFAULT_DRAFT_CAPACITY } from '../../engine/integration/game.js';
import type { CardInstance } from '../../types/index.js';

/**
 * Start Phase — two stages:
 *
 *   1. (optional) Skill box purchase
 *   2. (optional) Draft cards from inventory for the run's starting deck
 *
 * Both stages auto-skip when nothing's available:
 *   - Empty skill box / not affordable → straight to stage 2
 *   - Empty inventory → straight to enterDungeon
 *
 * Per design: first run of a new character starts with empty deck so
 * journey_start event populates it. Returning characters draft from
 * inventory (up to DEFAULT_DRAFT_CAPACITY cards, scalable via skills later).
 */

export interface StartPhaseScreenProps {
  onEnteredDungeon: () => void;
}

type Stage = 'skill' | 'draft';

export function StartPhaseScreen({ onEnteredDungeon }: StartPhaseScreenProps): React.ReactElement {
  const game = useGame();
  const slot = game.state.slots[game.state.currentSlotIndex!]!;
  const hasInventory = game.state.global.inventory.cards.length > 0;
  const [stage, setStage] = useState<Stage>('skill');

  if (stage === 'skill') {
    return (
      <SkillStage
        onAdvance={() => {
          // If no inventory cards, skip the draft stage entirely
          if (!hasInventory && (slot.difficultyLevel === 0)) {
            // New character with no inventory — depart immediately
            // (journey_start will fire and populate the deck)
            doEnterDungeon();
          } else if (!hasInventory) {
            // Returning char with empty inventory — depart with whatever
            doEnterDungeon();
          } else {
            setStage('draft');
          }
        }}
      />
    );
  }

  return <DraftStage onDepart={doEnterDungeon} />;

  function doEnterDungeon() {
    // dispatch via the game directly (no need to wait for re-render)
    game.enterDungeon({ deck: [] });
    onEnteredDungeon();
  }
}

// ====================================================================
// Skill box stage
// ====================================================================

function SkillStage({ onAdvance }: { onAdvance: () => void }): React.ReactElement {
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
    { id: 'skip', label: '구매하지 않고 진행', value: { kind: 'skip' } },
  ];

  return (
    <ThreeBoxLayout
      title={`${slot.characterName} — 시작 페이즈 1/2 (스킬)`}
      main={
        <Box flexDirection="column">
          <Text>차원의 안내자가 묻는다:</Text>
          <Text>"스킬 상자를 구매하겠는가?"</Text>
          <Box marginTop={1}>
            <Text dimColor>메타 골드: {game.state.global.gold}G</Text>
          </Box>
          <Box marginTop={1}>
            <FocusList
              items={items}
              onSelect={it => {
                dispatch(() => {
                  if (it.value.kind === 'box') {
                    const result = purchaseSkillBox(
                      game.state.global,
                      it.value.grade,
                      game.registries.skillBoxes,
                      game.rng,
                    );
                    if (result.ok) {
                      slot.skillIds.push(result.skillId);
                    }
                  }
                });
                onAdvance();
              }}
            />
          </Box>
        </Box>
      }
      bottom={<Text dimColor>↑↓ 선택  Enter 확정</Text>}
      right={
        <Box flexDirection="column">
          <Text bold color="cyan">시작 페이즈 1/2</Text>
          <Box marginTop={1} flexDirection="column">
            <Text>스킬 상자 = 무작위 스킬 1개</Text>
            <Text>등급이 높을수록 강한 스킬</Text>
            <Text dimColor>골드/인벤은 모든 슬롯 공유</Text>
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>현재 캐릭터:</Text>
            <Text dimColor>스킬 {slot.skillIds.length}개  Lv {slot.difficultyLevel}</Text>
          </Box>
        </Box>
      }
    />
  );
}

// ====================================================================
// Draft stage
// ====================================================================

type DraftAction = { kind: 'withdraw'; card: CardInstance } | { kind: 'depart' };

function DraftStage({ onDepart }: { onDepart: () => void }): React.ReactElement {
  const game = useGame();
  const dispatch = useDispatch();
  const slot = game.state.slots[game.state.currentSlotIndex!]!;
  const [view, setView] = useState<'inventory' | 'drafted'>('inventory');
  const [focused, setFocused] = useState<CardInstance | null>(null);

  const drafted = slot.draftedDeck ?? [];
  const inv = game.state.global.inventory.cards;
  const cap = DEFAULT_DRAFT_CAPACITY;

  if (view === 'inventory') {
    const items: FocusListItem<DraftAction>[] = inv.map(card => {
      const def = game.registries.cards.get(card.defId);
      const stars = card.modifiers.length > 0 ? `+${card.modifiers.length}` : '';
      const full = drafted.length >= cap;
      return {
        id: card.instanceId,
        label: `[가져가기] ${def.name} ${stars}`,
        value: { kind: 'withdraw', card },
        disabled: full,
        disabledReason: full ? `출발 덱 가득 (${drafted.length}/${cap})` : undefined,
      };
    });
    items.push({ id: '__view_drafted__', label: `→ 출발 덱 보기 (${drafted.length}/${cap})`, value: { kind: 'depart' } });
    items.push({ id: '__depart__', label: `🚪 출발하기 (현재 ${drafted.length}장 휴대)`, value: { kind: 'depart' } });

    return (
      <ThreeBoxLayout
        title={`${slot.characterName} — 시작 페이즈 2/2 (출발 덱 구성) · 인벤토리`}
        main={
          <Box flexDirection="column">
            <Text>인벤에서 가져갈 카드를 고르세요 (최대 {cap}장).</Text>
            <Text dimColor>현재 출발 덱: {drafted.length}/{cap}장</Text>
            <Box marginTop={1}>
              <FocusList
                items={items}
                onSelect={it => {
                  if (it.id === '__depart__') {
                    onDepart();
                    return;
                  }
                  if (it.id === '__view_drafted__') {
                    setView('drafted');
                    return;
                  }
                  const v = it.value;
                  if (v.kind === 'withdraw') {
                    dispatch(() => game.draftCardFromInventory(v.card.instanceId, cap));
                  }
                }}
                onFocusChange={it => {
                  if (!it) { setFocused(null); return; }
                  const v = it.value;
                  setFocused(v.kind === 'withdraw' ? v.card : null);
                }}
              />
            </Box>
          </Box>
        }
        bottom={<Text dimColor>↑↓ 선택  Enter 가져가기/출발  · 출발 덱 보기로 전환 가능</Text>}
        right={focused ? <CardInstanceDetail card={focused} /> : <DraftInfoPanel drafted={drafted} cap={cap} />}
      />
    );
  }

  // drafted view
  const items: FocusListItem<DraftAction>[] = drafted.map(card => {
    const def = game.registries.cards.get(card.defId);
    const stars = card.modifiers.length > 0 ? `+${card.modifiers.length}` : '';
    return {
      id: card.instanceId,
      label: `[인벤으로 되돌리기] ${def.name} ${stars}`,
      value: { kind: 'withdraw', card },
    };
  });
  items.push({ id: '__view_inv__', label: `← 인벤토리로 돌아가기`, value: { kind: 'depart' } });
  items.push({ id: '__depart__', label: `🚪 출발하기 (현재 ${drafted.length}장 휴대)`, value: { kind: 'depart' } });

  return (
    <ThreeBoxLayout
      title={`${slot.characterName} — 시작 페이즈 2/2 (출발 덱 구성) · 출발 덱`}
      main={
        <Box flexDirection="column">
          <Text>출발 덱에서 인벤으로 되돌릴 수 있습니다.</Text>
          <Text dimColor>현재 출발 덱: {drafted.length}/{cap}장</Text>
          <Box marginTop={1}>
            {drafted.length === 0 ? (
              <Text dimColor>출발 덱이 비어있음 (인벤토리로 돌아가서 가져오세요)</Text>
            ) : null}
            <FocusList
              items={items}
              onSelect={it => {
                if (it.id === '__depart__') {
                  onDepart();
                  return;
                }
                if (it.id === '__view_inv__') {
                  setView('inventory');
                  return;
                }
                const v = it.value;
                if (v.kind === 'withdraw') {
                  dispatch(() => game.undraftCard(v.card.instanceId));
                }
              }}
              onFocusChange={it => {
                if (!it) { setFocused(null); return; }
                const v = it.value;
                setFocused(v.kind === 'withdraw' ? v.card : null);
              }}
            />
          </Box>
        </Box>
      }
      bottom={<Text dimColor>↑↓ 선택  Enter 되돌리기/출발</Text>}
      right={focused ? <CardInstanceDetail card={focused} /> : <DraftInfoPanel drafted={drafted} cap={cap} />}
    />
  );
}

function DraftInfoPanel({ drafted, cap }: { drafted: readonly CardInstance[]; cap: number }): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">출발 덱 구성</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>{drafted.length}/{cap}장</Text>
        <Text dimColor>인벤 카드를 골라 가져갑니다.</Text>
        <Text dimColor>0장으로도 출발 가능</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color="yellow">팁:</Text>
        <Text dimColor>· 강화된 카드일수록 강력</Text>
        <Text dimColor>· 출발 후엔 못 바꿈</Text>
      </Box>
    </Box>
  );
}

function CardInstanceDetail({ card }: { card: CardInstance }): React.ReactElement {
  const game = useGame();
  const def = game.registries.cards.get(card.defId);
  const resolved = resolveCardEffects(def, card, game.registries.modifiers);
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">{def.name}</Text>
      <Text>비용: {resolved.cost.kind === 'fixed' ? resolved.cost.value : resolved.cost.kind}</Text>
      <Text>타입: {def.type}</Text>
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

function gradeLabel(grade: SkillGrade): string {
  switch (grade) {
    case 'lowest':  return '최하급';
    case 'low':     return '하급';
    case 'mid':     return '중급';
    case 'high':    return '상급';
    case 'highest': return '최상급';
  }
}
