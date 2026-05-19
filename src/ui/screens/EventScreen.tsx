import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useDispatch, useGame } from '../EngineContext.js';
import { FocusList, type FocusListItem } from '../layout/FocusList.js';
import { ThreeBoxLayout } from '../layout/ThreeBoxLayout.js';
import { resolveCardEffects } from '../../engine/modifiers/resolver.js';
import type {
  CardDefId,
  CardInstance,
  CardInstanceId,
  ModifierId,
  SkillId,
} from '../../types/index.js';

/**
 * EventScreen — renders whichever FlowStatus variant is currently active.
 *
 * Branches:
 *   awaitingDialogue          → text + "Enter 다음"
 *   awaitingChoice            → options with condition gating
 *   awaitingCardPick          → 3 cards offered, iteration X/N
 *   awaitingSkillPick         → skill candidates
 *   awaitingCardUpgradeTarget → cards in deck/inventory + (modifier or forced)
 *   awaitingModifierPick      → modifier candidates for picked card
 *   inCombat                  → (CombatScreen takes over via Router)
 *   finished                  → returns to MapScreen (handled by Router)
 */

export function EventScreen(): React.ReactElement {
  const game = useGame();
  const run = game.state.run!;
  if (run.activity.kind !== 'inEvent') {
    return <Text color="red">EventScreen rendered outside event activity</Text>;
  }
  const status = game.flowStatus();

  switch (status.kind) {
    case 'awaitingDialogue':   return <DialogueView text={status.text} speaker={status.speaker} />;
    case 'awaitingChoice':     return <ChoiceView prompt={status.prompt} options={status.options} />;
    case 'awaitingCardPick':   return <CardPickView status={status} />;
    case 'awaitingSkillPick':  return <SkillPickView status={status} />;
    case 'awaitingCardUpgradeTarget': return <UpgradeTargetView status={status} />;
    case 'awaitingModifierPick':      return <ModifierPickView status={status} />;
    case 'inCombat':           return <Text dimColor>(combat in progress — switching screen…)</Text>;
    case 'idle':               return <Text dimColor>(idle)</Text>;
    case 'finished':           return <Text dimColor>(event finished — returning to map…)</Text>;
  }
}

// ====================================================================
// dialogue
// ====================================================================

function DialogueView({ text, speaker }: { text: string; speaker?: string }): React.ReactElement {
  const game = useGame();
  const dispatch = useDispatch();
  useInput((_input, key) => {
    if (key.return || key.tab || key.rightArrow) dispatch(() => game.flowAdvance());
  });
  return (
    <ThreeBoxLayout
      title="이벤트"
      main={
        <Box flexDirection="column">
          {speaker && <Text bold color="cyan">{speaker}:</Text>}
          <Box marginTop={1}>
            <Text>{text}</Text>
          </Box>
        </Box>
      }
      bottom={<Text dimColor>Enter ▶ 다음</Text>}
      right={null}
    />
  );
}

// ====================================================================
// choice
// ====================================================================

function ChoiceView({
  prompt,
  options,
}: {
  prompt?: string;
  options: ReadonlyArray<{ index: number; label: string; enabled: boolean; disabledReason?: string }>;
}): React.ReactElement {
  const game = useGame();
  const dispatch = useDispatch();
  const items: FocusListItem<number>[] = options.map(o => ({
    id: `opt-${o.index}`, label: o.label,
    disabled: !o.enabled, disabledReason: o.disabledReason,
    value: o.index,
  }));
  return (
    <ThreeBoxLayout
      title="이벤트 — 선택"
      main={
        <Box flexDirection="column">
          {prompt && <Text>{prompt}</Text>}
          <Box marginTop={1}>
            <FocusList items={items} onSelect={it => dispatch(() => game.flowChoose(it.value))} />
          </Box>
        </Box>
      }
      bottom={<Text dimColor>↑↓ 선택  Enter 확정</Text>}
      right={null}
    />
  );
}

// ====================================================================
// cardOffer
// ====================================================================

function CardPickView({
  status,
}: {
  status: { iteration: number; totalIterations: number; choices: ReadonlyArray<CardDefId>; canSkip: boolean; destination: 'currentDeck' | 'inventory' };
}): React.ReactElement {
  const game = useGame();
  const dispatch = useDispatch();
  const [focused, setFocused] = useState<CardDefId | null>(status.choices[0] ?? null);

  const items: FocusListItem<CardDefId>[] = status.choices.map(cid => ({
    id: cid, label: game.registries.cards.get(cid).name, value: cid,
  }));
  if (status.canSkip) {
    items.push({ id: '__skip__', label: '— 건너뛰기 —', value: '__skip__' as CardDefId });
  }

  return (
    <ThreeBoxLayout
      title={`카드 선택 (${status.iteration}/${status.totalIterations}) — ${status.destination === 'currentDeck' ? '현재 덱' : '인벤토리'}로`}
      main={
        <Box flexDirection="column">
          <Text>제시된 카드 중 하나를 고르세요.</Text>
          <Box marginTop={1}>
            <FocusList
              items={items}
              onSelect={it => {
                dispatch(() => {
                  if (it.value === '__skip__') game.flowSkipCardPick();
                  else game.flowPickCard(it.value);
                });
              }}
              onFocusChange={it => setFocused(it?.value ?? null)}
            />
          </Box>
        </Box>
      }
      bottom={<Text dimColor>↑↓ 선택  Enter 확정{status.canSkip ? '  (건너뛰기 가능)' : ''}</Text>}
      right={focused && focused !== ('__skip__' as CardDefId) ? <CardDefDetail defId={focused} /> : null}
    />
  );
}

function CardDefDetail({ defId }: { defId: CardDefId }): React.ReactElement {
  const game = useGame();
  const def = game.registries.cards.get(defId);
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">{def.name}</Text>
      <Text>비용: {def.cost.kind === 'fixed' ? def.cost.value : def.cost.kind}</Text>
      <Text>타입: {def.type}</Text>
      <Text>타겟: {def.target.kind}</Text>
      <Text>희귀도: {def.rarity}</Text>
      <Box marginTop={1}><Text>{def.baseDescription}</Text></Box>
      {def.keywords.length > 0 && (
        <Box marginTop={1}><Text color="magenta">키워드: {def.keywords.join(', ')}</Text></Box>
      )}
    </Box>
  );
}

// ====================================================================
// skillOffer
// ====================================================================

function SkillPickView({
  status,
}: {
  status: { choices: ReadonlyArray<SkillId>; canSkip: boolean };
}): React.ReactElement {
  const game = useGame();
  const dispatch = useDispatch();
  const [focused, setFocused] = useState<SkillId | null>(status.choices[0] ?? null);

  const items: FocusListItem<SkillId>[] = status.choices.map(sid => ({
    id: sid, label: game.registries.skills.get(sid).name, value: sid,
  }));
  if (status.canSkip) {
    items.push({ id: '__skip__', label: '— 건너뛰기 —', value: '__skip__' as SkillId });
  }

  return (
    <ThreeBoxLayout
      title="스킬 선택"
      main={
        <Box flexDirection="column">
          <Text>제시된 스킬 중 하나를 고르세요.</Text>
          <Box marginTop={1}>
            <FocusList
              items={items}
              onSelect={it => dispatch(() => {
                if (it.value === '__skip__') game.flowSkipSkillPick();
                else game.flowPickSkill(it.value);
              })}
              onFocusChange={it => setFocused(it?.value ?? null)}
            />
          </Box>
        </Box>
      }
      bottom={<Text dimColor>↑↓ 선택  Enter 확정</Text>}
      right={focused && focused !== ('__skip__' as SkillId) ? (
        <Box flexDirection="column">
          <Text bold color="cyan">{game.registries.skills.get(focused).name}</Text>
          <Text>등급: {game.registries.skills.get(focused).grade}</Text>
          <Box marginTop={1}><Text>{game.registries.skills.get(focused).description}</Text></Box>
        </Box>
      ) : null}
    />
  );
}

// ====================================================================
// cardUpgrade / cardModifierAttach (target)
// ====================================================================

function UpgradeTargetView({
  status,
}: {
  status: {
    iteration: number;
    totalIterations: number;
    candidates: ReadonlyArray<CardInstance>;
    source: 'currentDeck' | 'inventory';
    forcedModifierId?: ModifierId;
    canSkip: boolean;
  };
}): React.ReactElement {
  const game = useGame();
  const dispatch = useDispatch();
  const [focused, setFocused] = useState<CardInstance | null>(status.candidates[0] ?? null);

  const items: FocusListItem<CardInstance>[] = status.candidates.map(c => {
    const def = game.registries.cards.get(c.defId);
    const stars = c.modifiers.length > 0 ? ` +${c.modifiers.length}` : '';
    return { id: c.instanceId, label: `${def.name}${stars}`, value: c };
  });
  if (status.canSkip) {
    items.push({ id: '__skip__', label: '— 건너뛰기 —', value: null as unknown as CardInstance });
  }

  return (
    <ThreeBoxLayout
      title={`강화 대상 선택 (${status.iteration}/${status.totalIterations}) ${status.forcedModifierId ? '— 강화 고정' : ''}`}
      main={
        <Box flexDirection="column">
          <Text>대상 카드를 고르세요 ({status.source === 'currentDeck' ? '현재 덱' : '인벤토리'} 기준).</Text>
          <Box marginTop={1}>
            <FocusList
              items={items}
              onSelect={it => dispatch(() => {
                if (it.id === '__skip__') game.flowSkipCardUpgrade();
                else if (status.forcedModifierId) game.flowPickCardForModifierAttach(it.value.instanceId);
                else game.flowPickCardToUpgrade(it.value.instanceId);
              })}
              onFocusChange={it => setFocused(it?.id === '__skip__' ? null : (it?.value ?? null))}
            />
          </Box>
        </Box>
      }
      bottom={<Text dimColor>↑↓ 선택  Enter 확정{status.canSkip ? '  (건너뛰기 가능)' : ''}</Text>}
      right={focused ? <CardInstanceDetail card={focused} /> : null}
    />
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

// ====================================================================
// modifier pick
// ====================================================================

function ModifierPickView({
  status,
}: {
  status: { cardInstance: CardInstance; choices: ReadonlyArray<ModifierId> };
}): React.ReactElement {
  const game = useGame();
  const dispatch = useDispatch();
  const [focused, setFocused] = useState<ModifierId | null>(status.choices[0] ?? null);

  const items: FocusListItem<ModifierId>[] = status.choices.map(m => ({
    id: m, label: game.registries.modifiers.get(m).name, value: m,
  }));

  return (
    <ThreeBoxLayout
      title="강화 선택"
      main={
        <Box flexDirection="column">
          <Text>이 카드에 부착할 강화를 고르세요:</Text>
          <Text bold>{game.registries.cards.get(status.cardInstance.defId).name}</Text>
          <Box marginTop={1}>
            <FocusList
              items={items}
              onSelect={it => dispatch(() => game.flowPickModifier(it.value))}
              onFocusChange={it => setFocused(it?.value ?? null)}
            />
          </Box>
        </Box>
      }
      bottom={<Text dimColor>↑↓ 선택  Enter 확정</Text>}
      right={focused ? (
        <Box flexDirection="column">
          <Text bold color="cyan">{game.registries.modifiers.get(focused).name}</Text>
          <Box marginTop={1}><Text>{game.registries.modifiers.get(focused).descriptionTemplate}</Text></Box>
        </Box>
      ) : null}
    />
  );
}
