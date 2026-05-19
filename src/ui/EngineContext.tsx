import React, { createContext, useCallback, useContext, useReducer, useRef } from 'react';
import type { Game } from '../engine/integration/game.js';

/**
 * EngineContext — exposes the singleton Game to the React tree.
 *
 * Game is a class with mutable state. React needs a re-render trigger
 * when game.state changes — provided here as `dispatch`, a function
 * that wraps an action and forces a re-render afterward.
 *
 * Auto-save: when `onAfterDispatch` is provided to <EngineProvider>,
 * it's invoked after every successful dispatch. Wire it to a debounced
 * file write to persist the game.
 */

interface EngineCtxValue {
  readonly game: Game;
  readonly rerender: () => void;
  readonly onAfterDispatch?: (game: Game) => void;
}

const EngineContext = createContext<EngineCtxValue | null>(null);

export function EngineProvider({
  game,
  onAfterDispatch,
  children,
}: {
  game: Game;
  onAfterDispatch?: (game: Game) => void;
  children: React.ReactNode;
}): React.ReactElement {
  const [, rerender] = useReducer(x => x + 1, 0);
  const valueRef = useRef<EngineCtxValue>({ game, rerender, onAfterDispatch });
  // Keep the ref up-to-date with the latest callback (without re-creating)
  valueRef.current = { game, rerender, onAfterDispatch };
  return <EngineContext.Provider value={valueRef.current}>{children}</EngineContext.Provider>;
}

export function useGame(): Game {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error('useGame() must be used inside <EngineProvider>');
  return ctx.game;
}

/**
 * Returns a `dispatch` function. Call it with a side-effecting closure
 * that mutates the game; the tree re-renders + auto-save fires after
 * the closure returns.
 */
export function useDispatch(): (action: () => void) => void {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error('useDispatch() must be used inside <EngineProvider>');
  return useCallback((action: () => void) => {
    action();
    ctx.rerender();
    if (ctx.onAfterDispatch) {
      try {
        ctx.onAfterDispatch(ctx.game);
      } catch (e) {
        // Save failure shouldn't crash gameplay — log + continue
        // eslint-disable-next-line no-console
        console.error('Auto-save failed:', e);
      }
    }
  }, [ctx]);
}
