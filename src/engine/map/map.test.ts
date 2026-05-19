import { describe, expect, it } from 'vitest';
import { generateMap } from './generator.js';
import {
  getMovableNeighbors,
  isDeadEnd,
  moveTo,
  recoverDeadEnd,
} from './navigator.js';
import { makeRng } from '../rng.js';
import { edgeKey, type MapGenParams, type NodeDistribution } from '../../types/index.js';

const DIST: NodeDistribution = {
  combat_normal: 5,
  combat_elite:  1,
  shop: 1,
  treasure: 1,
  event_normal: 2,
  event_trigger: 1,
};

function smallMapParams(seed: string, override?: Partial<MapGenParams>): MapGenParams {
  return {
    width: 5,
    height: 5,
    startKey: '0,4',
    restKey: '4,0',
    edgeKeepRatio: 0.7,
    nodeDistribution: DIST,
    seed,
    ...override,
  };
}

// ====================================================================
// generateMap
// ====================================================================

describe('generateMap', () => {
  it('produces a map of the requested size', () => {
    const m = generateMap(smallMapParams('s1'));
    expect(m.width).toBe(5);
    expect(m.height).toBe(5);
    expect(Object.keys(m.nodes)).toHaveLength(25);
  });

  it('start and rest nodes are assigned correctly', () => {
    const m = generateMap(smallMapParams('s2'));
    expect(m.nodes['0,4']?.nodeType).toBe('event_normal');
    expect(m.nodes['4,0']?.nodeType).toBe('rest');
    expect(m.currentNodeKey).toBe('0,4');
    expect(m.visitedNodeKeys.has('0,4')).toBe(true);
  });

  it('is deterministic: same seed → identical map', () => {
    const a = generateMap(smallMapParams('det-1'));
    const b = generateMap(smallMapParams('det-1'));
    expect(Object.keys(a.nodes).sort()).toEqual(Object.keys(b.nodes).sort());
    expect(Object.keys(a.edges).sort()).toEqual(Object.keys(b.edges).sort());
    for (const key of Object.keys(a.nodes)) {
      expect(a.nodes[key]?.nodeType).toBe(b.nodes[key]?.nodeType);
    }
  });

  it('different seeds produce different maps', () => {
    const a = generateMap(smallMapParams('A'));
    const b = generateMap(smallMapParams('B'));
    // Probably differ in either edges or node types
    const sameEdges = JSON.stringify(Object.keys(a.edges).sort()) ===
                      JSON.stringify(Object.keys(b.edges).sort());
    const sameTypes = Object.keys(a.nodes).every(
      k => a.nodes[k]?.nodeType === b.nodes[k]?.nodeType,
    );
    expect(sameEdges && sameTypes).toBe(false);
  });

  it('connectivity: start reaches rest', () => {
    for (const seed of ['s1', 's2', 's3', 's4', 's5']) {
      const m = generateMap(smallMapParams(seed));
      expect(canReach(m, '0,4', '4,0')).toBe(true);
    }
  });

  it('edges all have canonical ids', () => {
    const m = generateMap(smallMapParams('canonical'));
    for (const [id, edge] of Object.entries(m.edges)) {
      expect(edge.id).toBe(id);
      expect(id).toBe(edgeKey(edge.nodeAKey, edge.nodeBKey));
    }
  });

  it('edgeKeepRatio=1 → all adjacency edges present', () => {
    const m = generateMap(smallMapParams('full', { edgeKeepRatio: 1.0 }));
    // 5×5 grid horizontal edges: 5×4 = 20, vertical: 4×5 = 20, total 40
    expect(Object.keys(m.edges).length).toBe(40);
  });

  it('node distribution honors weights (rough check over big map)', () => {
    const m = generateMap({
      width: 10, height: 10,
      startKey: '0,9', restKey: '9,0',
      nodeDistribution: { combat_normal: 100, combat_elite: 0, shop: 0, treasure: 0, event_normal: 0, event_trigger: 0 },
      seed: 'all_normal',
    });
    let normals = 0;
    for (const n of Object.values(m.nodes)) {
      if (n.nodeType === 'combat_normal') normals++;
    }
    // 10×10 = 100 nodes, minus start (event) and rest, so 98 should be combat_normal
    expect(normals).toBeGreaterThanOrEqual(95);
  });
});

// ====================================================================
// Navigation
// ====================================================================

describe('navigation: getMovableNeighbors / moveTo', () => {
  it('returns only nodes connected by non-consumed edges', () => {
    const m = generateMap(smallMapParams('nav', { edgeKeepRatio: 1.0 }));
    // From corner (0,4) with all edges intact, neighbors are (0,3) and (1,4)
    const movable = getMovableNeighbors(m);
    expect(movable.map(n => n.key).sort()).toEqual(['0,3', '1,4']);
  });

  it('moveTo consumes the used edge', () => {
    const m = generateMap(smallMapParams('move', { edgeKeepRatio: 1.0 }));
    const r = moveTo(m, '0,3');
    expect(r.ok).toBe(true);
    expect(r.newlyEntered).toBe(true);
    expect(m.currentNodeKey).toBe('0,3');
    // Edge (0,4)-(0,3) now consumed
    const e = m.edges[edgeKey('0,4', '0,3')]!;
    expect(e.consumed).toBe(true);
  });

  it('cannot re-traverse consumed edge', () => {
    const m = generateMap(smallMapParams('back', { edgeKeepRatio: 1.0 }));
    moveTo(m, '0,3');
    const back = moveTo(m, '0,4');
    expect(back.ok).toBe(false);
    expect(back.reason).toBe('edge-consumed');
  });

  it('rejects non-adjacent target', () => {
    const m = generateMap(smallMapParams('far', { edgeKeepRatio: 1.0 }));
    const r = moveTo(m, '4,4');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not-adjacent');
  });

  it('re-entering a visited node sets newlyEntered=false', () => {
    const m = generateMap(smallMapParams('reenter', { edgeKeepRatio: 1.0 }));
    // Visit (0,3), then back to (0,4) via a different edge (uses (1,4)-(1,3)-(0,3))
    moveTo(m, '0,3'); // edge (0,4)-(0,3) consumed
    moveTo(m, '1,3'); // edge (0,3)-(1,3) consumed
    moveTo(m, '1,4'); // edge (1,3)-(1,4) consumed
    const r = moveTo(m, '0,4'); // edge (0,4)-(1,4) consumed → re-entry to start
    expect(r.ok).toBe(true);
    expect(r.newlyEntered).toBe(false); // start was already visited
  });
});

// ====================================================================
// Dead-end recovery
// ====================================================================

describe('dead-end recovery', () => {
  it('isDeadEnd false when movable neighbors exist', () => {
    const m = generateMap(smallMapParams('alive', { edgeKeepRatio: 1.0 }));
    expect(isDeadEnd(m)).toBe(false);
  });

  it('isDeadEnd true when no movable neighbors', () => {
    const m = generateMap(smallMapParams('stuck', { edgeKeepRatio: 1.0 }));
    // Consume all 2 edges from corner (0,4)
    moveTo(m, '0,3');         // edge (0,3)-(0,4) consumed
    moveTo(m, '0,4');         // can't — consumed; need different path
    // Manually consume the only other edge from (0,3): (0,3)-(1,3) and (0,3)-(0,2)
    moveTo(m, '0,2');
    moveTo(m, '0,1');
    // Now check from current
    // Just craft an artificial dead-end
    for (const e of Object.values(m.edges)) e.consumed = true;
    expect(isDeadEnd(m)).toBe(true);
  });

  it('recoverDeadEnd revives a path to a visited node and elitizes it', () => {
    const m = generateMap(smallMapParams('recover', { edgeKeepRatio: 1.0 }));
    // Walk a bit to build visitedNodeKeys
    moveTo(m, '0,3');
    moveTo(m, '1,3');
    moveTo(m, '1,2');
    // Artificially consume ALL edges so we're stuck
    for (const e of Object.values(m.edges)) e.consumed = true;
    expect(isDeadEnd(m)).toBe(true);

    const r = recoverDeadEnd(m, makeRng('rec'));
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.revivedEdgeIds.length).toBeGreaterThan(0);
    expect(r.elitizedNodeKey).not.toBe('');
    // The chosen elite node must be one of the visited nodes (and not current)
    expect(r.elitizedNodeKey).not.toBe(m.currentNodeKey);
    // It should be marked elite + un-visited (so its event fires on entry)
    expect(m.nodes[r.elitizedNodeKey]?.nodeType).toBe('combat_elite');
    expect(m.visitedNodeKeys.has(r.elitizedNodeKey)).toBe(false);
    // After recovery, no longer dead-ended? At least the revived edge gives a neighbor
    expect(isDeadEnd(m)).toBe(false);
  });

  it('recoverDeadEnd returns null when not in a dead-end', () => {
    const m = generateMap(smallMapParams('alive2', { edgeKeepRatio: 1.0 }));
    expect(recoverDeadEnd(m, makeRng('rec'))).toBeNull();
  });

  it('emergency path: stuck on starting node only revives an adjacent edge', () => {
    const m = generateMap(smallMapParams('start-stuck', { edgeKeepRatio: 1.0 }));
    // Consume edges adjacent to start only — but never moved → visitedNodeKeys = {start}
    for (const e of Object.values(m.edges)) {
      if (e.nodeAKey === '0,4' || e.nodeBKey === '0,4') e.consumed = true;
    }
    expect(isDeadEnd(m)).toBe(true);
    const r = recoverDeadEnd(m, makeRng('emerg'));
    expect(r).not.toBeNull();
    if (!r) return;
    // Emergency path doesn't elitize a node — returns empty elitizedNodeKey
    expect(r.elitizedNodeKey).toBe('');
    expect(r.revivedEdgeIds.length).toBe(1);
    expect(isDeadEnd(m)).toBe(false);
  });
});

// ====================================================================
// Helpers
// ====================================================================

function canReach(m: ReturnType<typeof generateMap>, fromKey: string, toKey: string): boolean {
  const adj = new Map<string, string[]>();
  for (const e of Object.values(m.edges)) {
    if (!adj.has(e.nodeAKey)) adj.set(e.nodeAKey, []);
    if (!adj.has(e.nodeBKey)) adj.set(e.nodeBKey, []);
    adj.get(e.nodeAKey)!.push(e.nodeBKey);
    adj.get(e.nodeBKey)!.push(e.nodeAKey);
  }
  const seen = new Set<string>([fromKey]);
  const queue: string[] = [fromKey];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === toKey) return true;
    for (const n of adj.get(cur) ?? []) {
      if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  return false;
}
