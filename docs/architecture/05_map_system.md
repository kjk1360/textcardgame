# 05. 맵 시스템

## 핵심 룰 (요약)

1. **그리드 형태** (NxM 바둑판).
2. **노드** 마다 이벤트(전투/상점/일반/엘리트/보스/유물/...)가 배치.
3. **엣지 = 인접 노드 사이 경로**. 한 번 사용하면 소비. 다시는 못 씀.
4. **노드 재진입 가능**, 단 이벤트는 재실행 X (오직 다음 노드 선택용).
5. **가시성**: 현재 노드에서 미사용 엣지로 갈 수 있는 인접 노드만 보임.
6. **막힘 해소**: 현재 노드의 모든 엣지가 소비되어 갈 곳이 없으면 → 지나친 노드 1개에 엘리트 이벤트가 강제 스폰 + 그 노드까지의 엣지 하나 부활.
7. **휴식처 복귀** = 던전 종료. 맵 폐기, 다음 진입 시 새로 생성.

## 좌표계

```
y=0 ─ [0,0] [1,0] [2,0]
y=1 ─ [0,1] [1,1] [2,1]
y=2 ─ [0,2] [1,2] [2,2]
       │     │     │
       x=0   x=1   x=2
```

`nodeKey: "${x},${y}"`. 인접: `(±1, 0)` 또는 `(0, ±1)` (대각선 없음).

## 엣지 ID 규칙

```typescript
function edgeKey(aKey: string, bKey: string): string {
  return [aKey, bKey].sort().join('|');
}
// edgeKey('1,2', '1,3') → '1,2|1,3'
// edgeKey('1,3', '1,2') → '1,2|1,3'   (동일)
```

엣지의 소비 여부는 `EdgeState.consumed` 로만 추적.

## 생성 알고리즘

```typescript
function generateMap(seed: string, params: MapGenParams): MapState {
  const rng = makeRng(seed);
  const { width, height, startKey, restKey } = params;

  // 1. 모든 가능한 엣지 생성 (그리드 인접쌍)
  const allEdges: EdgeState[] = [];
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const me = `${x},${y}`;
      if (x + 1 < width)  allEdges.push(makeEdge(me, `${x+1},${y}`));
      if (y + 1 < height) allEdges.push(makeEdge(me, `${x},${y+1}`));
    }
  }

  // 2. 일부 엣지 무작위 제거 → 너무 빽빽하지 않게 (디자인 변수)
  const keepRatio = params.edgeKeepRatio ?? 0.7;
  const kept = allEdges.filter(_ => rng.float() < keepRatio);

  // 3. 연결성 검증: startKey 에서 restKey 로 도달 가능한지
  const graph = buildGraph(kept);
  if (!isConnected(graph, startKey, restKey)) {
    // 부족한 엣지 보충 (BFS 기반 최단경로 엣지 강제 추가)
    const path = bfsPath(allEdges, startKey, restKey);
    for (const e of path) if (!kept.find(k => k.id === e.id)) kept.push(e);
  }

  // 4. 노드 타입 배치
  const nodes = assignNodeTypes(width, height, startKey, restKey, params.nodeDistribution, rng);

  return {
    width, height,
    nodes,
    edges: indexEdges(kept),
    currentNodeKey: startKey,
    visitedNodeKeys: new Set([startKey]),
    rngSeed: seed,
  };
}
```

### `MapGenParams`

```typescript
interface MapGenParams {
  width: number;                          // 예: 5
  height: number;                         // 예: 7
  startKey: string;                       // 예: "2,6" (맨 아래 가운데)
  restKey: string;                        // 예: "2,0" (맨 위 가운데) — 진짜 휴식처
  edgeKeepRatio: number;                  // 0~1 (디자인 변수, 0.7 권장)
  nodeDistribution: NodeDistribution;
}

interface NodeDistribution {
  combat_normal: number;       // 가중치
  combat_elite: number;
  shop: number;
  treasure: number;
  event_normal: number;
  event_trigger: number;
  // 시작/종료 노드는 별도 처리 (start/rest)
  // rest 노드는 맵에 별도로 박지 않음 — 휴식처는 던전 밖
}
```

### 노드 타입 배치

```typescript
function assignNodeTypes(
  w: number, h: number,
  startKey: string, restKey: string,
  dist: NodeDistribution,
  rng: IRandom,
): Record<string, MapNode> {
  const nodes: Record<string, MapNode> = {};
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const key = `${x},${y}`;
      let nodeType: NodeTypeId;
      if (key === startKey)      nodeType = 'event_normal'; // "여정의 시작"
      else if (key === restKey)  nodeType = 'rest';          // 던전 탈출
      else                       nodeType = weightedPick(dist, rng);

      const eventId    = pickEventForType(nodeType, rng);
      const enemyGroup = pickEnemyForType(nodeType, rng);
      nodes[key] = { key, x, y, nodeType, eventId, enemyGroupId: enemyGroup };
    }
  }
  return nodes;
}
```

### 거리 기반 노드 가중치 (옵션)

시작에 가까운 노드는 약한 적, 휴식처(맵 끝)에 가까운 노드는 강한 적 — 그래디언트:

```typescript
function adjustDistByDistance(dist: NodeDistribution, distFromRest: number, totalDist: number): NodeDistribution {
  const ratio = 1 - (distFromRest / totalDist);
  return {
    ...dist,
    combat_elite: dist.combat_elite * (1 + ratio),    // 휴식처 가까울수록 엘리트 ↑
    combat_normal: dist.combat_normal * (1 - ratio * 0.3),
  };
}
```

(이건 옵션. v1 일단 균등 분포로 시작 가능.)

## 이동 (Navigator)

```typescript
function getMovableNeighbors(map: MapState): MapNode[] {
  const result: MapNode[] = [];
  const cur = map.nodes[map.currentNodeKey];
  for (const dir of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const nx = cur.x + dir[0], ny = cur.y + dir[1];
    const neighborKey = `${nx},${ny}`;
    const neighbor = map.nodes[neighborKey];
    if (!neighbor) continue;
    const eKey = edgeKey(cur.key, neighbor.key);
    const edge = map.edges[eKey];
    if (!edge || edge.consumed) continue;
    result.push(neighbor);
  }
  return result;
}

function moveTo(map: MapState, targetKey: string): void {
  const cur = map.nodes[map.currentNodeKey];
  const target = map.nodes[targetKey];
  const eKey = edgeKey(cur.key, target.key);
  const edge = map.edges[eKey];
  if (!edge || edge.consumed) throw 'edge not usable';

  edge.consumed = true;
  map.currentNodeKey = targetKey;

  if (!map.visitedNodeKeys.has(targetKey)) {
    // 첫 진입 → 이벤트 발동
    triggerNodeEvent(target);
    map.visitedNodeKeys.add(targetKey);
  }
  // 이미 visited면 이벤트 없이 다음 노드 선택 UI로 진입
}
```

## 막힘 해소 (Dead-end Recovery)

```typescript
function checkAndRecoverDeadEnd(map: MapState): RecoveryResult | null {
  const movable = getMovableNeighbors(map);
  if (movable.length > 0) return null; // 막힘 아님

  // 1. 지나친 노드 중 하나 선택 (visited 이고 현재 노드 아님)
  //    가중치: 현재 위치에서 가까운 노드 우선?
  const candidates = [...map.visitedNodeKeys]
    .filter(k => k !== map.currentNodeKey)
    .map(k => map.nodes[k]);
  if (candidates.length === 0) {
    // 시작 노드에서 즉시 막힌 — 디자인상 일어나지 않아야 함. 강제 부활.
    return forceReviveAnyEdge(map);
  }

  // 2. 현재 위치에서 가장 가까운 후보 우선
  const cur = map.nodes[map.currentNodeKey];
  candidates.sort((a, b) => manhattanDist(a, cur) - manhattanDist(b, cur));
  const target = candidates[0];

  // 3. cur → target 으로 가는 엣지 부활 (또는 추가)
  //    인접하지 않으면 경로상 첫 엣지 부활
  const pathEdges = findEdgePathBetween(map, cur.key, target.key);
  if (pathEdges.length === 0) return forceReviveAnyEdge(map);

  for (const eKey of pathEdges) {
    const e = map.edges[eKey];
    if (e) { e.consumed = false; e.revived = true; }
  }

  // 4. target 노드를 엘리트 이벤트로 강제 전환
  target.nodeType = 'combat_elite';
  target.enemyGroupId = pickEliteEnemyGroup(rng);
  target.eventId = undefined;
  // visited 마킹 제거 → 다시 진입 시 이벤트 발동
  map.visitedNodeKeys.delete(target.key);

  return {
    targetKey: target.key,
    revivedEdges: pathEdges,
    notice: "길이 막혔다. 어디선가 엘리트가 나타나 길을 열어주었다.",
  };
}
```

UI: 막힘 발생 시 알림 + 맵 갱신.

## 가시성

UI 측 규칙 (Engine은 전체 상태 제공, UI가 필터링):

```typescript
function visibleNodes(map: MapState): { node: MapNode; reachable: boolean }[] {
  const cur = map.nodes[map.currentNodeKey];
  const movable = new Set(getMovableNeighbors(map).map(n => n.key));
  const visited = map.visitedNodeKeys;

  return Object.values(map.nodes).map(n => {
    const reachable = movable.has(n.key);
    const visible   = reachable || n.key === cur.key || visited.has(n.key);
    return visible ? { node: n, reachable } : null;
  }).filter(Boolean);
}
```

가시 규칙:
- **현재 노드** — 항상 보임 (강조)
- **이동 가능 인접 노드** — 보임 + "이동 가능" 표시
- **방문한 노드** — 보임 (회색, 이미 진행됨 표시)
- **그 외** — 안 보임 (`?` 또는 비어있음)

## UI 렌더링 (텍스트 그리드)

```
   x:0   1   2   3   4
  ┌───┬───┬───┬───┬───┐
y0│ ? │ ? │[R]│ ? │ ? │   R = Rest (탈출 노드)
  ├───┼───┼───┼───┼───┤
y1│ ? │ ? │ ? │ ? │ ? │
  ├───┼───┼───┼───┼───┤
y2│ ? │ E │ ? │ ? │ ? │   E = 보였던 엘리트 (방문)
  ├───┼───┼───┼───┼───┤
y3│ ? │ • │ * │ • │ ? │   * = 현재 위치 (이동 가능 노드 표시)
  ├───┼───┼───┼───┼───┤
y4│ ? │ ? │[S]│ ? │ ? │   S = Start (방문)
  └───┴───┴───┴───┴───┘

이동 가능 노드:
  [w] 위로  — 일반 전투 (적: 가시도적)
  [a] 왼쪽 — ?
  [d] 오른쪽 — 상점
```

또는 좌측에 이동 가능 노드를 리스트로:
```
┌─ 이동 가능 노드 ──────┐
│ > [북] 일반 전투      │
│   [동] 상점           │
│   [서] ? 미지의 이벤트│
└───────────────────────┘
┌─ 노드 상세 ───────────┐
│ 일반 전투             │
│ 좌표: (2,2)           │
│ 적: 가시도적 1마리    │
│ 보상: 골드 + 카드     │
└───────────────────────┘
```

(분할 화면 패턴 일관 적용)

## 휴식처 진입 → 던전 종료

```typescript
function onPlayerReachedRestNode(): void {
  // 1. 현재 런 상태 정리
  run.player.hp = run.player.hp;            // 그대로 유지 (회복은 휴식처에서)
  const survivedRun = true;
  // 2. RunState 종료 → 휴식처 메뉴로
  metaService.onRunCompleted(slot, run);
  slot.state = { kind: 'atRest' };
  // 3. 난이도 +1
  slot.difficultyLevel++;
  // 4. 보유 카드 정리는 휴식처 UI에서 (사용자가 보관/판매 선택)
}
```

자세한 휴식처 처리: 06 문서.

## 결정론

`MapState.rngSeed` 에서 파생 RNG로 생성 → 같은 시드 + 같은 params = 같은 맵. 디버그 모드에서 시드 입력 가능.

세이브에는 `rngSeed` + 모든 상태(엣지 consumed, visited 등)를 그대로 저장. 로드 시 재생성 대신 그대로 복원.

## 미정 (TBD)

- **맵 크기**: 5×7? 6×8? 디자인 변수.
- **시작/휴식 위치**: 항상 양 끝? 변경 가능?
- **엘리트 보장**: 한 맵에 최소 N개 엘리트? 분포 디자인.
- **? 노드 (unknown)**: 진입 시 결정. v1 범위 결정 필요.
- **숏컷/특수 노드**: 텔레포터, 일방통행 엣지 등은 v1 외.
- **시야 보너스**: 어떤 스킬은 2칸 앞까지 보임 같은 효과 — v1 외.
