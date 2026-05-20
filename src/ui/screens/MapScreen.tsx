import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useDispatch, useGame } from '../EngineContext.js';
import { FocusList, type FocusListItem } from '../layout/FocusList.js';
import { ThreeBoxLayout } from '../layout/ThreeBoxLayout.js';
import { edgeKey } from '../../types/index.js';
import type { MapNode, MapState } from '../../types/index.js';

/**
 * MapScreen — 15×15 bordered cells with emoji content + fog of war.
 *
 * Cell geometry (shared borders, 4w × 2h per cell — visually square):
 *   total = 15*4+1 = 61 chars wide
 *   total = 15*2+1 = 31 chars tall
 *
 * Each cell:
 *   ┬────┬       <- top border (4 wide: 3 dashes + junction)
 *   │ XX │       <- content row: border + emoji(2) + space(1) + border
 *
 * Fog of war (per user spec):
 *   - Only the 4 cells PHYSICALLY ADJACENT (up/down/left/right) to current
 *     are visible with their emoji + colored border
 *   - Current cell ⭐ always visible
 *   - Rest hub ⛺ always visible (永久 goal)
 *   - Everything else: ▒▒▒ gray shade, gray border
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

  const items: FocusListItem<MapNode>[] = neighbors.map(n => {
    const isVisitedNonRest = map.visitedNodeKeys.has(n.key) && n.nodeType !== 'rest';
    const typeLabel = isVisitedNonRest ? '(빈방)' : nodeTypeLabel(n.nodeType);
    return {
      id: n.key,
      label: `${dirLabel(map.currentNodeKey, n.key)} — ${typeLabel}`,
      value: n,
    };
  });

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
  _state: MapState,
  focusedKey: string | null,
  _movable: ReadonlySet<string>,
  blink: boolean,
): string {
  // Per user spec: only the currently-FOCUSED (selected next move) cell
  // gets a colored border. Everything else stays a subtle gray so the
  // grid doesn't become a rainbow.
  if (!cell) return 'gray';
  if (focusedKey === cell.key) return blink ? 'yellow' : 'white';
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

const CELL_W = 4; // includes shared border at left
const CELL_H = 2; // includes shared border at top

function MapGrid({ focusedKey, blink }: { focusedKey: string | null; blink: boolean }): React.ReactElement {
  const game = useGame();
  const run = game.state.run!;
  const map = run.map;
  const movable = new Set(game.getMovableNeighbors().map(n => n.key));
  const W = map.width;
  const H = map.height;

  const totalWidth = W * CELL_W + 1;
  const totalHeight = H * CELL_H + 1;

  // Physical-adjacency visibility (fog of war): only current + 4 neighbors
  // (up/down/left/right) + rest hub are revealed
  const cur = map.nodes[map.currentNodeKey]!;
  const visibleKeys = new Set<string>([map.currentNodeKey]);
  const dirs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dy] of dirs) {
    const key = `${cur.x + dx},${cur.y + dy}`;
    if (map.nodes[key]) visibleKeys.add(key);
  }
  // Rest hub always visible
  for (const n of Object.values(map.nodes)) {
    if (n.nodeType === 'rest') visibleKeys.add(n.key);
  }

  const cellAt = (cx: number, cy: number): MapNode | undefined => {
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return undefined;
    return map.nodes[`${cx},${cy}`];
  };

  const rows: React.ReactElement[] = [];
  for (let y = 0; y < totalHeight; y++) {
    rows.push(
      <Box key={`row-${y}`} flexDirection="row">
        {renderRow(y, totalWidth, W, H, map, focusedKey, blink, movable, visibleKeys, cellAt)}
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
  visibleKeys: ReadonlySet<string>,
  cellAt: (cx: number, cy: number) => MapNode | undefined,
): React.ReactElement[] {
  const onHBorder = (y % CELL_H === 0);
  const cy_content = Math.floor(y / CELL_H);
  const cy_above = y / CELL_H - 1;
  const cy_below = y / CELL_H;

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
    const onVBorder = (x % CELL_W === 0);
    const cx_left = x / CELL_W - 1;
    const cx_right = x / CELL_W;
    const cx_content = Math.floor(x / CELL_W);
    const contentX = x % CELL_W; // 0=border, 1/2/3=content (4-wide cells)

    if (onHBorder && onVBorder) {
      const tl = cellAt(cx_left, cy_above);
      const tr = cellAt(cx_right, cy_above);
      const bl = cellAt(cx_left, cy_below);
      const br = cellAt(cx_right, cy_below);
      const ch = junctionChar(x, y, W, H);
      const color = strongestColor([tl, tr, bl, br], map, focusedKey, movable, blink);
      push(ch, color);
      x++;
    } else if (onHBorder) {
      const above = cellAt(cx_content, cy_above);
      const below = cellAt(cx_content, cy_below);
      const color = strongestColor([above, below], map, focusedKey, movable, blink);
      // Mark consumed edges with ╳ at the middle char of this border span
      const isMiddleOfBorder = (x % CELL_W === 2);
      let char = '─';
      if (above && below && isMiddleOfBorder) {
        const edge = map.edges[edgeKey(above.key, below.key)];
        if (edge?.consumed) char = '╳';
      }
      push(char, color);
      x++;
    } else if (onVBorder) {
      const left = cellAt(cx_left, cy_content);
      const right = cellAt(cx_right, cy_content);
      const color = strongestColor([left, right], map, focusedKey, movable, blink);
      let char = '│';
      if (left && right) {
        const edge = map.edges[edgeKey(left.key, right.key)];
        if (edge?.consumed) char = '╳';
      }
      push(char, color);
      x++;
    } else {
      // Content row inside a cell. 3 chars wide: [1] [2] [3]
      // Layout: emoji (2 chars at positions 1,2) + space (position 3)
      const cell = cellAt(cx_content, cy_content);
      if (contentX === 1) {
        const ec = emojiCellContent(cell, map, focusedKey, visibleKeys);
        push(ec.text, ec.color);
        x += ec.width; // emoji = 2 cols, fog placeholder also 2-3 cols
      } else if (contentX === 3) {
        // Right-pad space — appears AFTER the emoji
        push(' ', 'gray');
        x++;
      } else {
        // contentX === 2 should be covered by emoji emission at contentX === 1
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
  W: number, H: number,
): string {
  const isTop = y === 0;
  const isBot = y === H * CELL_H;
  const isLeft = x === 0;
  const isRight = x === W * CELL_W;
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
  width: number;   // visual cols consumed (emoji = 2, ascii placeholder = N)
}

function emojiCellContent(
  cell: MapNode | undefined,
  state: MapState,
  focusedKey: string | null,
  visibleKeys: ReadonlySet<string>,
): ContentChunk {
  if (!cell) {
    return { text: '░░', color: 'gray', width: 2 };
  }
  const isCurrent = cell.key === state.currentNodeKey;
  const isRest = cell.nodeType === 'rest';
  const isVisible = visibleKeys.has(cell.key);
  const isVisited = state.visitedNodeKeys.has(cell.key);

  if (isCurrent) {
    return { text: '⭐', color: 'yellow', width: 2 };
  }
  if (isRest) {
    return { text: '⛺', color: 'cyan', width: 2 };
  }
  if (!isVisible) {
    // Fog of war
    return { text: '░░', color: 'gray', width: 2 };
  }
  // Visible (= physically adjacent to current) — but if already cleared,
  // show as "empty room" so player isn't tempted to revisit for content.
  if (isVisited) {
    return { text: '  ', color: 'gray', width: 2 };
  }
  void focusedKey;
  return { text: emojiForType(cell.nodeType), color: 'white', width: 2 };
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
