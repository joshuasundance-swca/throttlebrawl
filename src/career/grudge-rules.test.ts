/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { registryFromGlob } from '../content';
import { DEFAULT_PROFILE } from '../save';
import { GRUDGE_RULE_IDS } from '../sim/api';
import { careerDefs, careerOf, eventPlan, startCareer, type CareerDef } from './index';
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
