import type { MapNode, MapState } from '../../types/index.js';
import { edgeKey } from '../../types/index.js';
import type { IRandom } from '../rng.js';

/**
 * Map navigator — runtime movement rules + dead-end recovery.
 *
 * Doc: 05_map_system.md §"이동" + §"막힘 해소"
 */

export interface MoveAttempt {
  readonly ok: boolean;
  readonly reason?: 'not-adjacent' | 'no-edge' | 'edge-consumed' | 'unknown-node';
  /** True only when this is a first-visit to the destination node. */
  readonly newlyEntered: boolean;
}

export interface RecoveryResult {
  /** Node that was converted into an elite (id of the affected node). */
  readonly elitizedNodeKey: string;
  /** Edges that were revived (set consumed=false, revived=true). */
  readonly revivedEdgeIds: ReadonlyArray<string>;
}

/**
 * The neighboring nodes the player can move to from the current node.
 * Edge must exist and not be consumed; neighbor must not be the current node.
 */
export function getMovableNeighbors(state: MapState): MapNode[] {
  const cur = state.nodes[state.currentNodeKey];
  if (!cur) return [];
  const result: MapNode[] = [];
  for (const dir of DIRECTIONS) {
    const nx = cur.x + dir[0];
    const ny = cur.y + dir[1];
    const nKey = `${nx},${ny}`;
    const neighbor = state.nodes[nKey];
    if (!neighbor) continue;
    const eKey = edgeKey(cur.key, nKey);
    const edge = state.edges[eKey];
    if (!edge || edge.consumed) continue;
    result.push(neighbor);
  }
  return result;
}

/**
 * Attempt to move to a target node. Consumes the edge and marks the
 * destination visited on first entry.
 *
 * On the FIRST entry to a destination: returns `newlyEntered: true` →
 * caller should trigger the node's event/combat. On re-entry, returns
 * `newlyEntered: false` and the caller goes straight to next-node selection.
 */
export function moveTo(state: MapState, targetKey: string): MoveAttempt {
  const cur = state.nodes[state.currentNodeKey];
  const target = state.nodes[targetKey];
  if (!cur || !target) return { ok: false, reason: 'unknown-node', newlyEntered: false };
  if (!isAdjacent(cur, target)) return { ok: false, reason: 'not-adjacent', newlyEntered: false };

  const eKey = edgeKey(cur.key, target.key);
  const edge = state.edges[eKey];
  if (!edge) return { ok: false, reason: 'no-edge', newlyEntered: false };
  if (edge.consumed) return { ok: false, reason: 'edge-consumed', newlyEntered: false };

  edge.consumed = true;
  state.currentNodeKey = target.key;
  const newlyEntered = !state.visitedNodeKeys.has(target.key);
  if (newlyEntered) state.visitedNodeKeys.add(target.key);
  return { ok: true, newlyEntered };
}

/**
 * True when the player has no movable neighbors. Caller should invoke
 * `recoverDeadEnd` to open a path.
 */
export function isDeadEnd(state: MapState): boolean {
  return getMovableNeighbors(state).length === 0;
}

/**
 * Recover a dead-end by picking a previously-visited node (closest first)
 * and reviving the edge path back to it, then converting that node into
 * a forced elite encounter.
 *
 * The chosen node is removed from visitedNodeKeys so its (now overridden)
 * event will fire when the player gets there.
 */
export function recoverDeadEnd(state: MapState, rng: IRandom): RecoveryResult | null {
  // Sanity: nothing to recover from
  if (!isDeadEnd(state)) return null;

  const cur = state.nodes[state.currentNodeKey];
  if (!cur) return null;

  // Candidates: visited nodes that are not the current node
  const candidateKeys = [...state.visitedNodeKeys].filter(k => k !== cur.key);
  if (candidateKeys.length === 0) {
    // Edge case: stuck on starting node alone. Revive any one adjacent edge.
    return forceReviveAnyAdjacentEdge(state, rng);
  }

  // Sort by manhattan distance ascending (prefer close)
  const candidates = candidateKeys
    .map(k => state.nodes[k]!)
    .sort((a, b) => manhattan(a, cur) - manhattan(b, cur));

  const target = candidates[0]!;
  const revivedEdgeIds = reviveEdgesAlongPath(state, cur.key, target.key);
  if (revivedEdgeIds.length === 0) {
    return forceReviveAnyAdjacentEdge(state, rng);
  }

  // Promote target to elite + unvisit so event fires on entry
  target.nodeType = 'combat_elite' as MapNode['nodeType'];
  target.eventId = undefined;
  // enemyGroupId left undefined — caller assigns from elite pool when entered
  state.visitedNodeKeys.delete(target.key);

  return { elitizedNodeKey: target.key, revivedEdgeIds };
}

// ====================================================================
// Internals
// ====================================================================

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
] as const;

function isAdjacent(a: MapNode, b: MapNode): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

function manhattan(a: MapNode, b: MapNode): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Find a BFS path between `fromKey` and `toKey` over existing edges
 * (consumed or not), then mark every edge along that path as revived.
 * Returns the list of revived edge ids.
 */
function reviveEdgesAlongPath(state: MapState, fromKey: string, toKey: string): string[] {
  if (fromKey === toKey) return [];
  const adj = new Map<string, string[]>();
  for (const e of Object.values(state.edges)) {
    if (!adj.has(e.nodeAKey)) adj.set(e.nodeAKey, []);
    if (!adj.has(e.nodeBKey)) adj.set(e.nodeBKey, []);
    adj.get(e.nodeAKey)!.push(e.nodeBKey);
    adj.get(e.nodeBKey)!.push(e.nodeAKey);
  }
  const prev = new Map<string, string>();
  const seen = new Set<string>([fromKey]);
  const queue: string[] = [fromKey];
  let reached = false;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === toKey) { reached = true; break; }
    for (const n of adj.get(cur) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      prev.set(n, cur);
      queue.push(n);
    }
  }
  if (!reached) return [];

  const revivedIds: string[] = [];
  let node = toKey;
  while (node !== fromKey) {
    const p = prev.get(node);
    if (p === undefined) break;
    const id = edgeKey(p, node);
    const edge = state.edges[id];
    if (edge) {
      edge.consumed = false;
      edge.revived = true;
      revivedIds.push(id);
    }
    node = p;
  }
  return revivedIds;
}

function forceReviveAnyAdjacentEdge(state: MapState, rng: IRandom): RecoveryResult | null {
  const cur = state.nodes[state.currentNodeKey];
  if (!cur) return null;
  // Any consumed edge attached to cur
  const candidates: typeof state.edges[string][] = [];
  for (const e of Object.values(state.edges)) {
    if (e.nodeAKey === cur.key || e.nodeBKey === cur.key) {
      candidates.push(e);
    }
  }
  if (candidates.length === 0) return null;
  const e = rng.pick(candidates);
  e.consumed = false;
  e.revived = true;
  // No node converted to elite in this emergency path; caller decides
  return { elitizedNodeKey: '', revivedEdgeIds: [e.id] };
}
