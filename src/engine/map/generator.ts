import type {
  EdgeState,
  MapGenParams,
  MapNode,
  MapState,
  NodeDistribution,
  NodeTypeId,
} from '../../types/index.js';
import { edgeKey } from '../../types/index.js';
import { makeRng, type IRandom } from '../rng.js';

/**
 * Map generator — builds a MapState from `MapGenParams` deterministically.
 *
 * Doc: 05_map_system.md §"생성 알고리즘"
 *
 * Algorithm:
 *   1. Lay out all possible orthogonal adjacency edges
 *   2. Randomly drop a fraction (1 - edgeKeepRatio)
 *   3. Connectivity check: ensure start→rest is reachable; patch in
 *      missing edges along a BFS shortest path until reachable
 *   4. Assign node types (start fixed, rest fixed, rest weighted distribution)
 *
 * What's NOT done here (deferred to data wiring slice):
 *   - Picking specific eventId for event nodes
 *   - Picking specific enemyGroupId for combat nodes
 *   - These require an EventRegistry / EnemyGroupRegistry.
 *   - Generator leaves them undefined; callers fill them in or read
 *     a default per node type at runtime.
 */

const DEFAULT_EDGE_KEEP = 0.7;

export function generateMap(params: MapGenParams): MapState {
  const rng = makeRng(params.seed);

  // 1. All adjacency edges
  const allEdges = buildAllAdjacencyEdges(params.width, params.height);

  // 2. Drop some
  const keep = params.edgeKeepRatio ?? DEFAULT_EDGE_KEEP;
  let keptEdges = allEdges.filter(() => rng.float() < keep);

  // 3. Ensure connectivity start → rest by patching shortest path edges
  keptEdges = ensureConnectivity(keptEdges, allEdges, params.startKey, params.restKey);

  // 4. Node assignment
  const nodes: Record<string, MapNode> = {};
  for (let x = 0; x < params.width; x++) {
    for (let y = 0; y < params.height; y++) {
      const key = `${x},${y}`;
      const nodeType = pickNodeType(key, params, rng);
      nodes[key] = { key, x, y, nodeType };
    }
  }

  // 5. Index edges
  const edges: Record<string, EdgeState> = {};
  for (const e of keptEdges) edges[e.id] = e;

  return {
    width: params.width,
    height: params.height,
    nodes,
    edges,
    currentNodeKey: params.startKey,
    visitedNodeKeys: new Set([params.startKey]),
    rngSeed: params.seed,
  };
}

// ====================================================================
// Edge construction
// ====================================================================

function buildAllAdjacencyEdges(w: number, h: number): EdgeState[] {
  const result: EdgeState[] = [];
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const me = `${x},${y}`;
      if (x + 1 < w) result.push(mkEdge(me, `${x + 1},${y}`));
      if (y + 1 < h) result.push(mkEdge(me, `${x},${y + 1}`));
    }
  }
  return result;
}

function mkEdge(a: string, b: string): EdgeState {
  return { id: edgeKey(a, b), nodeAKey: a, nodeBKey: b, consumed: false };
}

// ====================================================================
// Connectivity patch
// ====================================================================

function ensureConnectivity(
  kept: EdgeState[],
  all: EdgeState[],
  start: string,
  end: string,
): EdgeState[] {
  if (isConnected(kept, start, end)) return kept;
  // Find shortest edge-path using ALL edges, then add missing ones.
  const path = bfsEdgePath(all, start, end);
  if (path.length === 0) {
    // Shouldn't happen on a valid grid, but defensive: just return.
    return kept;
  }
  const have = new Set(kept.map(e => e.id));
  const out = [...kept];
  for (const e of path) {
    if (!have.has(e.id)) out.push(e);
  }
  return out;
}

function isConnected(edges: EdgeState[], from: string, to: string): boolean {
  if (from === to) return true;
  const adj = buildAdj(edges);
  const seen = new Set<string>([from]);
  const queue: string[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const n of adj.get(cur) ?? []) {
      if (seen.has(n)) continue;
      if (n === to) return true;
      seen.add(n);
      queue.push(n);
    }
  }
  return false;
}

function bfsEdgePath(edges: EdgeState[], from: string, to: string): EdgeState[] {
  const adj = buildAdj(edges);
  const prev = new Map<string, string>();
  const seen = new Set<string>([from]);
  const queue: string[] = [from];
  let found = false;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === to) { found = true; break; }
    for (const n of adj.get(cur) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      prev.set(n, cur);
      queue.push(n);
    }
  }
  if (!found) return [];
  // Walk back, gather edges
  const edgeById = new Map(edges.map(e => [e.id, e] as const));
  const path: EdgeState[] = [];
  let node = to;
  while (node !== from) {
    const p = prev.get(node);
    if (p === undefined) break;
    const id = edgeKey(p, node);
    const e = edgeById.get(id);
    if (e) path.push(e);
    node = p;
  }
  return path.reverse();
}

function buildAdj(edges: EdgeState[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.nodeAKey)) adj.set(e.nodeAKey, []);
    if (!adj.has(e.nodeBKey)) adj.set(e.nodeBKey, []);
    adj.get(e.nodeAKey)!.push(e.nodeBKey);
    adj.get(e.nodeBKey)!.push(e.nodeAKey);
  }
  return adj;
}

// ====================================================================
// Node type assignment
// ====================================================================

function pickNodeType(
  key: string,
  params: MapGenParams,
  rng: IRandom,
): NodeTypeId {
  if (key === params.startKey) {
    return 'event_normal' as NodeTypeId; // entry event (e.g., "여정의 시작")
  }
  if (key === params.restKey) {
    return 'rest' as NodeTypeId;
  }
  return weightedPickType(params.nodeDistribution, rng);
}

function weightedPickType(dist: NodeDistribution, rng: IRandom): NodeTypeId {
  const entries: Array<[string, number]> = Object.entries(dist);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) {
    return 'combat_normal' as NodeTypeId; // safe default
  }
  let r = rng.float() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k as NodeTypeId;
  }
  return entries[entries.length - 1]![0] as NodeTypeId;
}
