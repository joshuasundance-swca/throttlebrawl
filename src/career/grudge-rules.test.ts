/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { registryFromGlob } from '../content';
import { DEFAULT_PROFILE } from '../save';
import { GRUDGE_RULE_IDS } from '../sim/api';
import type { GrudgeRuleId } from '../sim/api';
import {
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

describe("each rule is played by its rival, in a grudge match on the career's map", () => {
  const cases = [
    ['florida-keys', 'kevin-grudge', 'audit', 'base:kevin-from-accounting'],
    ['florida-keys', 'junkyard-hunt', 'bad-connection', 'base:dial-up'],
    ['san-francisco', 'collab', 'collab', 'base:chad-speedwell'],
    ['pacific-northwest', 'big-cut', 'timber', 'region-pnw:old-growth'],
  ] as const;

  it('the Audit is Kevin, Bad Connection is Dial-Up, the Collab is Chad, Timber is Old Growth', () => {
    for (const [region, node, rule, rival] of cases) {
      const plan = planOf(def(region), node);
      expect(plan.kind, node).toBe('grudge-match');
      expect(plan.rules.rule, node).toBe(rule);
      expect(plan.rules.rival, node).toBe(rival);
      expect(plan.field, node).toContain(rival);
    }
    // Every rule in the closed list is played somewhere.
    expect(new Set(cases.map((c) => c[2]))).toEqual(new Set(GRUDGE_RULE_IDS));
  });

  it('the Audit and Timber are won by knockdowns (Timber as a boss either way); the Collab to the line', () => {
    const audit = planOf(def('florida-keys'), 'kevin-grudge');
    expect(audit.rules.winBy).toBe('knockdowns');
    const timber = planOf(def('pacific-northwest'), 'big-cut');
    expect(timber.objectives.find((o) => o.kind === 'beat-rival')?.params['orKnockdowns']).toBeGreaterThan(0);
    const collab = planOf(def('san-francisco'), 'collab');
    expect(collab.rules.winBy).toBe('finish-ahead');
    // The Collab is a style contest already: no separate style bonus asking for the same thing.
    expect(collab.objectives.map((o) => o.kind)).not.toContain('style-cash');
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
    const audit = posterView(REG, texts, planOf(def('florida-keys'), 'kevin-grudge'), 'dusk', profile);
    expect(audit.rule).toMatchObject({ id: 'audit', name: 'THE AUDIT' });
    expect(audit.rule?.line.length).toBeGreaterThan(10);
    const race = posterView(REG, texts, planOf(def('florida-keys'), 'long-haul'), 'dusk', profile);
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
    const text = (region: string, node: string) => objectiveText(REG, planOf(def(region), node));
    expect(text('san-francisco', 'collab')).toBe(
      'Have more style cash than Chad Speedwell when you cross the line.',
    );
    expect(text('florida-keys', 'kevin-grudge')).toBe(
      'Knock Kevin from Accounting down two times, plus one per hit you take (up to two more).',
    );
    expect(text('pacific-northwest', 'big-cut')).toBe(
      'Beat Old Growth to the line, or knock Old Growth into traffic or scenery three times.',
    );
    expect(text('florida-keys', 'junkyard-hunt')).toBe(
      'Beat Dial-Up to the line, or knock Dial-Up down two times.',
    );
  });

  it('a rule played by knockdowns reads by the same rule (the race log judges it that way)', () => {
    const byKnockdowns = (p: EventPlan): EventPlan => ({
      ...p,
      rules: { ...p.rules, winBy: 'knockdowns', knockdownsToWin: 2 },
    });
    // Timber by knockdowns still counts only traffic and scenery.
    const timber = objectiveText(REG, byKnockdowns(planOf(def('pacific-northwest'), 'big-cut')));
    expect(timber).toBe('Knock Old Growth into traffic or scenery two times.');
    // The Collab by knockdowns is judged on knockdowns (race-log ignores the style rule then).
    const collab = objectiveText(REG, byKnockdowns(planOf(def('san-francisco'), 'collab')));
    expect(collab).toBe('Knock Chad Speedwell down two times.');
  });
});
