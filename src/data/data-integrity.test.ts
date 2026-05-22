import { describe, it, expect } from 'vitest';
import type {
  CardDefinition,
  Effect,
  FlowDefinition,
  FlowStep,
  Modifier,
  StatusId,
} from '../types/index.js';
import {
  ALL_CARDS,
  ALL_CARD_POOLS,
  ALL_MODIFIERS,
  ALL_MODIFIER_POOLS,
  ALL_STATUSES,
  ALL_SKILLS,
  ALL_SKILL_BOXES,
  ALL_ENEMIES,
  ALL_ENEMY_GROUPS,
  ALL_EVENTS,
  ALL_FLOWS,
  TREASURE_SKILL_POOL,
} from './index.js';

/**
 * Reference-integrity guard.
 *
 * The content lives across many files (cards.ts, modifiers.ts,
 * events/*.ts, ...) and refers across with bare string IDs. TypeScript
 * keeps the *shapes* honest but can't verify that a CardPoolEntry's
 * cardDefId actually points to a registered card.
 *
 * This test walks every cross-reference once and asserts the target
 * exists. Run `npm test` after editing any data file — dangling IDs
 * fail at PR time, not at runtime when the player triggers the broken
 * code path.
 */

const cardIds        = new Set(ALL_CARDS.map(c => c.id as string));
const modifierIds    = new Set(ALL_MODIFIERS.map(m => m.id as string));
const cardPoolIds    = new Set(ALL_CARD_POOLS.map(p => p.id as string));
const modifierPoolIds = new Set(ALL_MODIFIER_POOLS.map(p => p.id as string));
const statusIds      = new Set<string>(ALL_STATUSES.map(s => s.id as string));
const skillIds       = new Set(ALL_SKILLS.map(s => s.id as string));
const enemyIds       = new Set(ALL_ENEMIES.map(e => e.id as string));
const enemyGroupIds  = new Set(ALL_ENEMY_GROUPS.map(g => g.id as string));
const eventIds       = new Set(ALL_EVENTS.map(e => e.id as string));
const flowIds        = new Set(ALL_FLOWS.map(f => f.id as string));

// ====================================================================
// Card pool entries → cards
// ====================================================================

describe('CardPool entries', () => {
  it('every cardDefId points to a registered card', () => {
    const missing: string[] = [];
    for (const pool of ALL_CARD_POOLS) {
      for (const entry of pool.entries) {
        if (!cardIds.has(entry.cardDefId as string)) {
          missing.push(`${pool.id} → ${entry.cardDefId}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

// ====================================================================
// Modifier pool entries → modifiers
// ====================================================================

describe('ModifierPool entries', () => {
  it('every modifierId points to a registered modifier', () => {
    const missing: string[] = [];
    for (const pool of ALL_MODIFIER_POOLS) {
      for (const entry of pool.entries) {
        if (!modifierIds.has(entry.modifierId as string)) {
          missing.push(`${pool.id} → ${entry.modifierId}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

// ====================================================================
// Card definitions
// ====================================================================

describe('CardDefinition refs', () => {
  it('every modifierPoolRef points to a registered modifier pool', () => {
    const missing: string[] = [];
    for (const card of ALL_CARDS) {
      for (const ref of card.modifierPoolRefs) {
        if (!modifierPoolIds.has(ref as string)) {
          missing.push(`${card.id} → ${ref}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('every status referenced in baseEffects is registered', () => {
    const missing: string[] = [];
    for (const card of ALL_CARDS) {
      for (const eff of card.baseEffects) {
        const sid = statusIdReferencedBy(eff);
        if (sid && !statusIds.has(sid as string)) {
          missing.push(`${card.id} → status:${sid}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

// ====================================================================
// Modifier transforms
// ====================================================================

describe('Modifier transforms', () => {
  it('every status referenced in transform effects is registered', () => {
    const missing: string[] = [];
    for (const mod of ALL_MODIFIERS) {
      for (const t of mod.transforms) {
        const effects = effectsInTransform(t);
        for (const eff of effects) {
          const sid = statusIdReferencedBy(eff);
          if (sid && !statusIds.has(sid as string)) {
            missing.push(`${mod.id} → status:${sid}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

// ====================================================================
// Skill hooks
// ====================================================================

describe('Skill hooks', () => {
  it('every status referenced in hook effects is registered', () => {
    const missing: string[] = [];
    for (const sk of ALL_SKILLS) {
      for (const h of sk.hooks) {
        for (const eff of h.effects) {
          const sid = statusIdReferencedBy(eff);
          if (sid && !statusIds.has(sid as string)) {
            missing.push(`${sk.id} → status:${sid}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

// ====================================================================
// Skill boxes → skills
// ====================================================================

describe('Skill boxes', () => {
  it('every entry.skillId is registered', () => {
    const missing: string[] = [];
    for (const box of ALL_SKILL_BOXES) {
      for (const entry of box.entries) {
        if (!skillIds.has(entry.skillId as string)) {
          missing.push(`box(${box.grade}) → ${entry.skillId}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('TREASURE_SKILL_POOL', () => {
  it('all skill ids are registered', () => {
    const missing = [...TREASURE_SKILL_POOL].filter(s => !skillIds.has(s as string));
    expect(missing).toEqual([]);
  });
});

// ====================================================================
// Enemy groups → enemies
// ====================================================================

describe('Enemy groups', () => {
  it('every member id is a registered enemy', () => {
    const missing: string[] = [];
    for (const g of ALL_ENEMY_GROUPS) {
      for (const m of g.members) {
        if (!enemyIds.has(m as string)) missing.push(`${g.id} → ${m}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

// ====================================================================
// Events → flows
// ====================================================================

describe('Event definitions', () => {
  it('every flowId points to a registered flow', () => {
    const missing = ALL_EVENTS
      .filter(e => !flowIds.has(e.flowId as string))
      .map(e => `${e.id} → ${e.flowId}`);
    expect(missing).toEqual([]);
  });
});

// ====================================================================
// Flow steps — next/goto integrity + step-level ID refs
// ====================================================================

describe('Flow steps', () => {
  it('every next / goto targets a step in the same flow', () => {
    const missing: string[] = [];
    for (const flow of ALL_FLOWS) {
      const stepIds = new Set(Object.keys(flow.steps));
      for (const [stepId, step] of Object.entries(flow.steps)) {
        for (const target of collectStepTargets(step)) {
          if (!stepIds.has(target)) {
            missing.push(`${flow.id}/${stepId} → ${target}`);
          }
        }
      }
      if (!stepIds.has(flow.entryStepId)) {
        missing.push(`${flow.id}.entryStepId → ${flow.entryStepId}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('cardOffer poolId / poolRefs point to registered card pools', () => {
    const missing: string[] = [];
    for (const flow of ALL_FLOWS) {
      for (const [stepId, step] of Object.entries(flow.steps)) {
        if (step.kind !== 'cardOffer') continue;
        if (step.poolId && !cardPoolIds.has(step.poolId)) {
          missing.push(`${flow.id}/${stepId} → poolId:${step.poolId}`);
        }
        for (const ref of step.poolRefs ?? []) {
          if (!cardPoolIds.has(ref.poolId as string)) {
            missing.push(`${flow.id}/${stepId} → poolRef:${ref.poolId}`);
          }
        }
        if (!step.poolId && (step.poolRefs?.length ?? 0) === 0) {
          missing.push(`${flow.id}/${stepId} — neither poolId nor poolRefs set`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('skillOffer poolOverride ids point to registered skills', () => {
    const missing: string[] = [];
    for (const flow of ALL_FLOWS) {
      for (const [stepId, step] of Object.entries(flow.steps)) {
        if (step.kind !== 'skillOffer') continue;
        for (const sid of step.poolOverride ?? []) {
          if (!skillIds.has(sid as string)) missing.push(`${flow.id}/${stepId} → ${sid}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('cardUpgrade modifier pool override ids are registered', () => {
    const missing: string[] = [];
    for (const flow of ALL_FLOWS) {
      for (const [stepId, step] of Object.entries(flow.steps)) {
        if (step.kind !== 'cardUpgrade') continue;
        for (const a of step.modifierPoolOverride?.add ?? []) {
          if (!modifierPoolIds.has(a as string)) missing.push(`${flow.id}/${stepId} add:${a}`);
        }
        for (const r of step.modifierPoolOverride?.remove ?? []) {
          if (!modifierPoolIds.has(r as string)) missing.push(`${flow.id}/${stepId} remove:${r}`);
        }
        if (step.forceModifierId && !modifierIds.has(step.forceModifierId as string)) {
          missing.push(`${flow.id}/${stepId} force:${step.forceModifierId}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('combatStart enemyGroupId is registered', () => {
    const missing: string[] = [];
    for (const flow of ALL_FLOWS) {
      for (const [stepId, step] of Object.entries(flow.steps)) {
        if (step.kind !== 'combatStart') continue;
        if (!enemyGroupIds.has(step.enemyGroupId as string)) {
          missing.push(`${flow.id}/${stepId} → ${step.enemyGroupId}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('condition eventCleared / hasCardInDeck / hasSkill refs are registered', () => {
    const missing: string[] = [];
    const visitCondition = (where: string, expr: unknown): void => {
      if (!expr || typeof expr !== 'object') return;
      const e = expr as { kind: string;[k: string]: unknown };
      switch (e.kind) {
        case 'eventCleared':
        case 'eventNotCleared':
          if (!eventIds.has(e['eventId'] as string)) missing.push(`${where} → event:${e['eventId']}`);
          break;
        case 'hasCardInDeck':
        case 'hasCardInInventory':
          if (e['defId'] && !cardIds.has(e['defId'] as string)) missing.push(`${where} → card:${e['defId']}`);
          break;
        case 'hasSkill':
        case 'hasPassive':
          if (!skillIds.has(e['skillId'] as string)) missing.push(`${where} → skill:${e['skillId']}`);
          break;
        case 'and':
        case 'or':
          for (const sub of (e['of'] as unknown[] | undefined) ?? []) {
            visitCondition(where, sub);
          }
          break;
        case 'not':
          visitCondition(where, e['of']);
          break;
      }
    };
    for (const flow of ALL_FLOWS) {
      for (const [stepId, step] of Object.entries(flow.steps)) {
        const where = `${flow.id}/${stepId}`;
        if (step.kind === 'choice') {
          for (const opt of step.options) {
            visitCondition(where, opt.condition);
            visitCondition(where, opt.hidden);
          }
        } else if (step.kind === 'branch') {
          for (const br of step.branches) visitCondition(where, br.condition);
        } else if (step.kind === 'cardOffer') {
          for (const ref of step.poolRefs ?? []) visitCondition(where, ref.condition);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

// ====================================================================
// Helpers
// ====================================================================

function statusIdReferencedBy(eff: Effect): StatusId | null {
  if (eff.kind === 'applyStatus' || eff.kind === 'removeStatus') return eff.status;
  return null;
}

function effectsInTransform(t: Modifier['transforms'][number]): ReadonlyArray<Effect> {
  switch (t.op) {
    case 'appendEffect':  return [t.effect];
    case 'prependEffect': return [t.effect];
    case 'replaceEffect': return [t.with];
    case 'wrapEffect':    return [t.before, t.after].filter((e): e is Effect => !!e);
    default:              return [];
  }
}

function collectStepTargets(step: FlowStep): string[] {
  switch (step.kind) {
    case 'dialogue':
    case 'cardOffer':
    case 'skillOffer':
    case 'cardUpgrade':
    case 'cardModifierAttach':
    case 'applyEffect':
      return [step.next];
    case 'choice':
      return step.options.flatMap(o => {
        const t: string[] = [];
        if (o.next) t.push(o.next);
        if (o.probabilistic) t.push(o.probabilistic.successNext, o.probabilistic.failureNext);
        return t;
      });
    case 'branch':
      return [...step.branches.map(b => b.next), step.defaultNext];
    case 'combatStart': {
      const t = [step.afterVictoryNext];
      if (step.afterDefeatNext) t.push(step.afterDefeatNext);
      return t;
    }
    case 'shopOffer': {
      const t = [step.leaveNext];
      if (step.engraveNext) t.push(step.engraveNext);
      return t;
    }
    case 'goto':
      return [step.stepId];
    case 'end':
      return [];
  }
}

// Type guard for definitions referenced for type completeness
type _T1 = CardDefinition;
type _T2 = FlowDefinition;
