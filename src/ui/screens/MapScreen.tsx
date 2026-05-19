import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useDispatch, useGame } from '../EngineContext.js';
import { FocusList, type FocusListItem } from '../layout/FocusList.js';
import { ThreeBoxLayout } from '../layout/ThreeBoxLayout.js';
import type { MapNode } from '../../types/index.js';

/**
 * Map screen — grid visualization + movable-neighbor list.
 *
 * Grid markers:
 *   *  : current position
 *   S  : start node (visited)
 *   R  : rest (run exit)
 *   E  : elite (forced via dead-end recovery)
 *   o  : visited
 *   .  : reachable from current
 *   ?  : unknown / unreachable
 *
 * Right panel: focused-neighbor preview.
 */

export function MapScreen(): React.ReactElement {
  const game = useGame();
  const dispatch = useDispatch();
  const run = game.state.run!;
  const map = run.map;
  const neighbors = game.getMovableNeighbors();

  const [focused, setFocused] = useState<MapNode | null>(neighbors[0] ?? null);

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

  return (
    <ThreeBoxLayout
      title="맵"
      main={
        <Box flexDirection="column">
          <MapGrid />
          <Box marginTop={1}>
            <Text bold>이동 가능 노드 (Enter로 이동)</Text>
          </Box>
          {items.length === 0 ? (
            <Box marginTop={1}><Text color="red">막힘! Esc 메뉴 또는 자동 복구 대기</Text></Box>
          ) : (
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
          <Text dimColor>↑↓ 선택  Enter 이동  (엣지 1회용 — 같은 길 두 번 못 감)</Text>
          {game.checkDeadEnd() && (
            <Text color="red">길이 막혔습니다. 곧 엘리트가 길을 엽니다.</Text>
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
            </>
          ) : (
            <Text dimColor>(선택된 노드 없음)</Text>
          )}
        </Box>
      }
    />
  );
}

function MapGrid(): React.ReactElement {
  const game = useGame();
  const run = game.state.run!;
  const map = run.map;
  const cur = map.nodes[map.currentNodeKey]!;
  const movable = new Set(game.getMovableNeighbors().map(n => n.key));

  const rows: string[][] = [];
  for (let y = 0; y < map.height; y++) {
    const row: string[] = [];
    for (let x = 0; x < map.width; x++) {
      const key = `${x},${y}`;
      const node = map.nodes[key];
      if (!node) { row.push(' . '); continue; }
      const visited = map.visitedNodeKeys.has(key);
      let cell: string;
      if (key === map.currentNodeKey) cell = ' * ';
      else if (movable.has(key)) cell = ` ${markerFor(node)} `;
      else if (visited) cell = ' o ';
      else cell = ' ? ';
      row.push(cell);
    }
    rows.push(row);
  }

  return (
    <Box flexDirection="column">
      <Text dimColor>현재: ({cur.x},{cur.y})  · '*' 나, 색 글자=이동 가능, 'o' 방문, '?' 미발견</Text>
      <Box flexDirection="column" marginTop={1}>
        {rows.map((row, y) => (
          <Box key={y}>
            <Text dimColor>{y.toString().padStart(2)} </Text>
            {row.map((c, x) => {
              const key = `${x},${y}`;
              const node = map.nodes[key];
              const isMovable = movable.has(key);
              const isCurrent = key === map.currentNodeKey;
              return (
                <Text
                  key={x}
                  bold={isCurrent || isMovable}
                  color={
                    isCurrent      ? 'yellow'
                  : isMovable      ? colorFor(node?.nodeType)
                  : 'gray'
                  }
                >{c}</Text>
              );
            })}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function markerFor(n: MapNode): string {
  if (n.nodeType === 'rest')         return 'R';
  if (n.nodeType === 'combat_boss')  return 'B';
  if (n.nodeType === 'combat_elite') return 'E';
  if (n.nodeType.startsWith('combat')) return 'M';
  if (n.nodeType === 'shop')         return '$';
  if (n.nodeType === 'treasure')     return 'T';
  if (n.nodeType.startsWith('event')) return '!';
  return '.';
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
