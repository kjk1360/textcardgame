import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useDispatch, useGame } from '../EngineContext.js';
import { FocusList, type FocusListItem } from '../layout/FocusList.js';
import { ThreeBoxLayout } from '../layout/ThreeBoxLayout.js';
import type { MapNode, MapState } from '../../types/index.js';

/**
 * MapScreen — 15×15 bordered cells with emoji content.
 *
 * Cell geometry (shared borders, 3w × 2h per cell, +1 for outer right/bottom):
 *   total = 15*3+1 = 46 chars wide
 *   total = 15*2+1 = 31 chars tall
 *
 * Each cell:
 *   ┬───┬       <- top border (junctions ┌ ┐ ┴ ┼ ┬ ─)
 *   │ X │       <- content row: vertical border + 2-col emoji
 *
 * Selection / state is indicated by BORDER COLOR (per-cell), not by
 * emoji color (emojis keep native color in terminals):
 *   yellow + blink → focused destination
 *   yellow         → current player position
 *   type-color     → movable adjacent
 *   cyan           → rest hub (永久)
 *   gray dim       → visited cleared / unknown
 *
 * Border-coloring rule when 2+ cells touch a segment: the highest-
 * precedence cell wins (focused > current > movable > rest > visited).
 */

export function MapScreen(): React.ReactElement {
  const game = useGame();
  const dispatch = useDispatch();
  const run = game.state.run!;
  const map = run.map;
  const neighbors = game.getMovableNeighbors();

  const [focused, setFocused] = useState<MapNode | null>(neighbors[0] ?? null);

  // Blink the focused cell border at 500ms cadence
  const [blink, setBlink] = useState(true);
  useEffect(() => {
    const t = setInterval(() => setBlink(b => !b), 500);
    return () => clearInterval(t);
  }, []);

  const items: FocusListItem<MapNode>[] = neighbors.map(n => ({
    id: n.key,
    label: `${dirLabel(map.currentNodeKey, n.key)} — ${nodeTypeLabel(n.nodeType)}`,
    value: n,
  }));

  const onSelect = (item: FocusListItem<MapNode>) => {
    dispatch(() => {
      game.moveTo(item.value.key);
    });
  };

  const isDeadEnd = neighbors.length === 0;

  return (
    <ThreeBoxLayout
      title="맵"
      main={
        <Box flexDirection="column">
          <MapGrid focusedKey={focused?.key ?? null} blink={blink} />
          <Box marginTop={1}>
            <Text bold>이동 가능 노드 {isDeadEnd && '(없음 — 자동 복구 대기)'}</Text>
          </Box>
          {!isDeadEnd && (
            <Box marginTop={1}>
              <FocusList
                items={items}
                onSelect={onSelect}
                onFocusChange={item => setFocused(item?.value ?? null)}
              />
            </Box>
          )}
        </Box>
      }
      bottom={
        <Box flexDirection="column">
          <Text dimColor>
            ↑↓ 선택  Enter 이동  ·  ⭐=나 ⛺=휴식처 ☠=전투 💀=엘리트 👑=보스 💰=상점 💎=보물 ❓=이벤트
          </Text>
          {isDeadEnd && (
            <Text color="red">길이 막혔습니다 — 엔진이 자동 복구합니다…</Text>
          )}
        </Box>
      }
      right={<MapRightPanel focused={focused} />}
    />
  );
}

function MapRightPanel({ focused }: { focused: MapNode | null }): React.ReactElement {
  const game = useGame();
  const run = game.state.run!;
  const map = run.map;
  const cur = map.nodes[map.currentNodeKey]!;
  const visited = map.visitedNodeKeys.size;
  const total = Object.keys(map.nodes).length;
  return (
    <Box flexDirection="column">
      {focused ? (
        <>
          <Text bold color="cyan">{nodeTypeLabel(focused.nodeType)}</Text>
          <Text dimColor>좌표 ({focused.x}, {focused.y})</Text>
          {focused.eventId && <Box marginTop={1}><Text>이벤트: {focused.eventId}</Text></Box>}
          {focused.enemyGroupId && <Box marginTop={1}><Text>적: {focused.enemyGroupId}</Text></Box>}
          <Box marginTop={1}><Text dimColor>{nodeTypeFlavor(focused.nodeType)}</Text></Box>
        </>
      ) : (
        <Text dimColor>(이동 가능 노드 없음)</Text>
      )}
      <Box marginTop={2} flexDirection="column">
        <Text bold>현재</Text>
        <Text dimColor>좌표 ({cur.x},{cur.y})  ·  {nodeTypeLabel(cur.nodeType)}</Text>
        <Text dimColor>방문 {visited}/{total}</Text>
      </Box>
    </Box>
  );
}

// ====================================================================
// MapGrid — shared-border render with per-cell border coloring
// ====================================================================

type Precedence = 0 | 1 | 2 | 3 | 4 | 5;

function cellPrecedence(
  cell: MapNode | undefined,
  state: MapState,
  focusedKey: string | null,
  movable: ReadonlySet<string>,
): Precedence {
  if (!cell) return 0;
  if (focusedKey === cell.key)        return 5;
  if (cell.key === state.currentNodeKey) return 4;
  if (movable.has(cell.key))          return 3;
  if (cell.nodeType === 'rest')       return 2;
  if (state.visitedNodeKeys.has(cell.key)) return 1;
  return 0;
}

function cellBorderColor(
  cell: MapNode | undefined,
  state: MapState,
  focusedKey: string | null,
  movable: ReadonlySet<string>,
  blink: boolean,
): string {
  if (!cell) return 'gray';
  if (focusedKey === cell.key)   return blink ? 'yellow' : 'white';
  if (cell.key === state.currentNodeKey) return 'yellow';
  if (movable.has(cell.key))     return colorFor(cell.nodeType);
  if (cell.nodeType === 'rest')  return 'cyan';
  if (state.visitedNodeKeys.has(cell.key)) return 'gray';
  return 'gray';
}

function strongestColor(
  candidates: ReadonlyArray<MapNode | undefined>,
  state: MapState,
  focusedKey: string | null,
  movable: ReadonlySet<string>,
  blink: boolean,
): string {
  let bestPrec: Precedence = 0;
  let bestCell: MapNode | undefined;
  for (const c of candidates) {
    const p = cellPrecedence(c, state, focusedKey, movable);
    if (p > bestPrec) { bestPrec = p; bestCell = c; }
  }
  return cellBorderColor(bestCell, state, focusedKey, movable, blink);
}

function MapGrid({ focusedKey, blink }: { focusedKey: string | null; blink: boolean }): React.ReactElement {
  const game = useGame();
  const run = game.state.run!;
  const map = run.map;
  const movable = new Set(game.getMovableNeighbors().map(n => n.key));
  const W = map.width;
  const H = map.height;

  const totalWidth = W * 3 + 1;
  const totalHeight = H * 2 + 1;

  const cellAt = (cx: number, cy: number): MapNode | undefined => {
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return undefined;
    return map.nodes[`${cx},${cy}`];
  };

  const rows: React.ReactElement[] = [];
  for (let y = 0; y < totalHeight; y++) {
    rows.push(
      <Box key={`row-${y}`} flexDirection="row">
        {renderRow(y, totalWidth, W, H, map, focusedKey, blink, movable, cellAt)}
      </Box>,
    );
  }

  return <Box flexDirection="column">{rows}</Box>;
}

function renderRow(
  y: number,
  totalWidth: number,
  W: number,
  H: number,
  map: MapState,
  focusedKey: string | null,
  blink: boolean,
  movable: ReadonlySet<string>,
  cellAt: (cx: number, cy: number) => MapNode | undefined,
): React.ReactElement[] {
  const onHBorder = (y % 2 === 0);
  const cy_content = (y - 1) / 2;  // valid when !onHBorder
  const cy_above = y / 2 - 1;       // valid when onHBorder
  const cy_below = y / 2;           // valid when onHBorder

  // Build segments of consecutive same-color chars to minimize Text nodes
  const segments: Array<{ text: string; color: string }> = [];
  const push = (text: string, color: string) => {
    if (segments.length > 0 && segments[segments.length - 1]!.color === color) {
      segments[segments.length - 1]!.text += text;
    } else {
      segments.push({ text, color });
    }
  };

  let x = 0;
  while (x < totalWidth) {
    const onVBorder = (x % 3 === 0);
    const cx_left = x / 3 - 1;
    const cx_right = x / 3;
    const cx_content = Math.floor(x / 3);

    if (onHBorder && onVBorder) {
      // Junction at (x, y) — up to 4 cells touch
      const tl = cellAt(cx_left, cy_above);
      const tr = cellAt(cx_right, cy_above);
      const bl = cellAt(cx_left, cy_below);
      const br = cellAt(cx_right, cy_below);
      const ch = junctionChar(x, y, totalWidth, totalWidth /* unused for H */, W, H);
      const color = strongestColor([tl, tr, bl, br], map, focusedKey, movable, blink);
      push(ch, color);
      x++;
    } else if (onHBorder) {
      // Horizontal border between cells above (cy_above) and below (cy_below) at column cx_content
      const above = cellAt(cx_content, cy_above);
      const below = cellAt(cx_content, cy_below);
      const color = strongestColor([above, below], map, focusedKey, movable, blink);
      push('─', color);
      x++;
    } else if (onVBorder) {
      // Vertical border between cells left and right at row cy_content
      const left = cellAt(cx_left, cy_content);
      const right = cellAt(cx_right, cy_content);
      const color = strongestColor([left, right], map, focusedKey, movable, blink);
      push('│', color);
      x++;
    } else {
      // Content row, content column
      const cell = cellAt(cx_content, cy_content);
      const contentX = x % 3; // 1 or 2
      if (contentX === 1) {
        // Emit the 2-col emoji (or 2-char placeholder)
        const ec = emojiCellContent(cell, map, focusedKey);
        // Emoji's "color" in segments is set to default (we use native color),
        // but we still push as default to break the segment.
        push(ec.text, ec.color);
        x += 2; // emoji takes 2 cols
      } else {
        // contentX === 2 should be skipped (already covered)
        x++;
      }
    }
  }

  return segments.map((s, i) => (
    <Text key={i} color={s.color as any}>{s.text}</Text>
  ));
}

function junctionChar(
  x: number, y: number,
  totalWidth: number,
  _totalHeight: number,
  W: number, H: number,
): string {
  const isTop = y === 0;
  const isBot = y === H * 2;
  const isLeft = x === 0;
  const isRight = x === W * 3;
  if (isTop && isLeft)  return '┌';
  if (isTop && isRight) return '┐';
  if (isBot && isLeft)  return '└';
  if (isBot && isRight) return '┘';
  if (isTop)            return '┬';
  if (isBot)            return '┴';
  if (isLeft)           return '├';
  if (isRight)          return '┤';
  return '┼';
}

interface ContentChunk {
  text: string;
  color: string;
}

function emojiCellContent(
  cell: MapNode | undefined,
  state: MapState,
  focusedKey: string | null,
): ContentChunk {
  if (!cell) {
    return { text: '▒▒', color: 'gray' };
  }
  const isCurrent = cell.key === state.currentNodeKey;
  const isRest = cell.nodeType === 'rest';
  const isVisited = state.visitedNodeKeys.has(cell.key);
  const isFocused = focusedKey === cell.key;

  if (isCurrent) {
    return { text: '⭐', color: 'yellow' };
  }
  if (isRest) {
    return { text: '⛺', color: 'cyan' };
  }
  if (isFocused || isVisited) {
    return { text: emojiForType(cell.nodeType), color: 'white' };
  }
  // Unvisited and not directly reachable → fog of war
  // (Movable cells are not necessarily visited either — but they're
  //  adjacent to current. Expose them via focused state above.)
  // For movable but unvisited adjacent, also show the emoji.
  return { text: emojiForType(cell.nodeType), color: 'white' };
}

function emojiForType(t: string): string {
  switch (t) {
    case 'rest':           return '⛺';
    case 'combat_normal':  return '☠️';
    case 'combat_elite':   return '💀';
    case 'combat_boss':    return '👑';
    case 'combat_finalBoss': return '👑';
    case 'shop':           return '💰';
    case 'treasure':       return '💎';
    case 'event_normal':   return '❓';
    case 'event_trigger':  return '❓';
    default:               return '❓';
  }
}

function colorFor(t: string | undefined): string {
  if (!t) return 'white';
  if (t === 'rest')        return 'cyan';
  if (t === 'combat_boss') return 'magenta';
  if (t === 'combat_elite') return 'red';
  if (t.startsWith('combat')) return 'red';
  if (t === 'shop')        return 'cyan';
  if (t === 'treasure')    return 'yellow';
  if (t.startsWith('event')) return 'blue';
  return 'white';
}

function nodeTypeLabel(t: string): string {
  switch (t) {
    case 'combat_normal': return '일반 전투';
    case 'combat_elite':  return '엘리트 전투';
    case 'combat_boss':   return '보스 전투';
    case 'event_normal':  return '이벤트';
    case 'event_trigger': return '특수 이벤트';
    case 'shop':          return '상점';
    case 'treasure':      return '보물';
    case 'rest':          return '휴식처 (목표 — 돌아오면 런 종료)';
    default: return t;
  }
}

function nodeTypeFlavor(t: string): string {
  switch (t) {
    case 'rest':          return '여기로 이동하면 차원문 탐사가 끝납니다.';
    case 'combat_boss':   return '강력한 보스. 신중하게 진입하세요.';
    case 'combat_elite':  return '난폭한 엘리트. 더 큰 보상.';
    case 'shop':          return '카드 또는 강화를 구매할 수 있습니다.';
    case 'treasure':      return '랜덤 보상 — 카드 / 골드 / 유물.';
    default: return '이 노드를 진입하면 해당 이벤트가 발동합니다.';
  }
}

function dirLabel(fromKey: string, toKey: string): string {
  const [fx, fy] = fromKey.split(',').map(Number) as [number, number];
  const [tx, ty] = toKey.split(',').map(Number) as [number, number];
  if (tx > fx) return '동';
  if (tx < fx) return '서';
  if (ty > fy) return '남';
  if (ty < fy) return '북';
  return '?';
}
