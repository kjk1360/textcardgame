/**
 * Game tuning constants.
 *
 * These are the starting values; skills and cards can mutate per-run /
 * per-turn at runtime via hook effects (e.g., `gainEnergy`, `draw`).
 *
 * In Phase 4 these move out into `authoring/game_constants.yaml` so
 * designers can tune without code changes. Until then the canonical
 * source is this module.
 *
 * Migration note logged in docs/migration/01_ts_to_excel.md.
 */

export interface HandLimits {
  /** Default cap — turn-end draw won't push beyond this. */
  readonly softLimit: number;
  /**
   * Absolute ceiling — even if skills/cards try to grow the hand
   * (e.g., retain stacking), the engine refuses to add cards past this.
   * Designed alongside skill balancing so this should never trip in
   * normal play.
   */
  readonly hardLimit: number;
}

export interface EnergyConfig {
  /** Energy at the start of every player turn. */
  readonly base: number;
  /**
   * Permanent +N to base every turn. 0 in this game by design —
   * energy growth is event/skill driven, not automatic.
   */
  readonly autoIncreasePerTurn: number;
}

export interface DrawConfig {
  /** Cards drawn at the start of every player turn. */
  readonly perTurn: number;
  /** Extra cards drawn on turn 1 only. */
  readonly firstTurnAdditional: number;
}

export interface GameConstants {
  readonly hand: HandLimits;
  readonly energy: EnergyConfig;
  readonly draw: DrawConfig;
}

/**
 * Confirmed defaults (2026-05-19):
 *   - Hand soft limit 10, hard cap 14
 *   - Base energy 3, no auto-growth
 *   - Draw 4 / turn (regardless of cards retained), no first-turn bonus
 */
export const DEFAULT_CONSTANTS: GameConstants = {
  hand: { softLimit: 10, hardLimit: 14 },
  energy: { base: 3, autoIncreasePerTurn: 0 },
  draw: { perTurn: 4, firstTurnAdditional: 0 },
};
