import type { Effect, PlayerActor } from '../../types/index.js';
import type { StatusRegistry } from '../../engine/statuses/engine.js';

/**
 * Card-effect preview helpers. Compute the post-modifier value of a
 * damage or block effect given the player's current statuses, so the
 * UI can show "피해 10(4 + 6[힘])" without the player doing the math.
 *
 * Pipeline mirrors src/engine/combat/damage.ts but for OUTGOING side only:
 *   - outgoingAdd (e.g. strength) adds per-stack
 *   - outgoingMul (e.g. weak) multiplies
 *   - blockGainAdd / blockGainMul for gainBlock
 *
 * Target-side modifiers (vulnerable etc.) are NOT included because the
 * player hasn't picked a target yet at preview time; the actual play
 * value may differ.
 */

export interface PreviewPart {
  /** Display label, e.g. "+2[근력]" or "× 0.75[약화]". */
  readonly label: string;
}

export interface PreviewResult {
  readonly baseAmount: number;
  readonly finalAmount: number;
  readonly parts: ReadonlyArray<PreviewPart>;  // empty if no modifiers
}

/**
 * Apply player's outgoing modifiers to a damage value. Returns the final
 * (integer) value + breakdown.
 */
export function previewDamage(
  baseAmount: number,
  player: PlayerActor,
  statuses: StatusRegistry,
): PreviewResult {
  const parts: PreviewPart[] = [];
  let amount = baseAmount;
  for (const s of player.statuses) {
    if (!statuses.has(s.id)) continue;
    const def = statuses.get(s.id);
    if (!def.damagePipeline) continue;
    for (const rule of def.damagePipeline) {
      if (rule.kind === 'outgoingAdd' && rule.perStack !== 0) {
        const delta = rule.perStack * s.stacks;
        amount += delta;
        const sign = delta >= 0 ? '+' : '';
        parts.push({ label: `${sign}${delta}[${def.name}]` });
      } else if (rule.kind === 'outgoingMul' && rule.multiplier !== 1) {
        amount = amount * rule.multiplier;
        parts.push({ label: `× ${rule.multiplier}[${def.name}]` });
      }
    }
  }
  amount = Math.max(0, Math.floor(amount));
  return { baseAmount, finalAmount: amount, parts };
}

/**
 * Apply player's block-gain modifiers (dexterity etc.).
 */
export function previewBlock(
  baseAmount: number,
  player: PlayerActor,
  statuses: StatusRegistry,
): PreviewResult {
  const parts: PreviewPart[] = [];
  let amount = baseAmount;
  for (const s of player.statuses) {
    if (!statuses.has(s.id)) continue;
    const def = statuses.get(s.id);
    if (!def.damagePipeline) continue;
    for (const rule of def.damagePipeline) {
      if (rule.kind === 'blockGainAdd' && rule.perStack !== 0) {
        const delta = rule.perStack * s.stacks;
        amount += delta;
        const sign = delta >= 0 ? '+' : '';
        parts.push({ label: `${sign}${delta}[${def.name}]` });
      } else if (rule.kind === 'blockGainMul' && rule.multiplier !== 1) {
        amount = amount * rule.multiplier;
        parts.push({ label: `× ${rule.multiplier}[${def.name}]` });
      }
    }
  }
  amount = Math.max(0, Math.floor(amount));
  return { baseAmount, finalAmount: amount, parts };
}

/**
 * Format an effect's preview as a Korean display string. Returns null
 * for effects with no meaningful damage/block payload.
 */
export function formatEffectPreview(
  effect: Effect,
  player: PlayerActor,
  statuses: StatusRegistry,
): string | null {
  switch (effect.kind) {
    case 'damage': {
      const p = previewDamage(effect.amount, player, statuses);
      const tgt = targetText(effect.target);
      return p.parts.length === 0
        ? `${tgt}에 피해 ${p.finalAmount}`
        : `${tgt}에 피해 ${p.finalAmount} (${p.baseAmount} ${p.parts.map(x => x.label).join(' ')})`;
    }
    case 'damageMultiHit': {
      const p = previewDamage(effect.amount, player, statuses);
      const tgt = targetText(effect.target);
      const single = p.parts.length === 0
        ? `피해 ${p.finalAmount}`
        : `피해 ${p.finalAmount} (${p.baseAmount} ${p.parts.map(x => x.label).join(' ')})`;
      return `${tgt}에 ${single} × ${effect.hits}회`;
    }
    case 'gainBlock': {
      const p = previewBlock(effect.amount, player, statuses);
      return p.parts.length === 0
        ? `방어도 ${p.finalAmount}`
        : `방어도 ${p.finalAmount} (${p.baseAmount} ${p.parts.map(x => x.label).join(' ')})`;
    }
    case 'gainHp':       return `HP +${effect.amount} 회복`;
    case 'loseHp':       return `자신 HP -${effect.amount}`;
    case 'gainEnergy':   return `에너지 +${effect.amount}`;
    case 'loseEnergy':   return `에너지 -${effect.amount}`;
    case 'gainGold':     return `골드 +${effect.amount}`;
    case 'loseGold':     return `골드 -${effect.amount}`;
    case 'draw':         return `카드 ${effect.count}장 뽑기`;
    case 'applyStatus':  return `${targetText(effect.target)}에 ${effect.status} +${effect.stacks}`;
    case 'removeStatus': return `${targetText(effect.target)}의 ${effect.status} 제거`;
    default:             return null;
  }
}

function targetText(t: string): string {
  switch (t) {
    case 'self':        return '자신';
    case 'enemy':       return '적';
    case 'allEnemies':  return '모든 적';
    case 'randomEnemy': return '무작위 적';
    case 'ally':        return '아군';
    case 'none':        return '';
    default:            return t;
  }
}
