import { describe, expect, it } from 'vitest';
import { resultView } from './career-flow';
import {
  applyWin,
  careerDefs,
  careerView,
  eventPlan,
  progressOf,
  settleRace,
  startCareer,
  type CareerDef,
  type CareerNode,
  type RaceStatus,
  type RaceTally,
} from '../career';
import { registryFromGlob } from '../content';
import { DEFAULT_PROFILE, type Profile } from '../save';

const reg = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const defs = careerDefs(reg);
const finales = defs.flatMap((def) => {
  const node = def.nodes.find((n) => n.id === def.boss);
  if (!node) return [];
  const plan = eventPlan(reg, node.event);
  return plan.rules.rival ? [{ def, node, plan, rival: plan.rules.rival }] : [];
});
function ready(def: CareerDef): Profile {
  let profile = startCareer(defs, { ...DEFAULT_PROFILE });
  for (const d of defs) {
    for (const n of d.nodes.filter((n) => d !== def || n.id !== d.boss)) {
      profile = {
        ...profile,
        regions: {
          ...profile.regions,
          [d.regionId]: applyWin(d, progressOf(d, profile.regions), n).progress,
        },
      };
    }
    if (d === def) break;
  }
  return profile;
}
function outcome(def: CareerDef, node: CareerNode, profile: Profile, won = true) {
  const plan = eventPlan(reg, node.event);
  const status: RaceStatus = { state: won ? 'won' : 'lost', endNow: true, headline: '', objectives: [] };
  const tally: RaceTally = {
    finished: true,
    place: won ? 1 : 5,
    racers: 5,
    busted: false,
    fineCash: 0,
    takedowns: 0,
    style: {},
    styleCash: 0,
    toRivals: {},
    branches: [],
    secrets: [],
    field: plan.field,
    player: 'base:player',
  };
  const after = settleRace(profile, { reg, def, node, plan, status, tally, build: 'test', at: 'test' });
  return {
    ...after,
    status,
    plan,
    view: resultView(reg, def, plan, status, after.report, tally.place, tally.racers, after.profile, defs),
  };
}
describe('content-derived regional finale recognition and stakes', () => {
  it('examines actual named finales', () => expect(finales.length).toBeGreaterThan(0));
  for (const { def, node, plan, rival } of finales) {
    it(`${def.regionName}: identifies the boss and the carried progression stake`, () => {
      const before = ready(def);
      const card = careerView(reg, defs, before, def.regionId)
        .tiers.flatMap((t) => t.nodes)
        .find((n) => n.id === node.id);
      expect(card?.kindLabel).toBe(`Region boss · ${reg.riders[rival]?.name}`);
      const next = defs.find((d) => d.regionKey === def.ending.next);
      if (next) expect(card?.objective).toContain(`Win to open ${next.regionName}.`);
      for (const award of def.unlocks.filter((u) => u.kind === 'boss-beaten' && reg.bikes[u.grant]))
        expect(card?.objective).toContain(reg.bikes[award.grant]?.name);
      if (def.ending.next === null && def.ending.freePlayAfter) {
        expect(card?.objective).toContain('Win for free play');
        for (const award of def.unlocks.filter((u) => u.kind === 'boss-beaten' && reg.bikes[u.grant]))
          expect(card?.objective).toContain(reg.bikes[award.grant]?.name);
      }
      const after = outcome(def, node, before);
      expect(after.view.title).toBe(`${reg.riders[rival]?.name.toUpperCase()} BEATEN`);
      const done = careerView(reg, defs, after.profile, def.regionId)
        .tiers.flatMap((t) => t.nodes)
        .find((n) => n.id === node.id);
      if (next) expect(done?.objective).toContain(`${next.regionName} is open.`);
      if (def.ending.next === null && def.ending.freePlayAfter) {
        expect(done?.objective).toContain('Free play is open.');
        expect(done?.objective).not.toContain('Win for free play');
      }
    });
    it(`${def.regionName}: loss and replay do not announce another boss completion`, () => {
      const before = ready(def);
      const loss = outcome(def, node, before, false);
      expect(loss.view.title).not.toContain('BEATEN');
      expect(loss.report.map).toBeNull();
      const first = outcome(def, node, before);
      for (const [outcome, title] of [
        ['busted', 'BUSTED'],
        ['quit', 'QUIT'],
        ['lost', 'LOST'],
      ] as const) {
        expect(
          resultView(reg, def, plan, first.status, { ...first.report, outcome }, 1, 5, first.profile, defs)
            .title,
        ).toBe(title);
      }
      const replay = outcome(def, node, first.profile);
      expect(replay.report.map?.finale).toBe(false);
      expect(replay.view.title).not.toContain('BEATEN');
      expect(replay.report.teaser).toBeNull();
      expect(replay.report.unlocked).toEqual([]);
      const nameless = { ...plan, rules: { ...plan.rules } };
      delete nameless.rules.rival;
      expect(
        resultView(reg, def, nameless, first.status, first.report, 1, 5, first.profile, defs).title,
      ).not.toContain('BEATEN');
    });
  }
  it('does not promise a next region absent from the carried definitions', () => {
    const picked = finales.find((f) => defs.some((d) => d.regionKey === f.def.ending.next));
    if (!picked) throw new Error('No authored next-region finale');
    const card = careerView(reg, [picked.def], ready(picked.def), picked.def.regionId)
      .tiers.flatMap((t) => t.nodes)
      .find((n) => n.id === picked.node.id);
    expect(card?.objective).not.toContain('Win to open');
  });
  it('ordinary event wins retain their ordinary result title', () => {
    const def = defs[0];
    const node = def?.nodes.find((n) => n.id !== def.boss && eventPlan(reg, n.event).kind === 'classic-race');
    if (!def || !node) throw new Error('No ordinary career race');
    expect(outcome(def, node, ready(def)).view.title).toBe('WON');
  });
});
