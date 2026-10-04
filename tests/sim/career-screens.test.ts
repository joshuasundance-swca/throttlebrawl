/// <reference types="vite/client" />
// What the career screens show (run W-R), from the real packs: the map drawn from each region's
// roads (one panel per network, every event a pin, claimed roads after a win), the event cards in
// plain words, the garage in the player's units, the results and the teaser. ui/ only draws these;
// tests/e2e/career.spec.ts checks the drawing.
import { describe, expect, it } from 'vitest';
import { garageView, resultView, teaserView } from '../../src/app/career-flow';
import { careerDefs, careerOf, careerView, eventPlan, settleRace, startCareer } from '../../src/career';
import { DEFAULT_PROFILE } from '../../src/save';
import { REG } from './career-harness';

const DEFS = careerDefs(REG);
const fresh = () => startCareer(DEFS, { ...DEFAULT_PROFILE });

describe('the career map screen', () => {
  for (const def of DEFS) {
    it(`${def.regionName}: a panel per network with every event a pin, and a card for each node in its tier`, () => {
      const v = careerView(REG, DEFS, fresh(), def.regionId);
      expect(v.region.careerName).toBe(def.name);
      expect(v.tiers.map((t) => t.nodes.length)).toEqual(
        def.tiers.map((_, i) => def.nodes.filter((n) => n.tier === i).length),
      );
      expect(v.tiers.map((t) => t.open)).toEqual(def.tiers.map((_, i) => i === 0));
      const pins = v.map.flatMap((p) => p.pins);
      expect(pins.map((p) => p.id).sort()).toEqual(def.nodes.map((n) => n.id).sort());
      expect(v.map.length).toBeGreaterThanOrEqual(2);
      for (const p of v.map) {
        expect(p.roads.length).toBeGreaterThan(0);
        for (const r of p.roads) expect(r.points.length).toBeGreaterThanOrEqual(2);
        const [x0, z0, x1, z1] = p.bounds;
        expect(x1).toBeGreaterThan(x0);
        expect(z1).toBeGreaterThan(z0);
      }
      // Only the region's opening event is open; it is the suggested one.
      expect(v.suggested).toBe(def.tutorialNode);
      const cards = v.tiers.flatMap((t) => t.nodes);
      expect(cards.filter((c) => c.state === 'open').map((c) => c.id)).toEqual([def.tutorialNode]);
      for (const c of cards) {
        expect(c.objective.length, c.id).toBeGreaterThan(8);
        expect(c.prize, c.id).toBeGreaterThan(0);
        expect(c.km, c.id).toBeGreaterThan(1);
      }
      console.log(
        `${def.regionId}: ${v.map.length} map panels (${v.map.map((p) => `${p.name}: ${p.roads.length} roads, ${p.pins.length} pins`).join('; ')})`,
      );
    });
  }

  it('the cards say what wins, in plain words, for each event type', () => {
    const v = careerView(REG, DEFS, fresh(), 'florida-keys');
    const card = (id: string) => v.tiers.flatMap((t) => t.nodes).find((c) => c.id === id);
    expect(card('shakedown')?.objective).toBe('Finish the race.');
    expect(card('sunburn-hunt')?.objective).toBe('Knock two riders off.');
    // Run W-T (grudge rules): Kevin's match is fought by his rule, The Audit (knock him down twice,
    // and each hit he lands adds one); the card's line says so (live check, mustFix 4).
    expect(card('kevin-grudge')?.objective).toBe(
      'Knock Kevin from Accounting down two times, plus one per hit you take (up to two more).',
    );
    expect(card('deputy-dash')?.objective).toBe(
      'Once a cop is on you, last 45 s without being knocked off, or lose him.',
    );
    expect(card('chad-grudge')?.objective).toBe('Knock Chad Speedwell down two times.');
    expect(card('drawbridge')?.objective).toBe(
      'Beat Mother Rust to the line, or knock Mother Rust down three times.',
    );
    expect(card('drawbridge')?.kindLabel).toBe('Boss');
    expect(card('sunburn-hunt')?.reason).toBe('Win The Shakedown first.');
    expect(card('deputy-dash')?.reason).toBe('Win 2 more in Tourist Season.');
    expect(card('shakedown')?.route).toBe('Marina Run to Sandbar Causeway');
  });

  it('a win claims roads on the map and opens the next events; the garage shows mph or km/h', () => {
    const def = careerOf(DEFS, 'florida-keys');
    if (!def) throw new Error('no Keys career');
    const node = def.nodes[0];
    if (!node) throw new Error('no node');
    const plan = eventPlan(REG, node.event);
    const status = { state: 'won' as const, endNow: false, objectives: [], headline: '' };
    const tally = {
      finished: true,
      place: 2,
      racers: 5,
      busted: false,
      fineCash: 0,
      takedowns: 1,
      style: { takedownCombo: { count: 1, cash: 100 } },
      styleCash: 100,
      toRivals: { 'base:kevin-from-accounting': { hits: 2, takedowns: 1, steals: 0 } },
      branches: [],
      secrets: ['boat-ramp-cut'],
      field: [...plan.field],
      player: 'base:player',
    };
    const r = settleRace(fresh(), { reg: REG, def, node, plan, status, tally, build: 't', at: 'n' });
    const v = careerView(REG, DEFS, r.profile, 'florida-keys');
    const claimed = v.map.flatMap((p) => p.roads).filter((x) => x.state === 'claimed');
    expect(claimed.map((x) => x.id).sort()).toEqual(['m1-marina-bends', 'm1-marina-run']);
    expect(v.region.tally).toMatchObject({ won: 1, claimed: 2, secretsFound: 1 });
    expect(v.map.flatMap((p) => p.secrets).find((s) => s.id === 'boat-ramp-cut')?.found).toBe(true);
    const shown = resultView(REG, def, plan, status, r.report, 2, 5, r.profile);
    // The Shakedown asks only to finish: second clears it, and only first is a win (skeptic, run W-S:
    // last place read "WON").
    expect(shown.title).toBe('2ND OF 5. CLEARED.');
    expect(resultView(REG, def, plan, status, r.report, 5, 5, r.profile).title).toBe('5TH OF 5. CLEARED.');
    expect(resultView(REG, def, plan, status, r.report, 1, 5, r.profile).title).toBe('WON');
    expect(shown.lines).toEqual([
      { label: '2nd place', cash: plan.byPlaceCash[1] },
      { label: 'Takedowns', cash: 100 },
    ]);
    expect(shown.news).toContain('2 roads claimed on the map.');
    expect(shown.news).toContain('Found: The boat ramp cut.');
    expect(shown.news).toContain('Kevin from Accounting holds a grudge: 8 of 10.');
    expect(shown.nextName).toBe('Sunburn Hunt');
    expect(garageView(REG, DEFS, r.profile, 'mph').bikes.find((b) => b.current)?.speed).toBe('100 mph');
    expect(garageView(REG, DEFS, r.profile, 'kmh').bikes.find((b) => b.current)?.speed).toBe('161 km/h');
  });

  it("the teaser names the next region, and San Francisco's points nowhere yet", () => {
    const report = (next: string | null) =>
      ({ teaser: { lines: ['A', 'B'], next, freePlayAfter: true } }) as unknown as Parameters<
        typeof teaserView
      >[1];
    expect(teaserView(DEFS, report('region-pnw:pacific-northwest'))).toEqual({
      lines: ['A', 'B'],
      next: { id: 'pacific-northwest', name: 'The Pacific Northwest' },
    });
    expect(teaserView(DEFS, report(null))?.next).toBeNull();
  });
});
