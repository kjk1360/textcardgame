import type { SkillId } from '../../types/index.js';

/**
 * Pseudo-skill markers — when a skillOffer step has
 * fillRestWithGoldAmount and the real skill pool is exhausted, remaining
 * option slots are populated with these markers. Runtime + UI detect
 * the pattern and route to gainGoldMeta(N) instead of addSkillToCharacter.
 *
 * Pattern: '__gold_<amount>__'
 */

const PREFIX = '__gold_';
const SUFFIX = '__';

export function makeGoldMarker(amount: number): SkillId {
  return `${PREFIX}${amount}${SUFFIX}` as SkillId;
}

export function isGoldMarker(sid: SkillId): boolean {
  const s = String(sid);
  return s.startsWith(PREFIX) && s.endsWith(SUFFIX);
}

export function goldMarkerAmount(sid: SkillId): number {
  if (!isGoldMarker(sid)) return 0;
  const s = String(sid);
  const inner = s.slice(PREFIX.length, s.length - SUFFIX.length);
  const n = parseInt(inner, 10);
  return Number.isFinite(n) ? n : 0;
}
