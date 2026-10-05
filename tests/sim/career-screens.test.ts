/// <reference types="vite/client" />
// What the career screens show (run W-R), from the real packs: the map drawn from each region's
// roads (one panel per network, every event a pin, claimed roads after a win), the event cards in
// plain words, the garage in the player's units, the results and the teaser. ui/ only draws these;
// tests/e2e/career.spec.ts checks the drawing.
import { describe, expect, it } from 'vitest';
import { garageView, resultView, teaserView } from '../../src/app/career-flow';
import {
  AUDIT_MAX_LINE_ITEMS,
  bikeLadder,
  careerDefs,
  careerOf,
  careerView,
  eventPlan,
  globalTier,
  repairBill,
  settleRace,
  startCareer,
  tierPurse,
} from '../../src/career';
import { DEFAULT_PROFILE } from '../../src/save';
import { REG } from './career-harness';

const DEFS = careerDefs(REG);
const fresh = () => startCareer(DEFS, { ...DEFAULT_PROFILE });
/** Counts are written as words on the cards, up to ten. */
const words = (n: number) =>
  ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] ?? String(n);

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
    // Each wording is checked on the first card, over every region's map, whose event has that
    // rule. The names, counts and times are read from the event and rider files (the packs), so a
    // rebalanced count or a renamed rival changes the expected line with it.
    const cards = DEFS.flatMap((def) =>
      careerView(REG, DEFS, fresh(), def.regionId)
        .tiers.flatMap((t) => t.nodes)
        .map((card) => {
          const node = def.nodes.find((n) => n.id === card.id);
          if (!node) throw new Error(`no node ${card.id}`);
          return { def, node, card, plan: eventPlan(REG, node.event) };
        }),
    );
    type Row = (typeof cards)[number];
    const required = (r: Row) => r.plan.objectives.filter((o) => o.required);
    const only = (r: Row, kind: string) => required(r).length === 1 && required(r)[0]?.kind === kind;
    const param = (r: Row, key: string) => required(r)[0]?.params[key];
    const first = (what: string, pick: (r: Row) => boolean): Row => {
      const hit = cards.find(pick);
      if (!hit) throw new Error(`no card is ${what}`);
      console.log(`[print] ${what}: ${hit.def.regionId}/${hit.card.id}`);
      return hit;
    };
    const rival = (r: Row) => REG.riders[r.plan.rules.rival ?? '']?.name ?? '';
    const knockdowns = (r: Row) => Number(param(r, 'knockdowns') ?? r.plan.rules.knockdownsToWin ?? 1);

    const finish = first('a finish-the-race event', (r) => {
      const max = param(r, 'maxPlace');
      return only(r, 'finish-place') && (typeof max === 'number' ? max : 3) > r.plan.field.length;
    });
    expect(finish.card.objective).toBe('Finish the race.');

    const hunt = first(
      'a takedown hunt that ends on its count',
      (r) => only(r, 'takedowns') && !!r.plan.rules.endOnCount,
    );
    const huntCount = Number(param(hunt, 'count') ?? hunt.plan.rules.targetCount ?? 1);
    expect(hunt.card.objective).toBe(`Knock ${words(huntCount)} riders off.`);

    // Run W-T (grudge rules): a rival with The Audit is knocked down his count, and each hit he lands
    // adds one, up to the rule's cap; the card's line says so (live check, mustFix 4).
    const knockdownWin = (r: Row) =>
      only(r, 'beat-rival') && (param(r, 'winBy') ?? r.plan.rules.winBy) === 'knockdowns';
    const audit = first('an Audit grudge match', (r) => knockdownWin(r) && r.plan.rules.rule === 'audit');
    expect(audit.card.objective).toBe(
      `Knock ${rival(audit)} down ${words(knockdowns(audit))} times, plus one per hit you take (up to ${words(AUDIT_MAX_LINE_ITEMS)} more).`,
    );
    const plain = first(
      'a knockdown grudge match with no rule of its own',
      (r) => knockdownWin(r) && r.plan.rules.rule === undefined,
    );
    expect(plain.card.objective).toBe(`Knock ${rival(plain)} down ${words(knockdowns(plain))} times.`);

    const escape = first(
      'a cop escape by survival',
      (r) => only(r, 'escape') && r.plan.rules.escapeBy !== 'distance',
    );
    expect(escape.card.objective).toBe(
      `Once a cop is on you, last ${escape.plan.rules.surviveS ?? 60} s without being knocked off, or lose him.`,
    );

    const boss = first(
      'a region boss beaten to the line or knocked down',
      (r) =>
        r.node.id === r.def.boss &&
        only(r, 'beat-rival') &&
        r.plan.rules.rule === undefined &&
        Number(param(r, 'orKnockdowns') ?? 0) > 0,
    );
    expect(boss.card.objective).toBe(
      `Beat ${rival(boss)} to the line, or knock ${rival(boss)} down ${words(Number(param(boss, 'orKnockdowns')))} times.`,
    );
    expect(boss.card.kindLabel).toBe('Boss');

    // A locked card in an open tier names the events it waits on, by their card names.
    const waiting = first(
      'a locked card in the first tier',
      (r) => r.node.tier === 0 && r.card.state === 'locked' && r.node.requires.length > 0,
    );
    const nameOf = (id: string) => cards.find((c) => c.def === waiting.def && c.card.id === id)?.card.name;
    expect(waiting.card.reason).toBe(`Win ${waiting.node.requires.map(nameOf).join(' and ')} first.`);
    // A card in a closed tier says how many wins the tier before still needs, by that tier's name,
    // and names its boss when it has one (the exact count and boss are the pack's, not this test's).
    const closed = first('a card in the second tier', (r) => r.node.tier === 1);
    const before = closed.def.tiers[0]?.name ?? '';
    expect(closed.card.reason).toMatch(new RegExp(`^Win \\d+ more in ${before}(, then beat .+)?\\.$`));

    // A route with no name of its own is named by its first and last roads.
    const routeOf = (r: Row) =>
      (r.plan.lengths.find((l) => l.id === r.node.length) ?? r.plan.lengths[0])?.route ?? '';
    const unnamed = first(
      'a card on a route with no name',
      (r) => !(REG.routes[routeOf(r)] as { name?: string } | undefined)?.name,
    );
    const path = (REG.routes[routeOf(unnamed)] as unknown as { mainPath: string[] }).mainPath;
    const road = (id: string | undefined) => REG.roads[`${routeOf(unnamed).split(':')[0]}:${id}`]?.name;
    expect(unnamed.card.route).toBe(`${road(path[0])} to ${road(path[path.length - 1])}`);
  });

  it('a win claims roads on the map and opens the next events; the garage shows mph or km/h', () => {
    // The Keys' opening event, its claims, a secret and a rival are the packs'.
    const def = careerOf(DEFS, 'florida-keys');
    if (!def) throw new Error('no Keys career');
    const node = def.nodes.find((n) => n.id === def.tutorialNode);
    if (!node) throw new Error('no opening node');
    const plan = eventPlan(REG, node.event);
    // A secret with no cash of its own, so the pay lines are the place and the takedowns only.
    const secret = def.secrets.find((s) => s.cash === 0);
    if (!secret) throw new Error('no cashless secret in the Keys');
    const foe = plan.field[0];
    if (!foe) throw new Error('no rival in the opening field');
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
      // Enough hits and takedowns on one rival that any rider's grudge reaches the news (3 of 10).
      toRivals: { [foe]: { hits: 4, takedowns: 2, steals: 0 } },
      branches: [],
      secrets: [secret.id],
      field: [...plan.field],
      player: 'base:player',
    };
    const r = settleRace(fresh(), { reg: REG, def, node, plan, status, tally, build: 't', at: 'n' });
    const v = careerView(REG, DEFS, r.profile, 'florida-keys');
    const claimed = v.map.flatMap((p) => p.roads).filter((x) => x.state === 'claimed');
    expect(node.claims.length).toBeGreaterThan(0);
    expect(claimed.map((x) => x.id).sort()).toEqual([...node.claims].sort());
    expect(v.region.tally).toMatchObject({ won: 1, claimed: node.claims.length, secretsFound: 1 });
    expect(v.map.flatMap((p) => p.secrets).find((s) => s.id === secret.id)?.found).toBe(true);
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
    const n = node.claims.length;
    expect(shown.news).toContain(`${n === 1 ? 'A road' : `${n} roads`} claimed on the map.`);
    expect(shown.news).toContain(`Found: ${secret.name}.`);
    const grudge = r.report.grudges.find((g) => g.rival === foe);
    expect(grudge?.after ?? 0, 'the rival now holds a grudge worth the news').toBeGreaterThanOrEqual(3);
    expect(shown.news).toContain(`${REG.riders[foe]?.name} holds a grudge: ${grudge?.after} of 10.`);
    // The next event named is the one the map now suggests.
    const suggested = v.tiers.flatMap((t) => t.nodes).find((c) => c.id === v.suggested);
    expect(suggested?.state).toBe('open');
    expect(shown.nextName).toBe(suggested?.name);
    // The garage gives the current bike's speed in the player's units: the same speed both ways.
    const speed = (units: 'mph' | 'kmh') =>
      garageView(REG, DEFS, r.profile, units).bikes.find((b) => b.current)?.speed ?? '';
    const mph = /^(\d+) mph$/.exec(speed('mph'));
    const kmh = /^(\d+) km\/h$/.exec(speed('kmh'));
    expect(mph, speed('mph')).not.toBeNull();
    expect(kmh, speed('kmh')).not.toBeNull();
    expect(Number(mph?.[1])).toBeGreaterThan(0);
    expect(Math.abs(Number(kmh?.[1]) - Number(mph?.[1]) * 1.609344)).toBeLessThanOrEqual(1);
  });

  it('the teaser names the next region by its career, and a teaser with no next region names none', () => {
    const report = (next: string | null) =>
      ({ teaser: { lines: ['A', 'B'], next, freePlayAfter: true } }) as unknown as Parameters<
        typeof teaserView
      >[1];
    for (const def of DEFS)
      expect(teaserView(DEFS, report(def.regionKey))).toEqual({
        lines: ['A', 'B'],
        next: { id: def.regionId, name: def.regionName },
      });
    expect(teaserView(DEFS, report(null))?.next).toBeNull();
  });
});

// Playtest 3, the garage screen's numbers ("the garage with the six bikes and how many races each
// takes to afford", "repairs"): what a race pays now, the ladder's steps and a crash's cost. The
// rules are read from the career's own functions, not copied dollar figures.
describe('the garage screen: the ladder, what a race pays and what a crash costs', () => {
  const start = fresh();

  it('a fresh career is paid by the first tier; Season 2 by its scale', () => {
    const g = garageView(REG, DEFS, start, 'mph');
    expect(g.racePay).toBe(tierPurse(1));
    const s2 = garageView(REG, DEFS, { ...start, season: 2 }, 'mph');
    expect(s2.racePay).toBeGreaterThan(g.racePay ?? 0);
    expect((s2.racePay ?? 0) % 50).toBe(0);
  });

  it('the pay follows the highest open tier in the open regions', () => {
    const keys = DEFS[0];
    if (!keys) throw new Error('no career');
    const last = keys.tiers.length;
    const climbed = {
      ...start,
      regions: {
        ...start.regions,
        [keys.regionId]: { ...(start.regions[keys.regionId] as object), tier: last },
      },
    } as typeof start;
    expect(garageView(REG, DEFS, climbed, 'mph').racePay).toBe(tierPurse(globalTier(DEFS, keys, last - 1)));
  });

  it('every step-up bike is numbered along the ladder, slowest first; the rest are novelty rides', () => {
    const g = garageView(REG, DEFS, start, 'mph');
    const ladder = bikeLadder(REG, DEFS);
    const stepped = g.bikes.filter((b) => b.step !== undefined);
    expect(stepped.map((b) => b.key)).toEqual(
      ladder.filter((l) => g.bikes.some((b) => b.key === l.key)).map((l) => l.key),
    );
    for (const b of stepped) {
      expect(b.steps, b.key).toBe(ladder.length);
      expect(b.step, b.key).toBe(ladder.findIndex((l) => l.key === b.key) + 1);
    }
    expect(g.bikes.find((b) => b.current)?.step).toBe(1);
    expect(g.bikes.some((b) => b.step === undefined)).toBe(true);
  });

  it("a crash's cost is the repair bill for one wreck on that bike's price", () => {
    const g = garageView(REG, DEFS, start, 'mph');
    for (const b of g.bikes) expect(b.repairCash, b.key).toBe(repairBill(1, b.priceCash, Infinity).cash);
    expect(g.bikes.every((b) => (b.repairCash ?? 0) > 0)).toBe(true);
  });
});
