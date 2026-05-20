import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useDispatch, useGame } from '../EngineContext.js';
import { FocusList, type FocusListItem } from '../layout/FocusList.js';
import { ThreeBoxLayout } from '../layout/ThreeBoxLayout.js';
import { edgeKey } from '../../types/index.js';
import type { MapNode, MapState } from '../../types/index.js';

/**
 * MapScreen — bordered-cell grid + neighbor picker.
 *
 * Each grid cell is a small Box with:
 *   - 'double' border + yellow color when it's the CURRENT player position
 *   - 'single' border + cyan + bold (blinking) when it's the FOCUSED next
 *     destination from the neighbor list
 *   - 'single' border in node-type color when reachable (not focused)
 *   - 'single' dim gray border when visited (already cleared)
 *   - 'single' very-dim gray when unknown / unreachable
 *
 * Edges between cells are explicit characters:
 *   - white `──` / `│` for available (not consumed)
 *   - red `··` / `·` for consumed (cannot re-traverse)
 *   - dim space when no edge exists in this map
 */

export function MapScreen(): React.ReactElement {
  const game = useGame();
  const dispatch = useDispatch();
  const run = game.state.run!;
  const map = run.map;
  const neighbors = game.getMovableNeighbors();

  const [focused, setFocused] = useState<MapNode | null>(neighbors[0] ?? null);

  // Blink the focused target cell at 500ms cadence
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
            ↑↓ 선택  Enter 이동  ·  엣지 1회용 (같은 길 두 번 못 감)  ·  '*' 나, 노란 깜박임=이동 대상
          </Text>
          {isDeadEnd && (
            <Text color="red">길이 막혔습니다 — 엔진이 자동 복구합니다…</Text>
          )}
        </Box>
      }
      right={
        <Box flexDirection="column">
          {focused ? (
            <>
              <Text bold color="cyan">{nodeTypeLabel(focused.nodeType)}</Text>
              <Text dimColor>좌표 ({focused.x}, {focused.y})</Text>
              {focused.eventId && (
                <Box marginTop={1}><Text>이벤트: {focused.eventId}</Text></Box>
              )}
              {focused.enemyGroupId && (
                <Box marginTop={1}><Text>적: {focused.enemyGroupId}</Text></Box>
              )}
              <Box marginTop={1}><Text dimColor>{nodeTypeFlavor(focused.nodeType)}</Text></Box>
              <Box marginTop={2} flexDirection="column">
                <Text bold>현재</Text>
                <Text dimColor>좌표 ({map.nodes[map.currentNodeKey]?.x},{map.nodes[map.currentNodeKey]?.y})</Text>
                <Text dimColor>방문 {map.visitedNodeKeys.size}/{Object.keys(map.nodes).length}</Text>
              </Box>
            </>
          ) : (
            <>
              <Text dimColor>(이동 가능 노드 없음)</Text>
              <Box marginTop={1}>
                <Text dimColor>엔진이 길을 다시 열고 있습니다…</Text>
              </Box>
            </>
          )}
        </Box>
      }
    />
  );
}

// ====================================================================
// MapGrid — bordered cells in a flexbox grid
// ====================================================================

function MapGrid({ focusedKey, blink }: { focusedKey: string | null; blink: boolean }): React.ReactElement {
  const game = useGame();
  const run = game.state.run!;
  const map = run.map;
  const movable = new Set(game.getMovableNeighbors().map(n => n.key));

  const rows: React.ReactElement[] = [];
  for (let y = 0; y < map.height; y++) {
    // Cell row (horizontal cells + horizontal edges)
    rows.push(<CellRow key={`row-${y}`} y={y} map={map} movable={movable} focusedKey={focusedKey} blink={blink} />);
    // Vertical edge row between cells (skip after last row)
    if (y + 1 < map.height) {
      rows.push(<VerticalEdgeRow key={`vrow-${y}`} y={y} map={map} />);
    }
  }

  return <Box flexDirection="column">{rows}</Box>;
}

function CellRow({
  y, map, movable, focusedKey, blink,
}: {
  y: number;
  map: MapState;
  movable: ReadonlySet<string>;
  focusedKey: string | null;
  blink: boolean;
}): React.ReactElement {
  const children: React.ReactElement[] = [];
  for (let x = 0; x < map.width; x++) {
    const key = `${x},${y}`;
    const node = map.nodes[key];
    if (node) {
      children.push(
        <Cell
          key={`cell-${key}`}
          node={node}
          isCurrent={key === map.currentNodeKey}
          isMovable={movable.has(key)}
          isVisited={map.visitedNodeKeys.has(key)}
          isFocused={key === focusedKey}
          blink={blink}
        />,
      );
    } else {
      children.push(<EmptyCell key={`empty-${key}`} />);
    }
    // Horizontal edge to next cell
    if (x + 1 < map.width) {
      const rightKey = `${x + 1},${y}`;
      const edge = map.edges[edgeKey(key, rightKey)];
      children.push(
        <HEdge
          key={`hedge-${key}`}
          exists={!!edge}
          consumed={edge?.consumed ?? false}
        />,
      );
    }
  }
  return <Box flexDirection="row">{children}</Box>;
}

function VerticalEdgeRow({
  y, map,
}: {
  y: number;
  map: MapState;
}): React.ReactElement {
  const children: React.ReactElement[] = [];
  for (let x = 0; x < map.width; x++) {
    const upKey = `${x},${y}`;
    const downKey = `${x},${y + 1}`;
    const edge = map.edges[edgeKey(upKey, downKey)];
    children.push(
      <VEdgeBlock
        key={`vedge-${upKey}`}
        exists={!!edge}
        consumed={edge?.consumed ?? false}
      />,
    );
    if (x + 1 < map.width) {
      // Empty gap (where horizontal edge would be in cell rows)
      children.push(<Text key={`gap-${x}`}>   </Text>);
    }
  }
  return <Box flexDirection="row">{children}</Box>;
}

// ====================================================================
// Cell + edge components
// ====================================================================

const CELL_WIDTH = 5;
const CELL_HEIGHT = 3;

function Cell({
  node, isCurrent, isMovable, isVisited, isFocused, blink,
}: {
  node: MapNode;
  isCurrent: boolean;
  isMovable: boolean;
  isVisited: boolean;
  isFocused: boolean;
  blink: boolean;
}): React.ReactElement {
  const icon = isCurrent ? '*' : markerFor(node);
  let borderColor: string;
  let textColor: string;
  let bold = false;

  if (isCurrent) {
    borderColor = 'yellow';
    textColor = 'yellow';
    bold = true;
  } else if (isFocused) {
    borderColor = blink ? 'yellow' : 'white';
    textColor = blink ? 'yellow' : 'white';
    bold = true;
  } else if (isMovable) {
    borderColor = colorFor(node.nodeType);
    textColor = colorFor(node.nodeType);
    bold = true;
  } else if (isVisited) {
    borderColor = 'gray';
    textColor = 'gray';
  } else {
    borderColor = 'gray';
    textColor = 'gray';
  }

  return (
    <Box
      borderStyle={isCurrent ? 'double' : 'single'}
      borderColor={borderColor as any}
      width={CELL_WIDTH}
      height={CELL_HEIGHT}
      alignItems="center"
      justifyContent="center"
    >
      <Text color={textColor as any} bold={bold}>{icon}</Text>
    </Box>
  );
}

function EmptyCell(): React.ReactElement {
  return <Box width={CELL_WIDTH} height={CELL_HEIGHT}><Text> </Text></Box>;
}

function HEdge({ exists, consumed }: { exists: boolean; consumed: boolean }): React.ReactElement {
  // 3-line tall, 3-wide, edge drawn in middle line
  const top = '   ';
  const mid = !exists ? '   ' : (consumed ? '···' : '───');
  const bot = '   ';
  const color = !exists ? 'gray' : (consumed ? 'red' : 'white');
  return (
    <Box flexDirection="column">
      <Text>{top}</Text>
      <Text color={color as any}>{mid}</Text>
      <Text>{bot}</Text>
    </Box>
  );
}

function VEdgeBlock({ exists, consumed }: { exists: boolean; consumed: boolean }): React.ReactElement {
  // 1 line tall, CELL_WIDTH wide. Vertical bar centered.
  const half = Math.floor(CELL_WIDTH / 2);
  const left = ' '.repeat(half);
  const char = !exists ? ' ' : (consumed ? '·' : '│');
  const right = ' '.repeat(CELL_WIDTH - half - 1);
  const color = !exists ? 'gray' : (consumed ? 'red' : 'white');
  return (
    <Text color={color as any}>
      {left}{char}{right}
    </Text>
  );
}

// ====================================================================
// Markers + labels
// ====================================================================

function markerFor(n: MapNode): string {
  if (n.nodeType === 'rest')         return 'R';
  if (n.nodeType === 'combat_boss')  return 'B';
  if (n.nodeType === 'combat_elite') return 'E';
  if (n.nodeType.startsWith('combat')) return 'M';
  if (n.nodeType === 'shop')         return '$';
  if (n.nodeType === 'treasure')     return 'T';
  if (n.nodeType.startsWith('event')) return '!';
  return '?';
}

function colorFor(t: string | undefined): string {
  if (!t) return 'white';
  if (t === 'rest') return 'green';
  if (t === 'combat_boss')  return 'magenta';
  if (t === 'combat_elite') return 'red';
  if (t.startsWith('combat')) return 'red';
  if (t === 'shop') return 'cyan';
  if (t === 'treasure') return 'yellow';
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
    case 'rest':          return '휴식처 (탈출 노드)';
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
