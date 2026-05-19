import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useDispatch, useGame } from '../EngineContext.js';
import { FocusList, type FocusListItem } from '../layout/FocusList.js';
import { ThreeBoxLayout } from '../layout/ThreeBoxLayout.js';
import { resolveCardEffects } from '../../engine/modifiers/resolver.js';
import type { CardInstance, EnemyActor } from '../../types/index.js';

/**
 * CombatScreen — hand picker → target picker (if needed) → result.
 *
 * Layout:
 *   MAIN: enemies + player resources + log
 *   BOTTOM: hand list (focusable)
 *   RIGHT: focused card detail OR focused enemy detail (during targeting)
 *
 * Keyboard:
 *   ↑↓ : navigate hand
 *   Enter : play card; if target needed, switches to enemy picker
 *   E : end turn
 */

type Phase =
  | { kind: 'picking' }
  | { kind: 'targeting'; cardInstanceId: string };

export function CombatScreen(): React.ReactElement {
  const game = useGame();
  const dispatch = useDispatch();
  const run = game.state.run!;
  if (run.activity.kind !== 'inCombat') {
    return <Text color="red">CombatScreen rendered outside combat activity</Text>;
  }

  const [phase, setPhase] = useState<Phase>({ kind: 'picking' });
  const [focusedHand, setFocusedHand] = useState<CardInstance | null>(run.activity.piles.hand[0] ?? null);
  const [focusedEnemy, setFocusedEnemy] = useState<EnemyActor | null>(
    run.activity.enemies.find(e => e.hp > 0) ?? null,
  );

  const player = game.state.slots[game.state.currentSlotIndex!]!.character!;
  const enemies = run.activity.enemies;
  const piles = run.activity.piles;

  // E key always ends the turn (regardless of phase)
  useInput((input, _key) => {
    if (input === 'e' || input === 'E') {
      dispatch(() => {
        game.combatEndTurn();
        setPhase({ kind: 'picking' });
      });
    }
  });

  const handItems: FocusListItem<CardInstance>[] = piles.hand.map(c => {
    const def = game.registries.cards.get(c.defId);
    const resolved = resolveCardEffects(def, c, game.registries.modifiers);
    const cost = resolved.cost.kind === 'fixed' ? resolved.cost.value : '?';
    const stars = c.modifiers.length > 0 ? '+'.repeat(c.modifiers.length) : '';
    const can = game.combatCanPlayCard(c.instanceId, focusedEnemy?.instanceId);
    return {
      id: c.instanceId,
      label: `${def.name} (${cost})${stars}`,
      value: c,
      disabled: !can.ok,
      disabledReason: !can.ok ? (can as { ok: false; reason: string }).reason : undefined,
    };
  });

  const enemyItems: FocusListItem<EnemyActor>[] = enemies
    .filter(e => e.hp > 0)
    .map(e => {
      const def = game.registries.enemies.get(e.defId);
      const intent = e.intent ? ` (${e.intent.display.kind} ${e.intent.display.value ?? ''})` : '';
      return {
        id: e.instanceId,
        label: `${def.name} HP ${e.hp}/${e.maxHp}${intent}`,
        value: e,
      };
    });

  if (phase.kind === 'targeting') {
    return (
      <ThreeBoxLayout
        title="타겟 선택 — Esc 취소"
        main={<CombatMain player={player} enemies={enemies} piles={piles} turn={run.activity.turn} />}
        bottom={
          <FocusList
            items={enemyItems}
            onFocusChange={it => setFocusedEnemy(it?.value ?? null)}
            onSelect={it => {
              dispatch(() => {
                game.combatPlayCard(phase.cardInstanceId as any, it.value.instanceId);
              });
              setPhase({ kind: 'picking' });
            }}
            onCancel={() => setPhase({ kind: 'picking' })}
          />
        }
        right={focusedEnemy ? <EnemyDetail enemy={focusedEnemy} /> : null}
      />
    );
  }

  return (
    <ThreeBoxLayout
      title={`전투 — 턴 ${run.activity.turn}`}
      main={<CombatMain player={player} enemies={enemies} piles={piles} turn={run.activity.turn} />}
      bottom={
        <Box flexDirection="column">
          <Text bold>손패 (E 턴 종료)</Text>
          {handItems.length === 0 ? (
            <Text dimColor>(손패 없음 — E 로 턴 종료)</Text>
          ) : (
            <FocusList
              items={handItems}
              onFocusChange={it => setFocusedHand(it?.value ?? null)}
              onSelect={it => {
                const def = game.registries.cards.get(it.value.defId);
                if (def.target.kind === 'enemy') {
                  setPhase({ kind: 'targeting', cardInstanceId: it.value.instanceId });
                } else {
                  dispatch(() => game.combatPlayCard(it.value.instanceId));
                }
              }}
            />
          )}
        </Box>
      }
      right={focusedHand ? <CardInstanceDetail card={focusedHand} /> : null}
    />
  );
}

// ====================================================================
// Sub-views
// ====================================================================

function CombatMain({
  player,
  enemies,
  piles,
  turn,
}: {
  player: { hp: number; maxHp: number; block: number; energy: number; maxEnergy: number; statuses: Array<{ id: string; stacks: number }> };
  enemies: ReadonlyArray<EnemyActor>;
  piles: { drawPile: unknown[]; discardPile: unknown[]; exhaustPile: unknown[] };
  turn: number;
}): React.ReactElement {
  const game = useGame();
  return (
    <Box flexDirection="column">
      <Text bold>적 ({enemies.filter(e => e.hp > 0).length}/{enemies.length} 생존)</Text>
      {enemies.map(e => {
        const def = game.registries.enemies.get(e.defId);
        const alive = e.hp > 0;
        const intent = alive && e.intent ? `의도: ${e.intent.display.kind} ${e.intent.display.value ?? ''}` : '';
        return (
          <Text key={e.instanceId} color={alive ? undefined : 'gray'}>
            {alive ? '●' : '✕'} {def.name}  HP {e.hp}/{e.maxHp}  방어 {e.block}  {intent}
            {e.statuses.length > 0 && '  ['  + e.statuses.map(s => `${s.id}:${s.stacks}`).join(', ') + ']'}
          </Text>
        );
      })}
      <Box marginTop={1} flexDirection="column">
        <Text bold>당신</Text>
        <Text>HP {player.hp}/{player.maxHp}  방어 {player.block}  에너지 {player.energy}/{player.maxEnergy}</Text>
        {player.statuses.length > 0 && (
          <Text dimColor>상태: {player.statuses.map(s => `${s.id}:${s.stacks}`).join(', ')}</Text>
        )}
        <Text dimColor>덱 {piles.drawPile.length}  버림 {piles.discardPile.length}  소멸 {piles.exhaustPile.length}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>턴 {turn}</Text>
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
      <Text>타입: {def.type}  타겟: {def.target.kind}</Text>
      <Box marginTop={1}><Text>{def.baseDescription}</Text></Box>
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

function EnemyDetail({ enemy }: { enemy: EnemyActor }): React.ReactElement {
  const game = useGame();
  const def = game.registries.enemies.get(enemy.defId);
  return (
    <Box flexDirection="column">
      <Text bold color="red">{def.name}</Text>
      <Text>HP {enemy.hp}/{enemy.maxHp}</Text>
      <Text>방어 {enemy.block}</Text>
      {enemy.intent && (
        <Box marginTop={1}>
          <Text>의도: {enemy.intent.display.kind} {enemy.intent.display.value ?? ''}</Text>
        </Box>
      )}
      {enemy.statuses.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>상태:</Text>
          {enemy.statuses.map((s, i) => (
            <Text key={i} dimColor>• {s.id} × {s.stacks}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
