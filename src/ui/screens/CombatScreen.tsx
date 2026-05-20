import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useDispatch, useGame } from '../EngineContext.js';
import { FocusList, type FocusListItem } from '../layout/FocusList.js';
import { ThreeBoxLayout } from '../layout/ThreeBoxLayout.js';
import { resolveCardEffects } from '../../engine/modifiers/resolver.js';
import type { CardInstance, EnemyActor } from '../../types/index.js';

/**
 * CombatScreen — Pokemon-style ASCII enemies + animated HP bars.
 *
 * Layout:
 *   MAIN top: enemy sprites + HP bars + intents
 *   MAIN bottom: player stats (HP/block/energy) + small HP bar
 *   BOTTOM: hand list (focusable)
 *   RIGHT: focused card detail OR focused enemy detail (during targeting)
 *
 * Animations:
 *   - Displayed HP tweens toward actor.hp over a few frames (~30 fps)
 *   - Hit flash: brief red border on actors that just lost HP
 *   - Input lockout (FocusList isActive=false) while any HP is animating
 *
 * Auto-end: combat resolves automatically on enemy death / player death
 *   (engine-side), so this screen just unmounts when activity transitions.
 */

type Phase =
  | { kind: 'picking' }
  | { kind: 'targeting'; cardInstanceId: string };

const TWEEN_INTERVAL_MS = 40;       // ~25 fps animation
const TWEEN_FRAMES_TO_CATCH_UP = 8; // 8 frames * 40ms = ~320ms for any change
const FLASH_DURATION_MS = 250;

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

  // ---------- HP animation state ----------
  const PLAYER_ID = '__player__';
  const [displayedHp, setDisplayedHp] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = { [PLAYER_ID]: player.hp };
    for (const e of enemies) init[e.instanceId] = e.hp;
    return init;
  });
  const [displayedBlock, setDisplayedBlock] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = { [PLAYER_ID]: player.block };
    for (const e of enemies) init[e.instanceId] = e.block;
    return init;
  });
  const [flashAt, setFlashAt] = useState<Record<string, number>>({});
  // Bump every interval so derived flash state re-renders for fade
  const [, setTickN] = useState(0);

  // Initialize/reset displayed values for actors that appear/change
  useEffect(() => {
    setDisplayedHp(prev => {
      const next = { ...prev };
      if (!(PLAYER_ID in next)) next[PLAYER_ID] = player.hp;
      for (const e of enemies) if (!(e.instanceId in next)) next[e.instanceId] = e.hp;
      return next;
    });
    setDisplayedBlock(prev => {
      const next = { ...prev };
      if (!(PLAYER_ID in next)) next[PLAYER_ID] = player.block;
      for (const e of enemies) if (!(e.instanceId in next)) next[e.instanceId] = e.block;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enemies.length]);

  // Tween toward actual hp / block; trigger flashes on drops
  useEffect(() => {
    const interval = setInterval(() => {
      setTickN(n => n + 1);
      setDisplayedHp(prev => {
        const next: Record<string, number> = { ...prev };
        let changed = false;
        const tween = (key: string, target: number) => {
          const cur = next[key] ?? target;
          if (cur === target) return;
          const diff = Math.abs(cur - target);
          const step = Math.max(1, Math.ceil(diff / TWEEN_FRAMES_TO_CATCH_UP));
          const newVal = cur > target ? Math.max(cur - step, target) : Math.min(cur + step, target);
          if (newVal < cur) {
            setFlashAt(f => ({ ...f, [key]: Date.now() }));
          }
          next[key] = newVal;
          changed = true;
        };
        tween(PLAYER_ID, player.hp);
        for (const e of enemies) tween(e.instanceId, e.hp);
        return changed ? next : prev;
      });
      setDisplayedBlock(prev => {
        const next: Record<string, number> = { ...prev };
        let changed = false;
        const tween = (key: string, target: number) => {
          const cur = next[key] ?? target;
          if (cur === target) return;
          const diff = Math.abs(cur - target);
          const step = Math.max(1, Math.ceil(diff / TWEEN_FRAMES_TO_CATCH_UP));
          next[key] = cur > target ? Math.max(cur - step, target) : Math.min(cur + step, target);
          changed = true;
        };
        tween(PLAYER_ID, player.block);
        for (const e of enemies) tween(e.instanceId, e.block);
        return changed ? next : prev;
      });
    }, TWEEN_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [player.hp, player.block, enemies]);

  // Are we still animating? If yes, lock input.
  const animating =
    (displayedHp[PLAYER_ID] ?? player.hp) !== player.hp ||
    (displayedBlock[PLAYER_ID] ?? player.block) !== player.block ||
    enemies.some(e =>
      (displayedHp[e.instanceId] ?? e.hp) !== e.hp ||
      (displayedBlock[e.instanceId] ?? e.block) !== e.block,
    );

  // E key always ends the turn — but ignored during animation
  useInput((input, _key) => {
    if (animating) return;
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

  const displayedFor = (key: string, fallback: number) => displayedHp[key] ?? fallback;
  const displayedBlkFor = (key: string, fallback: number) => displayedBlock[key] ?? fallback;
  const isFlashing = (key: string): boolean => {
    const t = flashAt[key];
    if (!t) return false;
    return Date.now() - t < FLASH_DURATION_MS;
  };

  // Build common main view
  const mainView = (
    <CombatMain
      player={player}
      enemies={enemies}
      piles={piles}
      turn={run.activity.turn}
      playerKey={PLAYER_ID}
      displayedHp={displayedFor}
      displayedBlock={displayedBlkFor}
      flashing={isFlashing}
    />
  );

  if (phase.kind === 'targeting') {
    return (
      <ThreeBoxLayout
        title={`타겟 선택 — Esc 취소${animating ? '  (애니메이션 중…)' : ''}`}
        main={mainView}
        bottom={
          <FocusList
            isActive={!animating}
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
      title={`전투 — 턴 ${run.activity.turn}${animating ? '  (애니메이션 중…)' : ''}`}
      main={mainView}
      bottom={
        <Box flexDirection="column">
          <Text bold>손패 (E 턴 종료)</Text>
          {handItems.length === 0 ? (
            <Text dimColor>(손패 없음 — E 로 턴 종료)</Text>
          ) : (
            <FocusList
              isActive={!animating}
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

interface MainViewProps {
  player: { hp: number; maxHp: number; block: number; energy: number; maxEnergy: number; statuses: Array<{ id: string; stacks: number }> };
  enemies: ReadonlyArray<EnemyActor>;
  piles: { drawPile: unknown[]; discardPile: unknown[]; exhaustPile: unknown[] };
  turn: number;
  playerKey: string;
  displayedHp: (key: string, fallback: number) => number;
  displayedBlock: (key: string, fallback: number) => number;
  flashing: (key: string) => boolean;
}

function CombatMain({
  player, enemies, piles, turn, playerKey, displayedHp, displayedBlock, flashing,
}: MainViewProps): React.ReactElement {
  const game = useGame();
  return (
    <Box flexDirection="column">
      {/* Enemy stage */}
      <Box flexDirection="row" justifyContent="space-around" marginBottom={1}>
        {enemies.map(e => {
          const def = game.registries.enemies.get(e.defId);
          const alive = e.hp > 0;
          const dispHp = displayedHp(e.instanceId, e.hp);
          const dispBlk = displayedBlock(e.instanceId, e.block);
          const isHit = flashing(e.instanceId);
          return (
            <Box
              key={e.instanceId}
              flexDirection="column"
              alignItems="center"
              borderStyle={isHit ? 'double' : 'single'}
              borderColor={!alive ? 'gray' : isHit ? 'red' : 'white'}
              paddingX={1}
            >
              {def.sprite && def.sprite.length > 0 ? (
                <Box flexDirection="column" alignItems="center">
                  {def.sprite.map((line, i) => (
                    <Text
                      key={i}
                      color={!alive ? 'gray' : isHit ? 'red' : undefined}
                      dimColor={!alive}
                    >{line}</Text>
                  ))}
                </Box>
              ) : (
                <Text color={!alive ? 'gray' : undefined}>(no sprite)</Text>
              )}
              <Text bold color={!alive ? 'gray' : undefined}>{def.name}</Text>
              <HpBar current={dispHp} max={e.maxHp} block={dispBlk} width={14} dim={!alive} flash={isHit} />
              {alive && e.intent && (
                <Text dimColor>의도: {e.intent.display.kind} {e.intent.display.value ?? ''}</Text>
              )}
              {alive && e.statuses.length > 0 && (
                <Text dimColor>[{e.statuses.map(s => `${s.id}:${s.stacks}`).join(', ')}]</Text>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Player stage */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>당신</Text>
        <Box flexDirection="row" alignItems="center">
          <HpBar
            current={displayedHp(playerKey, player.hp)}
            max={player.maxHp}
            block={displayedBlock(playerKey, player.block)}
            width={20}
            flash={flashing(playerKey)}
          />
          <Text>  에너지 {player.energy}/{player.maxEnergy}</Text>
        </Box>
        {player.statuses.length > 0 && (
          <Text dimColor>상태: {player.statuses.map(s => `${s.id}:${s.stacks}`).join(', ')}</Text>
        )}
        <Text dimColor>덱 {piles.drawPile.length}  버림 {piles.discardPile.length}  소멸 {piles.exhaustPile.length}  ·  턴 {turn}</Text>
      </Box>
    </Box>
  );
}

function HpBar({
  current, max, block, width, dim, flash,
}: {
  current: number;
  max: number;
  block: number;
  width: number;
  dim?: boolean;
  flash?: boolean;
}): React.ReactElement {
  const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const color = dim ? 'gray' : flash ? 'red' : ratio > 0.5 ? 'green' : ratio > 0.25 ? 'yellow' : 'red';
  return (
    <Box flexDirection="row">
      <Text color={color as any}>{'█'.repeat(filled)}</Text>
      <Text dimColor>{'░'.repeat(empty)}</Text>
      <Text>  HP {current}/{max}</Text>
      {block > 0 && <Text color="cyan">  🛡{block}</Text>}
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
