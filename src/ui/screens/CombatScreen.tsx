import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useDispatch, useGame } from '../EngineContext.js';
import { FocusList, type FocusListItem } from '../layout/FocusList.js';
import { ThreeBoxLayout } from '../layout/ThreeBoxLayout.js';
import { resolveCardEffects } from '../../engine/modifiers/resolver.js';
import type { CardInstance, EnemyActor, PlayerActor } from '../../types/index.js';
import { SkillStrip } from '../layout/SkillStrip.js';
import { formatEffectPreview } from '../helpers/card-preview.js';
import { gradeColor, wrapWithGradeBrackets } from '../helpers/grade-style.js';

/**
 * CombatScreen — block-art enemies + animated HP + hand visualization.
 *
 * Mainbox layout (top → bottom):
 *   1. Enemy stage: arrow row + sprite row + name/HP/intent row
 *      ▼ marker appears above the FOCUSED enemy (during targeting)
 *   2. Player block: HP bar + energy + statuses
 *   3. Hand visualization: arrow row above mini-cards
 *      ▼ marker above the FOCUSED card (during picking phase)
 *   4. Pile counts (deck / discard / exhaust) with block-shade indicators
 *
 * Animations: HP bar + block bar tween toward actual value at ~25fps.
 * Hit flash: 250ms red border on actors that just lost HP.
 * Input lockout while any value is animating.
 */

type Phase =
  | { kind: 'picking' }
  | { kind: 'targeting'; cardInstanceId: string };

const TWEEN_INTERVAL_MS = 40;
const TWEEN_FRAMES_TO_CATCH_UP = 8;
const FLASH_DURATION_MS = 250;
/** How long the dead-actor portrait fades to black before combat resolves. */
const DEATH_FADE_MS = 600;

/**
 * Progressive sprite-line redaction for the death-fade animation.
 *   progress < 0.4 → original
 *   0.4 ≤ progress < 0.8 → non-space chars replaced with shade ░
 *   progress ≥ 0.8 → all chars become spaces (empty portrait)
 */
function fadeSpriteLine(line: string, progress: number): string {
  if (progress <= 0) return line;
  if (progress < 0.4) return line;
  if (progress < 0.8) return line.replace(/\S/g, '░');
  return ' '.repeat(line.length);
}

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

  // ---------- HP / Block animation state ----------
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
  const [, setTickN] = useState(0);

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
          if (newVal < cur) setFlashAt(f => ({ ...f, [key]: Date.now() }));
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

  const hpAnimating =
    (displayedHp[PLAYER_ID] ?? player.hp) !== player.hp ||
    (displayedBlock[PLAYER_ID] ?? player.block) !== player.block ||
    enemies.some(e =>
      (displayedHp[e.instanceId] ?? e.hp) !== e.hp ||
      (displayedBlock[e.instanceId] ?? e.block) !== e.block,
    );

  // Death-fade sequencing: once combat has a pendingResolve AND all HP
  // tweens have caught up, start the fade timer. After DEATH_FADE_MS,
  // call finalizeCombatEnd which actually transitions the activity.
  const pendingResolve = run.activity.kind === 'inCombat'
    ? run.activity.pendingResolve
    : undefined;
  const [fadeStartedAt, setFadeStartedAt] = useState<number | null>(null);

  useEffect(() => {
    if (pendingResolve && !hpAnimating && fadeStartedAt === null) {
      setFadeStartedAt(Date.now());
    }
    // Reset fade tracker if we somehow leave the pendingResolve state
    if (!pendingResolve && fadeStartedAt !== null) {
      setFadeStartedAt(null);
    }
  }, [pendingResolve, hpAnimating, fadeStartedAt]);

  useEffect(() => {
    if (fadeStartedAt === null) return;
    const t = setTimeout(() => {
      dispatch(() => game.finalizeCombatEnd());
    }, DEATH_FADE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fadeStartedAt]);

  const fadeProgress = fadeStartedAt
    ? Math.min(1, (Date.now() - fadeStartedAt) / DEATH_FADE_MS)
    : 0;

  // Lock input during HP tween, death fade, OR while waiting for finalize
  const animating = hpAnimating || pendingResolve !== undefined;

  const pendingEnemyTurn = run.activity.kind === 'inCombat'
    ? run.activity.pendingEnemyTurn
    : undefined;
  const enemyTurnActive = pendingEnemyTurn !== undefined;
  const enemyTurnDone = enemyTurnActive
    && pendingEnemyTurn!.cursor >= pendingEnemyTurn!.steps.length;

  useInput((input, key) => {
    if (animating) return;
    // Enemy turn — Enter advances through queued steps; after the last
    // step a "내 턴 시작" cue lets the player kick off the next turn.
    if (enemyTurnActive) {
      if (key.return) {
        if (enemyTurnDone) {
          dispatch(() => game.combatBeginNextPlayerTurn());
        } else {
          dispatch(() => game.combatStepEnemyTurn());
        }
      }
      return;
    }
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
      label: `${wrapWithGradeBrackets(def.name, def.rarity)} (${cost})${stars}`,
      color: gradeColor(def.rarity),
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
    return !!t && (Date.now() - t < FLASH_DURATION_MS);
  };

  // Focus markers: enemy arrow only during targeting; hand arrow only during picking
  const targetingEnemyId = phase.kind === 'targeting' ? focusedEnemy?.instanceId : null;
  const pickingHandId = phase.kind === 'picking' ? focusedHand?.instanceId : null;

  const mainView = (
    <CombatMain
      player={player}
      enemies={enemies}
      piles={piles}
      hand={piles.hand}
      turn={run.activity.turn}
      playerKey={PLAYER_ID}
      displayedHp={displayedFor}
      displayedBlock={displayedBlkFor}
      flashing={isFlashing}
      targetingEnemyId={targetingEnemyId ?? null}
      pickingHandId={pickingHandId ?? null}
      fadeProgress={fadeProgress}
    />
  );

  if (enemyTurnActive) {
    const total = pendingEnemyTurn!.steps.length;
    const cursor = pendingEnemyTurn!.cursor;
    const current = pendingEnemyTurn!.steps[cursor];
    return (
      <ThreeBoxLayout
        title={`적 턴 (${Math.min(cursor + 1, total)}/${total})${animating ? '  (애니메이션 중…)' : ''}`}
        main={mainView}
        bottom={
          <Box flexDirection="column">
            {enemyTurnDone ? (
              <>
                <Text bold color="green">내 턴 시작!</Text>
                <Text dimColor>Enter ▶ 카드 뽑고 진행</Text>
              </>
            ) : (
              <>
                <Text bold color="red">⚔ {current?.description ?? ''}</Text>
                <Text dimColor>Enter ▶ 진행{animating ? '  (애니메이션 진행 중…)' : ''}</Text>
              </>
            )}
          </Box>
        }
        right={
          <Box flexDirection="column">
            <SkillStrip />
            {focusedEnemy ? <EnemyDetail enemy={focusedEnemy} /> : null}
          </Box>
        }
      />
    );
  }

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
        right={
          <Box flexDirection="column">
            <SkillStrip />
            {focusedEnemy ? <EnemyDetail enemy={focusedEnemy} /> : null}
          </Box>
        }
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
                // Targeting UI fires for any card that ATTACKS enemies —
                // single ('enemy') AND multi ('allEnemies'). The anchor
                // target matters for per-target side effects (poison
                // application, etc.) even when damage spreads to all.
                if (def.target.kind === 'enemy' || def.target.kind === 'allEnemies') {
                  setPhase({ kind: 'targeting', cardInstanceId: it.value.instanceId });
                } else {
                  dispatch(() => game.combatPlayCard(it.value.instanceId));
                }
              }}
            />
          )}
        </Box>
      }
      right={
        <Box flexDirection="column">
          <SkillStrip />
          {focusedHand ? <CardInstanceDetail card={focusedHand} player={player} /> : null}
        </Box>
      }
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
  hand: ReadonlyArray<CardInstance>;
  turn: number;
  playerKey: string;
  displayedHp: (key: string, fallback: number) => number;
  displayedBlock: (key: string, fallback: number) => number;
  flashing: (key: string) => boolean;
  targetingEnemyId: string | null;
  pickingHandId: string | null;
  /** 0 = no death-fade in progress; 1 = fully faded (dead actors only). */
  fadeProgress: number;
}

function CombatMain({
  player, enemies, piles, hand, turn, playerKey,
  displayedHp, displayedBlock, flashing,
  targetingEnemyId, pickingHandId, fadeProgress,
}: MainViewProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      {/* Enemy stage */}
      <EnemyStage
        enemies={enemies}
        focusedId={targetingEnemyId}
        displayedHp={displayedHp}
        displayedBlock={displayedBlock}
        flashing={flashing}
        fadeProgress={fadeProgress}
      />

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
          <Text>  ⚡ {player.energy}/{player.maxEnergy}</Text>
        </Box>
        {player.statuses.length > 0 && (
          <Text dimColor>상태: {player.statuses.map(s => `${s.id}:${s.stacks}`).join(', ')}</Text>
        )}
      </Box>

      {/* Hand visualization */}
      <HandStrip hand={hand} focusedHandId={pickingHandId} />

      {/* Pile counts */}
      <PileCounts drawN={piles.drawPile.length} discardN={piles.discardPile.length} exhaustN={piles.exhaustPile.length} turn={turn} />
    </Box>
  );
}

// ====================================================================
// Enemy stage — sprite row with arrow above focused
// ====================================================================

function EnemyStage({
  enemies, focusedId, displayedHp, displayedBlock, flashing, fadeProgress,
}: {
  enemies: ReadonlyArray<EnemyActor>;
  focusedId: string | null;
  displayedHp: (key: string, fallback: number) => number;
  displayedBlock: (key: string, fallback: number) => number;
  flashing: (key: string) => boolean;
  fadeProgress: number;
}): React.ReactElement {
  const game = useGame();
  return (
    <Box flexDirection="row" justifyContent="space-around" marginBottom={1}>
      {enemies.map(e => {
        const def = game.registries.enemies.get(e.defId);
        const alive = e.hp > 0;
        const dispHp = displayedHp(e.instanceId, e.hp);
        const dispBlk = displayedBlock(e.instanceId, e.block);
        const isHit = flashing(e.instanceId);
        const isFocused = focusedId === e.instanceId;
        // Dead enemies fade their portrait to black over DEATH_FADE_MS
        const fp = !alive ? fadeProgress : 0;
        return (
          <Box key={e.instanceId} flexDirection="column" alignItems="center">
            {/* Arrow row */}
            <Box height={1}>
              {isFocused && alive ? (
                <Text color="yellow" bold>▼</Text>
              ) : (
                <Text> </Text>
              )}
            </Box>
            {/* Sprite */}
            <Box
              borderStyle={isHit ? 'double' : 'single'}
              borderColor={!alive ? 'gray' : isHit ? 'red' : isFocused ? 'yellow' : 'white'}
              paddingX={1}
              flexDirection="column"
              alignItems="center"
            >
              {def.sprite && def.sprite.length > 0 ? (
                def.sprite.map((line, i) => (
                  <Text
                    key={i}
                    color={!alive ? 'gray' : isHit ? 'red' : undefined}
                    dimColor={!alive}
                  >{fadeSpriteLine(line, fp)}</Text>
                ))
              ) : (
                <Text color={!alive ? 'gray' : undefined}>(no sprite)</Text>
              )}
            </Box>
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
  );
}

// ====================================================================
// Hand strip — mini cards with arrow above focused
// ====================================================================

function HandStrip({
  hand, focusedHandId,
}: {
  hand: ReadonlyArray<CardInstance>;
  focusedHandId: string | null;
}): React.ReactElement {
  const game = useGame();
  if (hand.length === 0) {
    return (
      <Box marginTop={1}>
        <Text dimColor>(손패 없음)</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>손패</Text>
      {/* Arrow row */}
      <Box flexDirection="row">
        {hand.map((c, i) => (
          <Box key={`arr-${c.instanceId}`} width={5} alignItems="center">
            {c.instanceId === focusedHandId
              ? <Text color="yellow" bold>▼</Text>
              : <Text> </Text>}
          </Box>
        ))}
      </Box>
      {/* Card row */}
      <Box flexDirection="row">
        {hand.map(c => {
          const def = game.registries.cards.get(c.defId);
          const resolved = resolveCardEffects(def, c, game.registries.modifiers);
          const cost = resolved.cost.kind === 'fixed' ? String(resolved.cost.value) : '?';
          const typeChar = def.type === 'attack' ? 'A'
            : def.type === 'skill'  ? 'S'
            : def.type === 'power'  ? 'P'
            : def.type === 'curse'  ? 'C'
            : 'X';
          const color =
            def.type === 'attack' ? 'red'
          : def.type === 'skill'  ? 'green'
          : def.type === 'power'  ? 'magenta'
          : 'gray';
          const isFocused = c.instanceId === focusedHandId;
          return (
            <Box key={c.instanceId} flexDirection="column" width={5} alignItems="center">
              <Text color={color as any} bold={isFocused}>┌─┐</Text>
              <Text color={color as any} bold={isFocused}>│{cost}{typeChar}│</Text>
              <Text color={color as any} bold={isFocused}>└─┘</Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

// ====================================================================
// Pile counts — block-shade visualization
// ====================================================================

function PileCounts({
  drawN, discardN, exhaustN, turn,
}: {
  drawN: number;
  discardN: number;
  exhaustN: number;
  turn: number;
}): React.ReactElement {
  return (
    <Box flexDirection="row" marginTop={1}>
      <Text color="cyan">▓▓</Text>
      <Text>  덱 {drawN}    </Text>
      <Text color="yellow">▒▒</Text>
      <Text>  버림 {discardN}    </Text>
      <Text color="gray">░░</Text>
      <Text>  소멸 {exhaustN}    </Text>
      <Text dimColor>턴 {turn}</Text>
    </Box>
  );
}

// ====================================================================
// HP bar
// ====================================================================

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

// ====================================================================
// Detail panels (right column)
// ====================================================================

function CardInstanceDetail({ card, player }: { card: CardInstance; player: PlayerActor }): React.ReactElement {
  const game = useGame();
  const def = game.registries.cards.get(card.defId);
  const resolved = resolveCardEffects(def, card, game.registries.modifiers);
  const previews = resolved.effects
    .map(eff => formatEffectPreview(eff, player, game.registries.statuses))
    .filter((s): s is string => s !== null);
  return (
    <Box flexDirection="column">
      <Text bold color={gradeColor(def.rarity)}>
        {wrapWithGradeBrackets(def.name, def.rarity)}
      </Text>
      <Text>비용: {resolved.cost.kind === 'fixed' ? resolved.cost.value : resolved.cost.kind}</Text>
      <Text>타입: {def.type}  타겟: {def.target.kind}  등급: {def.rarity}</Text>
      <Box marginTop={1}><Text>{def.baseDescription}</Text></Box>
      {previews.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color="green">예상 효과</Text>
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
