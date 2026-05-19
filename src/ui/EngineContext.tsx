import React, { createContext, useCallback, useContext, useReducer } from 'react';
import type { Game } from '../engine/integration/game.js';

/**
 * EngineContext — exposes the singleton Game to the React tree.
 *
 * Game is a class with mutable state. React needs a re-render trigger
 * when game.state changes — provided here as `dispatch`, a function
 * that wraps an action and forces a re-render afterward.
 *
 * Usage:
 *   const game = useGame();
 *   const dispatch = useDispatch();
 *   dispatch(() => game.createCharacter(0, 'Hero'));
 */

interface EngineCtxValue {
  readonly game: Game;
  readonly rerender: () => void;
}

const EngineContext = createContext<EngineCtxValue | null>(null);

export function EngineProvider({
  game,
  children,
}: {
  game: Game;
  children: React.ReactNode;
}): React.ReactElement {
  const [, rerender] = useReducer(x => x + 1, 0);
  const value: EngineCtxValue = { game, rerender };
  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

export function useGame(): Game {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error('useGame() must be used inside <EngineProvider>');
  return ctx.game;
}

/**
 * Returns a `dispatch` function. Call it with a side-effecting closure
 * that mutates the game; the tree re-renders after the closure returns.
 *
 * Caught errors are surfaced as a thrown — UI should be defensive
 * about transitions it requests.
 */
export function useDispatch(): (action: () => void) => void {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error('useDispatch() must be used inside <EngineProvider>');
  return useCallback((action: () => void) => {
    action();
    ctx.rerender();
  }, [ctx]);
}
