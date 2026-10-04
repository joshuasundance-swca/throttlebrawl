/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { registryFromGlob } from '../content';
import { DEFAULT_PROFILE } from '../save';
import { GRUDGE_RULE_IDS } from '../sim/api';
import type { GrudgeRuleId } from '../sim/api';
import {
  AUDIT_MAX_LINE_ITEMS,
  careerDefs,
  careerOf,
  eventPlan,
  objectiveText,
  startCareer,
  type CareerDef,
  type EventPlan,
} from './index';
import { posterView, riderTexts, RULE_CARDS, ruleCard } from './show';

// Grudges with rules (run W-T, the pitch deck's #14: "each tier closes on a grudge match played by
// the rival's own rule"), read from the real packs: who plays which rule, and the card that states
// it on the poster before the race.

const REG = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const DEFS = careerDefs(REG);
const def = (region: string): CareerDef => {
  const d = careerOf(DEFS, region);
  if (!d) throw new Error(region);
  return d;
};
const planOf = (d: CareerDef, node: string) =>
  eventPlan(REG, d.nodes.find((n) => n.id === node)?.event ?? '');

/** Every event on a career map played by a grudge rule, read from the packs, in map order. */
const RULED = DEFS.flatMap((d) =>
  d.nodes.map((n) => ({ def: d, node: n.id, plan: eventPlan(REG, n.event) })),
).filter((x) => x.plan.rules.rule !== undefined);
const ruledBy = (rule: GrudgeRuleId) => RULED.filter((x) => x.plan.rules.rule === rule);
/** The first event on any map played by a rule. */
const firstRuled = (rule: GrudgeRuleId) => {
  const hit = ruledBy(rule)[0];
  if (!hit) throw new Error(`no event plays ${rule}`);
  return hit;
};
const riderName = (id: string | undefined) => REG.riders[id ?? '']?.name ?? '';
/** Counts are written as words on the cards, up to ten. */
const words = (n: number) =>
  ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] ?? String(n);
const beatRival = (p: EventPlan) => p.objectives.find((o) => o.kind === 'beat-rival');

describe("each rule is played by its rival, in a grudge match on the career's map", () => {
  it("each rule is one rival's own, played in a grudge match with that rival in the field", () => {
    const rivals = new Map<string, Set<string>>();
    for (const { node, plan } of RULED) {
      const rule = plan.rules.rule ?? '';
      expect(plan.kind, node).toBe('grudge-match');
      expect(plan.rules.rival, node).toBeDefined();
      expect(plan.field, node).toContain(plan.rules.rival);
      rivals.set(rule, (rivals.get(rule) ?? new Set()).add(plan.rules.rival ?? ''));
    }
    console.log(
      `[examined] ${RULED.length} ruled events: ${[...rivals].map(([r, s]) => `${r} by ${[...s].join(', ')}`).join('; ')}`,
    );
    // The rival's own rule: one rival plays each rule, wherever it is played...
    for (const [rule, who] of rivals) expect([...who], rule).toHaveLength(1);
    // ...and no rival plays two.
    const all = [...rivals.values()].flatMap((s) => [...s]);
    expect(new Set(all).size).toBe(all.length);
    // Every rule in the closed list is played somewhere.
    expect(new Set(rivals.keys())).toEqual(new Set(GRUDGE_RULE_IDS));
  });

  it('the Audit and Timber are won by knockdowns (Timber as a boss either way); the Collab to the line', () => {
    for (const { node, plan } of ruledBy('audit')) expect(plan.rules.winBy, node).toBe('knockdowns');
    for (const { node, plan } of ruledBy('timber'))
      expect(
        plan.rules.winBy === 'knockdowns' || Number(beatRival(plan)?.params['orKnockdowns'] ?? 0) > 0,
        `${node}: timber is won by knockdowns, or either way`,
      ).toBe(true);
    for (const { node, plan } of ruledBy('collab')) {
      expect(plan.rules.winBy, node).toBe('finish-ahead');
      // The Collab is a style contest already: no separate style bonus asking for the same thing.
      expect(
        plan.objectives.map((o) => o.kind),
        node,
      ).not.toContain('style-cash');
    }
  });

  it('Keys tier 3 closes on a grudge: every Keys tier now has one', () => {
    const keys = def('florida-keys');
    for (let t = 0; t < keys.tiers.length; t++) {
      const kinds = keys.nodes.filter((n) => n.tier === t).map((n) => eventPlan(REG, n.event).kind);
      expect(kinds, keys.tiers[t]?.name).toContain('grudge-match');
    }
  });
});

describe('the rule card on the poster', () => {
  it('states the rule in a name and one line, from the career file or the defaults', () => {
    const texts = riderTexts(REG, DEFS);
    const profile = startCareer(DEFS, { ...DEFAULT_PROFILE });
    // Each ruled event's poster states its rule by the card its career gives it.
    for (const { def: d, node, plan } of RULED) {
      const rule = plan.rules.rule as GrudgeRuleId;
      const poster = posterView(REG, texts, plan, 'dusk', profile);
      expect(poster.rule, node).toEqual(ruleCard(REG, d, rule));
      expect(poster.rule?.line.length, node).toBeGreaterThan(10);
    }
    const keys = def('florida-keys');
    const classic = keys.nodes.find((n) => eventPlan(REG, n.event).kind === 'classic-race');
    if (!classic) throw new Error('no race to the line in the Keys');
    const race = posterView(REG, texts, planOf(keys, classic.id), 'dusk', profile);
    expect(race.rule).toBeNull();
    for (const id of GRUDGE_RULE_IDS) {
      const card = RULE_CARDS[id];
      expect(card.name, id).toMatch(/^[A-Z !'-]+$/);
      // Short enough to read on a phone card at a glance.
      expect(card.line.split(/\s+/).length, id).toBeLessThanOrEqual(16);
    }
  });

  it("a career file's show.rules overrides a card's words, and a broken entry falls back", () => {
    const keys = def('florida-keys');
    const fake = {
      ...REG,
      careers: {
        ...REG.careers,
        [keys.key]: {
          ...REG.careers[keys.key],
          show: { rules: { audit: { name: 'AUDIT TIME', line: 'He bills by the hit.' }, timber: 7 } },
        },
      },
    } as typeof REG;
    expect(ruleCard(fake, keys, 'audit')).toEqual({
      id: 'audit',
      name: 'AUDIT TIME',
      line: 'He bills by the hit.',
    });
    expect(ruleCard(fake, keys, 'timber')).toEqual({ id: 'timber', ...RULE_CARDS.timber });
  });
});

// The event card's objective line sits right under the rule card, so it must say what the rule
// judges (live check, 2026-10-03: the Collab's card read "Most style at the line wins. Finishing
// first is just content." and then "Beat Chad Speedwell to the line."; the race was won from 2nd
// of 2 on style). What each rule's objective line must say, and must never say.
const RULE_OBJECTIVE: Readonly<Record<GrudgeRuleId, { must: RegExp[]; mustNot: RegExp[] }>> = {
  // His hits add knockdowns to the count, so the count is not the whole story.
  audit: { must: [/knock .+ down/i, /per hit you take/i], mustNot: [/to the line/i] },
  // He rides differently; the score is the usual grudge score.
  'bad-connection': { must: [/beat .+ to the line|knock .+ down/i], mustNot: [] },
  // Style at the line decides it, never the place.
  collab: { must: [/style/i], mustNot: [/beat .+ to the line/i, /knock .+ down/i] },
  // Fists do not count: only traffic and scenery fell him.
  timber: { must: [/traffic or scenery/i], mustNot: [/knock \S.* down/i] },
};

describe("the card's objective line comes from the rule (live check, mustFix 4)", () => {
  const ruled = DEFS.flatMap((d) =>
    d.nodes.map((n) => ({ region: d.regionId, node: n.id, plan: eventPlan(REG, n.event) })),
  ).filter((x) => x.plan.rules.rule !== undefined);

  it('every grudge-rule event on a career map: no objective line contradicts its rule card', () => {
    // Every rule is on some map, so none is left unchecked.
    expect(new Set(ruled.map((x) => x.plan.rules.rule))).toEqual(new Set(GRUDGE_RULE_IDS));
    for (const { node, plan } of ruled) {
      const rule = plan.rules.rule as GrudgeRuleId;
      const text = objectiveText(REG, plan);
      for (const re of RULE_OBJECTIVE[rule].must) expect(text, `${node} (${rule})`).toMatch(re);
      for (const re of RULE_OBJECTIVE[rule].mustNot) expect(text, `${node} (${rule})`).not.toMatch(re);
    }
  });

  it('the cards read in plain words, rule by rule', () => {
    // The first event of each rule, its rival's name and its counts read from the packs.
    const collab = firstRuled('collab').plan;
    expect(objectiveText(REG, collab)).toBe(
      `Have more style cash than ${riderName(collab.rules.rival)} when you cross the line.`,
    );
    const audit = firstRuled('audit').plan;
    const auditCount = Number(beatRival(audit)?.params['knockdowns'] ?? audit.rules.knockdownsToWin ?? 1);
    expect(objectiveText(REG, audit)).toBe(
      `Knock ${riderName(audit.rules.rival)} down ${words(auditCount)} times, plus one per hit you take (up to ${words(AUDIT_MAX_LINE_ITEMS)} more).`,
    );
    // Raced to the line, or knocked down the event's count: by traffic and scenery under Timber.
    const either = (rule: GrudgeRuleId, down: string) => {
      const plan = ruledBy(rule).find(
        (x) => Number(beatRival(x.plan)?.params['orKnockdowns'] ?? 0) > 0,
      )?.plan;
      if (!plan) throw new Error(`no ${rule} event won either way`);
      const name = riderName(plan.rules.rival);
      const n = words(Number(beatRival(plan)?.params['orKnockdowns']));
      expect(objectiveText(REG, plan), rule).toBe(
        `Beat ${name} to the line, or knock ${name} ${down} ${n} times.`,
      );
    };
    either('timber', 'into traffic or scenery');
    either('bad-connection', 'down');
  });

  it('a rule played by knockdowns reads by the same rule (the race log judges it that way)', () => {
    const byKnockdowns = (p: EventPlan): EventPlan => ({
      ...p,
      rules: { ...p.rules, winBy: 'knockdowns', knockdownsToWin: 2 },
    });
    // Timber by knockdowns still counts only traffic and scenery.
    const timber = firstRuled('timber').plan;
    expect(objectiveText(REG, byKnockdowns(timber))).toBe(
      `Knock ${riderName(timber.rules.rival)} into traffic or scenery two times.`,
    );
    // The Collab by knockdowns is judged on knockdowns (race-log ignores the style rule then).
    const collab = firstRuled('collab').plan;
    expect(objectiveText(REG, byKnockdowns(collab))).toBe(
      `Knock ${riderName(collab.rules.rival)} down two times.`,
    );
  });
});
