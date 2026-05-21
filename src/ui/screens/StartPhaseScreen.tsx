import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useDispatch, useGame } from '../EngineContext.js';
import { FocusList, type FocusListItem } from '../layout/FocusList.js';
import { ThreeBoxLayout } from '../layout/ThreeBoxLayout.js';
import { affordableGrades, purchaseSkillBox, type SkillGrade } from '../../engine/meta/skill-box.js';
import { resolveCardEffects } from '../../engine/modifiers/resolver.js';
import { DEFAULT_DRAFT_CAPACITY } from '../../engine/integration/game.js';
import type { CardInstance } from '../../types/index.js';
import { gradeColor, wrapWithGradeBrackets } from '../helpers/grade-style.js';

/**
 * Start Phase — two stages:
 *   1. (optional) skill box purchase
 *   2. (optional) draft cards from inventory for the run's starting deck
 *
 * Draft UI is a SINGLE unified view (no inventory/drafted toggle):
 *   - Action button "선택 완료 → 출발" at TOP (so the focus shift bug
 *     can never accidentally trigger depart while the list is shrinking)
 *   - Then inventory items (가져가기)
 *   - Then currently-drafted items (인벤으로 되돌리기)
 *
 * journey_start event in demo.ts uses fillToDeckCount=5, so it only
 * picks (5 - draftedCount) extra cards. Total deck always ≤ 5.
 */

export interface StartPhaseScreenProps {
  onEnteredDungeon: () => void;
}

type Stage = 'skill' | 'draft';

export function StartPhaseScreen({ onEnteredDungeon }: StartPhaseScreenProps): React.ReactElement {
  const game = useGame();
  const dispatch = useDispatch();
  const slot = game.state.slots[game.state.currentSlotIndex!]!;
  const hasInventory = game.state.global.inventory.cards.length > 0;
  const [stage, setStage] = useState<Stage>('skill');

  function doEnterDungeon() {
    // dispatch is required so the EngineProvider re-renders + persists.
    // Without it, slot.state mutates silently and PlayingRouter never
    // switches off StartPhaseScreen.
    dispatch(() => game.enterDungeon({ deck: [] }));
    onEnteredDungeon();
  }

  if (stage === 'skill') {
    return (
      <SkillStage
        onAdvance={() => {
          if (!hasInventory) {
            doEnterDungeon();
          } else {
            setStage('draft');
          }
        }}
      />
    );
  }

  return <DraftStage onDepart={doEnterDungeon} />;
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
          label: `${wrapWithGradeBrackets(`${gradeLabel(b.grade)} 상자`, b.grade)} 구매 (${b.priceGold}G)`,
          color: gradeColor(b.grade),
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
// Draft stage (single unified view)
// ====================================================================

type DraftAction =
  | { kind: 'depart' }
  | { kind: 'withdraw'; card: CardInstance }
  | { kind: 'return';   card: CardInstance };

function DraftStage({ onDepart }: { onDepart: () => void }): React.ReactElement {
  const game = useGame();
  const dispatch = useDispatch();
  const slot = game.state.slots[game.state.currentSlotIndex!]!;
  const [focused, setFocused] = useState<CardInstance | null>(null);

  const drafted = slot.draftedDeck ?? [];
  const inv = game.state.global.inventory.cards;
  const cap = DEFAULT_DRAFT_CAPACITY;
  const draftFull = drafted.length >= cap;

  const items: FocusListItem<DraftAction>[] = [
    // 1) Depart action at TOP — won't shift when list size changes
    {
      id: '__depart__',
      label: `🚪 선택 완료 → 출발 (${drafted.length}/${cap}장 휴대)`,
      value: { kind: 'depart' },
    },
  ];

  // 2) Inventory cards — "가져가기" action
  for (const card of inv) {
    const def = game.registries.cards.get(card.defId);
    const stars = card.modifiers.length > 0 ? `+${card.modifiers.length}` : '';
    items.push({
      id: `inv-${card.instanceId}`,
      label: `[가져가기]   ${wrapWithGradeBrackets(def.name, def.rarity)} ${stars}`,
      color: gradeColor(def.rarity),
      value: { kind: 'withdraw', card },
      disabled: draftFull,
      disabledReason: draftFull ? `출발 덱 가득 (${drafted.length}/${cap})` : undefined,
    });
  }

  // 3) Drafted cards — "되돌리기" action
  for (const card of drafted) {
    const def = game.registries.cards.get(card.defId);
    const stars = card.modifiers.length > 0 ? `+${card.modifiers.length}` : '';
    items.push({
      id: `dft-${card.instanceId}`,
      label: `[되돌리기]   ${wrapWithGradeBrackets(def.name, def.rarity)} ${stars}  ★ 출발 덱에 있음`,
      color: gradeColor(def.rarity),
      value: { kind: 'return', card },
    });
  }

  return (
    <ThreeBoxLayout
      title={`${slot.characterName} — 시작 페이즈 2/2 (출발 덱 구성)`}
      main={
        <Box flexDirection="column">
          <Text>인벤에서 가져갈 카드를 고른 다음, 맨 위 "선택 완료 → 출발" 로 시작합니다.</Text>
          <Text dimColor>최대 {cap}장. 인벤이 가득 차면 "가져가기" 옵션이 회색.</Text>
          <Box marginTop={1} flexDirection="column">
            <Text>현재 출발 덱: <Text color="cyan">{drafted.length}/{cap}</Text>장</Text>
            <Text>인벤 보유: {inv.length}장</Text>
            {drafted.length < cap && (
              <Text color="yellow">
                출발 후 빈 슬롯 {cap - drafted.length}장은 "여정의 시작" 이벤트가 채워줍니다.
              </Text>
            )}
          </Box>
          <Box marginTop={1}>
            <FocusList
              items={items}
              onSelect={it => {
                const v = it.value;
                if (v.kind === 'depart') {
                  onDepart();
                } else if (v.kind === 'withdraw') {
                  dispatch(() => game.draftCardFromInventory(v.card.instanceId, cap));
                } else if (v.kind === 'return') {
                  dispatch(() => game.undraftCard(v.card.instanceId));
                }
              }}
              onFocusChange={it => {
                if (!it) { setFocused(null); return; }
                const v = it.value;
                setFocused(v.kind === 'depart' ? null : v.card);
              }}
            />
          </Box>
        </Box>
      }
      bottom={<Text dimColor>↑↓ 선택  Enter 확정  · 맨 위 "선택 완료 → 출발" 로 마무리</Text>}
      right={focused ? <CardInstanceDetail card={focused} /> : <DraftInfoPanel drafted={drafted} cap={cap} />}
    />
  );
}

function DraftInfoPanel({ drafted, cap }: { drafted: readonly CardInstance[]; cap: number }): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">출발 덱 구성</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>{drafted.length}/{cap}장 휴대</Text>
        <Text dimColor>인벤에서 가져가기 — 강화 보존</Text>
        <Text dimColor>출발 후 빈 슬롯은</Text>
        <Text dimColor>"여정의 시작" 이벤트가 채움</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color="yellow">팁:</Text>
        <Text dimColor>· 0장으로 출발해도 OK</Text>
        <Text dimColor>· 강화된 카드일수록 강력</Text>
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
      <Text bold color={gradeColor(def.rarity)}>
        {wrapWithGradeBrackets(def.name, def.rarity)}
      </Text>
      <Text>비용: {resolved.cost.kind === 'fixed' ? resolved.cost.value : resolved.cost.kind}</Text>
      <Text>타입: {def.type}  등급: {def.rarity}</Text>
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
    case 'common':    return '커먼';
    case 'rare':      return '레어';
    case 'legendary': return '레전더리';
  }
}
