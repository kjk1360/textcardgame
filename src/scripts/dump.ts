/**
 * Content dump / sanity check CLI.
 *
 * Usage (via tsx):
 *   npm run dump          → topline summary of all registries
 *   npm run dump cards    → card table
 *   npm run dump pools    → card-pool entries
 *   npm run dump sim      → simulate 1000 draws per pool, show distribution
 *   npm run dump mods     → modifier list
 *   npm run dump skills   → skill list
 *   npm run dump events   → event/flow tree
 *
 * Intended use: after adding content, eyeball the dump to confirm
 * names, costs, weights, distributions look right. Reference-integrity
 * is enforced by `data-integrity.test.ts`; this script is for "does
 * the content FEEL right" rather than "does it parse".
 */

import {
  ALL_CARDS,
  ALL_CARD_POOLS,
  ALL_MODIFIERS,
  ALL_MODIFIER_POOLS,
  ALL_STATUSES,
  ALL_SKILLS,
  ALL_ENEMIES,
  ALL_ENEMY_GROUPS,
  ALL_EVENTS,
  ALL_FLOWS,
} from '../data/index.js';
import { sampleCardsFromPool } from '../engine/cards/pool-sampler.js';
import { makeRng } from '../engine/rng.js';

const SIM_DRAWS = 1000;
const SIM_PICKS_PER_DRAW = 1;

function main(): void {
  const arg = (process.argv[2] ?? 'all').toLowerCase();
  switch (arg) {
    case 'cards':  dumpCards(); break;
    case 'pools':  dumpCardPools(); break;
    case 'sim':    dumpPoolSimulations(); break;
    case 'mods':
    case 'modifiers': dumpModifiers(); break;
    case 'mod-pools':
    case 'mods-pools': dumpModifierPools(); break;
    case 'skills': dumpSkills(); break;
    case 'statuses': dumpStatuses(); break;
    case 'enemies': dumpEnemies(); break;
    case 'events': dumpEvents(); break;
    case 'all':
    case 'summary':
      dumpSummary();
      break;
    default:
      // eslint-disable-next-line no-console
      console.error(`Unknown section: ${arg}`);
      // eslint-disable-next-line no-console
      console.error('Try: cards | pools | sim | mods | mod-pools | skills | statuses | enemies | events | all');
      process.exit(2);
  }
}

function dumpSummary(): void {
  out(`
=== Content summary ===
  cards          ${ALL_CARDS.length}
  card pools     ${ALL_CARD_POOLS.length}
  modifiers      ${ALL_MODIFIERS.length}
  modifier pools ${ALL_MODIFIER_POOLS.length}
  statuses       ${ALL_STATUSES.length}
  skills         ${ALL_SKILLS.length}
  enemies        ${ALL_ENEMIES.length}
  enemy groups   ${ALL_ENEMY_GROUPS.length}
  events         ${ALL_EVENTS.length}
  flows          ${ALL_FLOWS.length}
`);
  out(`Run "npm run dump <section>" for details.`);
}

function dumpCards(): void {
  out(`\n=== Cards (${ALL_CARDS.length}) ===`);
  out(pad('ID', 18), pad('Name', 14), pad('Type', 7), pad('Cost', 5),
      pad('Rarity', 9), pad('Tags', 36), 'Pools');
  for (const c of ALL_CARDS) {
    const cost = c.cost.kind === 'fixed' ? `${c.cost.value}` : c.cost.kind;
    out(
      pad(c.id, 18),
      pad(c.name, 14),
      pad(c.type, 7),
      pad(cost, 5),
      pad(c.rarity, 9),
      pad(c.tags.join(','), 36),
      c.modifierPoolRefs.join(','),
    );
  }
}

function dumpCardPools(): void {
  out(`\n=== Card pools (${ALL_CARD_POOLS.length}) ===`);
  for (const p of ALL_CARD_POOLS) {
    out(`\n  ${p.id}  (${p.name})  — ${p.entries.length} entries`);
    for (const e of p.entries) {
      const card = ALL_CARDS.find(c => c.id === e.cardDefId);
      out(`    · ${pad(String(e.cardDefId), 18)} w=${e.weight}` +
          (card ? `  ${card.name}` : '  <MISSING CARD>'));
    }
  }
}

function dumpPoolSimulations(): void {
  out(`\n=== Card pool simulations (${SIM_DRAWS} draws × ${SIM_PICKS_PER_DRAW} picks) ===`);
  for (const p of ALL_CARD_POOLS) {
    out(`\n  ${p.id}  (${p.name})`);
    const counts = new Map<string, number>();
    for (let i = 0; i < SIM_DRAWS; i++) {
      const rng = makeRng(`sim-${p.id}-${i}`);
      const picks = sampleCardsFromPool(p, SIM_PICKS_PER_DRAW, rng);
      for (const pick of picks) counts.set(pick as string, (counts.get(pick as string) ?? 0) + 1);
    }
    const total = [...counts.values()].reduce((s, v) => s + v, 0);
    const sorted = [...counts.entries()].sort(([, a], [, b]) => b - a);
    for (const [cid, cnt] of sorted) {
      const pct = ((cnt / total) * 100).toFixed(1);
      const card = ALL_CARDS.find(c => c.id === cid);
      const name = card ? card.name : '<MISSING>';
      out(`    ${pad(cid, 18)}  ${pad(`${cnt}`, 5)} ${pad(`${pct}%`, 7)}  ${name}`);
    }
  }
}

function dumpModifiers(): void {
  out(`\n=== Modifiers (${ALL_MODIFIERS.length}) ===`);
  out(pad('ID', 20), pad('Name', 14), pad('Weight', 7), 'Description');
  for (const m of ALL_MODIFIERS) {
    out(pad(m.id, 20), pad(m.name, 14), pad(`${m.weight}`, 7), m.descriptionTemplate);
  }
}

function dumpModifierPools(): void {
  out(`\n=== Modifier pools (${ALL_MODIFIER_POOLS.length}) ===`);
  for (const p of ALL_MODIFIER_POOLS) {
    out(`\n  ${p.id}  (${p.name})`);
    for (const e of p.entries) {
      const mod = ALL_MODIFIERS.find(m => m.id === e.modifierId);
      out(`    · ${pad(String(e.modifierId), 20)} w=${e.weight}` +
          (mod ? `  ${mod.name}` : '  <MISSING>'));
    }
  }
}

function dumpSkills(): void {
  out(`\n=== Skills (${ALL_SKILLS.length}) ===`);
  for (const s of ALL_SKILLS) {
    out(`  ${pad(s.id, 22)} ${pad(s.grade, 8)} ${pad(s.passiveEligible ? '★passive' : ' ', 9)} ${s.name} — ${s.description}`);
  }
}

function dumpStatuses(): void {
  out(`\n=== Statuses (${ALL_STATUSES.length}) ===`);
  for (const st of ALL_STATUSES) {
    const dmgRules = st.damagePipeline?.map(r => `${r.kind}`).join(',') ?? '';
    out(`  ${pad(st.id, 16)} ${pad(st.name, 8)} decay=${st.decay.kind}  pipeline=[${dmgRules}]  hooks=${st.hooks.length}`);
  }
}

function dumpEnemies(): void {
  out(`\n=== Enemies (${ALL_ENEMIES.length}) ===`);
  for (const e of ALL_ENEMIES) {
    out(`  ${pad(e.id, 12)} ${pad(e.name, 8)} tier=${e.tier} hp=${e.hpRange[0]}-${e.hpRange[1]} gold=${e.rewards.goldRange[0]}-${e.rewards.goldRange[1]}`);
  }
  out(`\n--- Enemy groups (${ALL_ENEMY_GROUPS.length}) ---`);
  for (const g of ALL_ENEMY_GROUPS) {
    out(`  ${pad(g.id, 18)} members=[${g.members.join(',')}]`);
  }
}

function dumpEvents(): void {
  out(`\n=== Events (${ALL_EVENTS.length}) ===`);
  for (const ev of ALL_EVENTS) {
    const flow = ALL_FLOWS.find(f => f.id === ev.flowId);
    out(`\n  ${ev.id}  "${ev.name}"  nodeType=${ev.nodeType}  oneShot=${ev.oneShot ?? false}`);
    if (!flow) {
      out(`    <MISSING flow ${ev.flowId}>`);
      continue;
    }
    out(`    flow ${flow.id}  entry=${flow.entryStepId}  steps=${Object.keys(flow.steps).length}`);
    for (const [sid, s] of Object.entries(flow.steps)) {
      out(`      ${pad(sid, 14)} ${s.kind}`);
    }
  }
}

function pad(s: string, w: number): string {
  if (s.length >= w) return s.slice(0, w - 1) + ' ';
  return s + ' '.repeat(w - s.length);
}

function out(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(...args);
}

main();
