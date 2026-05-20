import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useDispatch, useGame } from '../EngineContext.js';
import { FocusList, type FocusListItem } from '../layout/FocusList.js';
import { ThreeBoxLayout } from '../layout/ThreeBoxLayout.js';
import type { MapNode, MapState } from '../../types/index.js';

/**
 * MapScreen — compact 15×15 grid of cells, no connection lines.
 *
 * Cell rendering: 2 chars wide, 1 char tall. Each cell shows a 1-char
 * marker + 1-char trailing space (for spacing density). Block / shade
 * chars (▒ ░ ▓) used for unknown / unvisited cells.
 *
 * Colors:
 *   yellow bold blink   → currently focused destination
 *   yellow bold solid   → player's current position ('*')
 *   cyan  bold          → rest hub (⌂) — never disappears
 *   bright + type color → movable adjacent (M / E / B / $ / T / !)
 *   dim gray            → visited (cleared)
 *   dim shade           → unvisited / far
 *
 * Edges are NOT rendered visually. The neighbor FocusList at bottom
 * lists which adjacent cells are still reachable.
 */

export function MapScreen(): React.ReactElement {
  const game = useGame();
  const dispatch = useDispatch();
  const run = game.state.run!;
  const map = run.map;
  const neighbors = game.getMovableNeighbors();

  const [focused, setFocused] = useState<MapNode | null>(neighbors[0] ?? null);

  // Blink the focused target at 500ms cadence
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
            ↑↓ 선택  Enter 이동  ·  엣지 1회용  ·  '*' 나, ⌂ 휴식처 (목표)
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
// MapGrid — 15×15 compact cells, no edge lines
// ====================================================================

function MapGrid({ focusedKey, blink }: { focusedKey: string | null; blink: boolean }): React.ReactElement {
  const game = useGame();
  const run = game.state.run!;
  const map = run.map;
  const movable = new Set(game.getMovableNeighbors().map(n => n.key));

  // Top frame
  const topBorder = '▄'.repeat(map.width * 2 + 2);
  const botBorder = '▀'.repeat(map.width * 2 + 2);

  const rows: React.ReactElement[] = [];
  for (let y = 0; y < map.height; y++) {
    rows.push(<CellRow key={`row-${y}`} y={y} map={map} movable={movable} focusedKey={focusedKey} blink={blink} />);
  }

  return (
    <Box flexDirection="column">
      <Text color="gray">{topBorder}</Text>
      {rows}
      <Text color="gray">{botBorder}</Text>
    </Box>
  );
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
  // Left wall
  children.push(<Text key="wl" color="gray">█</Text>);
  for (let x = 0; x < map.width; x++) {
    const key = `${x},${y}`;
    const node = map.nodes[key];
    if (!node) {
      children.push(<Text key={key}>  </Text>);
      continue;
    }
    children.push(
      <CellChar
        key={key}
        node={node}
        isCurrent={key === map.currentNodeKey}
        isMovable={movable.has(key)}
        isVisited={map.visitedNodeKeys.has(key)}
        isFocused={key === focusedKey}
        blink={blink}
      />,
    );
  }
  // Right wall
  children.push(<Text key="wr" color="gray">█</Text>);
  return <Box flexDirection="row">{children}</Box>;
}

function CellChar({
  node, isCurrent, isMovable, isVisited, isFocused, blink,
}: {
  node: MapNode;
  isCurrent: boolean;
  isMovable: boolean;
  isVisited: boolean;
  isFocused: boolean;
  blink: boolean;
}): React.ReactElement {
  let icon: string;
  let color: string;
  let bold = false;
  let dim = false;

  if (isCurrent) {
    icon = '* ';
    color = 'yellow';
    bold = true;
  } else if (node.nodeType === 'rest') {
    // Rest hub always visible + cyan
    icon = '⌂ ';
    color = 'cyan';
    bold = true;
  } else if (isFocused) {
    icon = `${markerFor(node)} `;
    color = blink ? 'yellow' : 'white';
    bold = true;
  } else if (isMovable) {
    icon = `${markerFor(node)} `;
    color = colorFor(node.nodeType);
    bold = true;
  } else if (isVisited) {
    icon = '· ';
    color = 'gray';
    dim = true;
  } else {
    icon = '▒▒';
    color = 'gray';
    dim = true;
  }

  return <Text color={color as any} bold={bold} dimColor={dim}>{icon}</Text>;
}

// ====================================================================
// Markers + labels
// ====================================================================

function markerFor(n: MapNode): string {
  if (n.nodeType === 'rest')         return '⌂';
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
  if (t === 'rest') return 'cyan';
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
