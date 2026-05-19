import { beforeEach, describe, expect, it } from 'vitest';
import {
  addToDiscard,
  addToDraw,
  addToExhaust,
  addToHand,
  discardHand,
  draw,
  initFromDeck,
  removeFromHand,
  reshuffleDiscardIntoDraw,
  totalDeckSize,
} from './piles.js';
import { makeRng } from '../rng.js';
import type { CardDefId, CardInstance, CardInstanceId, PlayerCombatState } from '../../types/index.js';

const id = <T extends string>(s: string): T => s as T;

function makeCard(name: string): CardInstance {
  return {
    instanceId: id<CardInstanceId>(`inst-${name}`),
    defId: id<CardDefId>(`def-${name}`),
    modifiers: [],
    acquired: { kind: 'starter' },
  };
}

function makeState(): PlayerCombatState {
  return { hand: [], drawPile: [], discardPile: [], exhaustPile: [] };
}

const HARD_CAP = 14;

// ---------- draw ----------

describe('draw', () => {
  let state: PlayerCombatState;
  beforeEach(() => { state = makeState(); });

  it('draws from top of drawPile (last element)', () => {
    state.drawPile = [makeCard('a'), makeCard('b'), makeCard('c')];  // top = c
    const r = draw(state, 1, makeRng('d-1'), HARD_CAP);
    expect(r.drawn).toHaveLength(1);
    expect(r.drawn[0]!.instanceId).toBe('inst-c');
    expect(state.hand).toHaveLength(1);
    expect(state.drawPile).toHaveLength(2);
    expect(r.reshuffled).toBe(false);
  });

  it('draws all when N == drawPile.length', () => {
    state.drawPile = [makeCard('a'), makeCard('b'), makeCard('c')];
    const r = draw(state, 3, makeRng('d-2'), HARD_CAP);
    expect(r.drawn).toHaveLength(3);
    expect(state.drawPile).toHaveLength(0);
    expect(r.reshuffled).toBe(false);
  });

  it('reshuffles when drawPile empties and discard has cards', () => {
    state.drawPile = [makeCard('a')];
    state.discardPile = [makeCard('b'), makeCard('c'), makeCard('d')];
    const r = draw(state, 4, makeRng('d-3'), HARD_CAP);
    expect(r.drawn).toHaveLength(4);
    expect(r.reshuffled).toBe(true);
    expect(state.drawPile).toHaveLength(0);
    expect(state.discardPile).toHaveLength(0);
    expect(state.hand).toHaveLength(4);
  });

  it('stops short when both piles are exhausted', () => {
    state.drawPile = [makeCard('a')];
    state.discardPile = [makeCard('b')];
    const r = draw(state, 5, makeRng('d-4'), HARD_CAP);
    expect(r.drawn).toHaveLength(2);
    expect(r.reshuffled).toBe(true);
    expect(state.hand).toHaveLength(2);
  });

  it('overflow: cards beyond hand hard cap are auto-discarded', () => {
    // Fill hand to cap - 2
    for (let i = 0; i < HARD_CAP - 2; i++) state.hand.push(makeCard(`pre-${i}`));
    state.drawPile = [makeCard('a'), makeCard('b'), makeCard('c'), makeCard('d')];
    const r = draw(state, 4, makeRng('d-5'), HARD_CAP);
    expect(r.drawn).toHaveLength(2);              // 2 fit, hand reaches cap
    expect(r.overflowed).toHaveLength(2);          // 2 went to discard
    expect(state.hand).toHaveLength(HARD_CAP);
    expect(state.discardPile).toHaveLength(2);
    expect(state.drawPile).toHaveLength(0);
  });

  it('drawing 0 is a no-op', () => {
    state.drawPile = [makeCard('a')];
    const r = draw(state, 0, makeRng('d-6'), HARD_CAP);
    expect(r.drawn).toEqual([]);
    expect(r.reshuffled).toBe(false);
    expect(state.drawPile).toHaveLength(1);
  });

  it('deterministic reshuffle: same seed → same draw order', () => {
    const cards = ['a', 'b', 'c', 'd', 'e'].map(makeCard);
    const stateA = { hand: [], drawPile: [], discardPile: [...cards], exhaustPile: [] };
    const stateB = { hand: [], drawPile: [], discardPile: [...cards], exhaustPile: [] };
    const rA = draw(stateA, 5, makeRng('det'), HARD_CAP);
    const rB = draw(stateB, 5, makeRng('det'), HARD_CAP);
    expect(rA.drawn.map(c => c.instanceId)).toEqual(rB.drawn.map(c => c.instanceId));
  });
});

// ---------- reshuffle ----------

describe('reshuffleDiscardIntoDraw', () => {
  it('moves discard to top of drawPile', () => {
    const state = makeState();
    state.drawPile = [makeCard('top-1')];
    state.discardPile = [makeCard('d-1'), makeCard('d-2')];
    reshuffleDiscardIntoDraw(state, makeRng('rs'));
    expect(state.drawPile.length).toBe(3);
    expect(state.discardPile.length).toBe(0);
    // top-1 (was already in draw) should still be drawn first (last in array)
    expect(state.drawPile[state.drawPile.length - 1]!.instanceId).toBe('inst-top-1');
  });

  it('no-op when discardPile is empty', () => {
    const state = makeState();
    state.drawPile = [makeCard('a')];
    reshuffleDiscardIntoDraw(state, makeRng('empty'));
    expect(state.drawPile.length).toBe(1);
  });
});

// ---------- add* ----------

describe('addToDiscard / addToExhaust', () => {
  it('appends to respective pile end', () => {
    const state = makeState();
    addToDiscard(state, makeCard('a'));
    addToDiscard(state, makeCard('b'));
    addToExhaust(state, makeCard('x'));
    expect(state.discardPile.map(c => c.instanceId)).toEqual(['inst-a', 'inst-b']);
    expect(state.exhaustPile.map(c => c.instanceId)).toEqual(['inst-x']);
  });
});

describe('addToDraw position', () => {
  it('top: drawn next', () => {
    const state = makeState();
    state.drawPile = [makeCard('a')];
    addToDraw(state, makeCard('new'), 'top', makeRng('p-t'));
    expect(state.drawPile[state.drawPile.length - 1]!.instanceId).toBe('inst-new');
  });
  it('bottom: drawn last', () => {
    const state = makeState();
    state.drawPile = [makeCard('a'), makeCard('b')];
    addToDraw(state, makeCard('new'), 'bottom', makeRng('p-b'));
    expect(state.drawPile[0]!.instanceId).toBe('inst-new');
  });
  it('random: placed somewhere in pile', () => {
    const state = makeState();
    state.drawPile = [makeCard('a'), makeCard('b'), makeCard('c')];
    addToDraw(state, makeCard('new'), 'random', makeRng('p-r'));
    expect(state.drawPile.some(c => c.instanceId === 'inst-new')).toBe(true);
    expect(state.drawPile).toHaveLength(4);
  });
});

// ---------- addToHand / removeFromHand ----------

describe('addToHand', () => {
  it('returns true and adds if under cap', () => {
    const state = makeState();
    expect(addToHand(state, makeCard('a'), HARD_CAP)).toBe(true);
    expect(state.hand).toHaveLength(1);
  });

  it('returns false and discards if at cap', () => {
    const state = makeState();
    for (let i = 0; i < HARD_CAP; i++) state.hand.push(makeCard(`pre-${i}`));
    expect(addToHand(state, makeCard('overflow'), HARD_CAP)).toBe(false);
    expect(state.hand).toHaveLength(HARD_CAP);
    expect(state.discardPile.at(-1)!.instanceId).toBe('inst-overflow');
  });
});

describe('removeFromHand', () => {
  it('removes by instanceId', () => {
    const state = makeState();
    state.hand = [makeCard('a'), makeCard('b'), makeCard('c')];
    const removed = removeFromHand(state, id<CardInstanceId>('inst-b'));
    expect(removed?.instanceId).toBe('inst-b');
    expect(state.hand.map(c => c.instanceId)).toEqual(['inst-a', 'inst-c']);
  });

  it('returns undefined when not found', () => {
    const state = makeState();
    state.hand = [makeCard('a')];
    expect(removeFromHand(state, id<CardInstanceId>('inst-nope'))).toBeUndefined();
    expect(state.hand).toHaveLength(1);
  });
});

// ---------- discardHand ----------

describe('discardHand', () => {
  it('moves all of hand into discardPile', () => {
    const state = makeState();
    state.hand = [makeCard('a'), makeCard('b'), makeCard('c')];
    const moved = discardHand(state);
    expect(moved).toHaveLength(3);
    expect(state.hand).toHaveLength(0);
    expect(state.discardPile).toHaveLength(3);
  });
});

// ---------- totalDeckSize / initFromDeck ----------

describe('totalDeckSize', () => {
  it('sums all four piles', () => {
    const state = makeState();
    state.hand = [makeCard('a')];
    state.drawPile = [makeCard('b'), makeCard('c')];
    state.discardPile = [makeCard('d')];
    state.exhaustPile = [makeCard('e'), makeCard('f')];
    expect(totalDeckSize(state)).toBe(6);
  });
});

describe('initFromDeck', () => {
  it('seeds drawPile from deck and clears other piles', () => {
    const state = makeState();
    state.hand = [makeCard('old-h')];
    state.discardPile = [makeCard('old-d')];
    state.exhaustPile = [makeCard('old-x')];
    const deck = [makeCard('1'), makeCard('2'), makeCard('3'), makeCard('4'), makeCard('5')];
    initFromDeck(state, deck, makeRng('init'));
    expect(state.hand).toEqual([]);
    expect(state.discardPile).toEqual([]);
    expect(state.exhaustPile).toEqual([]);
    expect(state.drawPile).toHaveLength(5);
    // Shuffle property: same cards present
    expect(state.drawPile.map(c => c.instanceId).sort()).toEqual(
      deck.map(c => c.instanceId).sort(),
    );
  });

  it('deterministic shuffle order per seed', () => {
    const deck = ['1', '2', '3', '4', '5', '6', '7'].map(makeCard);
    const a = makeState();
    const b = makeState();
    initFromDeck(a, deck, makeRng('det'));
    initFromDeck(b, deck, makeRng('det'));
    expect(a.drawPile.map(c => c.instanceId)).toEqual(b.drawPile.map(c => c.instanceId));
  });
});

// ---------- invariant: card preservation ----------

describe('invariant: total card count preserved through operations', () => {
  it('draw + discardHand + reshuffle round-trip preserves total', () => {
    const state = makeState();
    const deck = Array.from({ length: 10 }, (_, i) => makeCard(`c${i}`));
    initFromDeck(state, deck, makeRng('inv'));
    expect(totalDeckSize(state)).toBe(10);

    draw(state, 5, makeRng('inv-d'), HARD_CAP);
    expect(totalDeckSize(state)).toBe(10);

    discardHand(state);
    expect(totalDeckSize(state)).toBe(10);

    draw(state, 5, makeRng('inv-d2'), HARD_CAP);
    expect(totalDeckSize(state)).toBe(10);
  });
});
