/// <reference types="vite/client" />
// The career as shipped (run W-R; interview, 2026-10-02: "Network map, tiered": events on each
// region's roads across all its routes and the four event types, wins open roads and the next tier,
// then the boss; "The map": claimed roads, secrets and shortcuts). Checked against the real packs:
// the maps, the events, the shop, and the rules' path from the first race to the teaser and free
// play. The bot's own races are tests/sim/career-headless-*.test.ts.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, regionChoices, streamForRoute } from '../../src/app';
import { rideLock } from '../../src/app/career-flow';
import {
  bare,
  bestOpenRank,
  bikeLadder,
  careerDefs,
  eventPlan,
  fieldLevel,
  garageBikes,
  globalTier,
  nodeState,
  progressOf,
  regionLockReason,
  regionOpen,
  settleRace,
  startCareer,
  suggestedNode,
  type CareerDef,
} from '../../src/career';
import { packOf } from '../../src/content';
import { DEFAULT_PROFILE, type Profile } from '../../src/save';
import { REG } from './career-harness';

const DEFS = careerDefs(REG);
const KINDS = ['classic-race', 'takedown-hunt', 'cop-escape', 'grudge-match'];

/** Every route of a career's region in its pack (the region's networks). */
function regionRoutes(def: CareerDef): string[] {
  return Object.keys(REG.routes)
    .filter((key) => {
      if (packOf(key) !== def.pack) return false;
      const net = REG.networks[`${packOf(key)}:${REG.routes[key]?.network ?? ''}`];
      return net?.region === def.regionId;
    })
    .sort();
}

/**
 * Real routes baked in playtest 3's wave B (T9.2 to T9.4) whose career events come in wave C
 * (T10.4 to T10.6, "real-world events and the W1 node swaps"). Each bake lands its road before its
 * event, so the rule "every route of the region has an event" waits for these alone. Shrink-only:
 * a listed route that gets an event fails below until it is struck off, and wave C empties it.
 */
const AWAITING_EVENT = new Set(['base:osm-duval-run', 'base:osm-seven-mile-run']);

describe('the career maps', () => {
  it("one per region, in chapter order (the regions are the packs', in the menu's order)", () => {
    const regions = regionChoices(REG).map((c) => c.id);
    console.log(`[print] careers examined: ${DEFS.map((d) => d.regionKey).join(', ')}`);
    expect(regions.length).toBeGreaterThan(1);
    expect(DEFS.map((d) => d.regionKey)).toEqual(regions);
  });

  for (const def of DEFS) {
    describe(def.regionName, () => {
      const plans = def.nodes.map((n) => eventPlan(REG, n.event));

      it('events across the four event types and every route of the region', () => {
        expect(new Set(plans.map((p) => p.kind))).toEqual(new Set(KINDS));
        const used = new Set(
          def.nodes.map((n, i) => plans[i]?.lengths.find((l) => l.id === n.length)?.route),
        );
        const routes = regionRoutes(def);
        expect(routes.length).toBeGreaterThanOrEqual(3);
        for (const r of routes) {
          if (AWAITING_EVENT.has(r)) {
            expect(used.has(r), `${r} has an event now: strike it off AWAITING_EVENT`).toBe(false);
            console.log(`[print] ${r}: awaiting its wave C career event`);
          } else expect(used, `${r} has no event`).toContain(r);
        }
        expect(routes.filter((r) => !AWAITING_EVENT.has(r)).length).toBeGreaterThanOrEqual(3);
        console.log(
          `${def.regionId}: ${def.nodes.length} events, kinds ${[...new Set(plans.map((p) => p.kind))].join(', ')}, ` +
            `routes ${routes.map(bare).join(', ')}`,
        );
      });

      it('every tier holds the wins that open it, and the boss, in the last tier, is the only finale', () => {
        // The tier-boss format (playtest 3) holds the wins and then the tier's boss: one more node.
        def.tiers.forEach((t, i) => {
          const held = def.nodes.filter((n) => n.tier === i).length;
          expect(held, t.id).toBeGreaterThanOrEqual(Math.max(1, t.requiredWins));
        });
        const boss = def.nodes.find((n) => n.id === def.boss);
        expect(boss?.tier).toBe(def.tiers.length - 1);
        expect(plans.filter((p) => p.finale).map((p) => p.key)).toEqual([boss?.event]);
        def.nodes.forEach((n, i) => expect(plans[i]?.tier, n.id).toBe(n.tier + 1));
        // Playtest 3 ("the boss of each tier must be beaten first"): a tier's boss is a grudge
        // match of that tier, named in plain words, and the last tier's is the region's.
        def.tiers.forEach((t, i) => {
          if (t.boss === undefined) return;
          const node = def.nodes.find((n) => n.id === t.boss);
          expect(node?.tier, `${t.id} boss`).toBe(i);
          expect(eventPlan(REG, node?.event ?? '').kind, `${t.id} boss`).toBe('grudge-match');
          expect(t.bossName, `${t.id} boss`).toMatch(/\S/);
          if (i === def.tiers.length - 1) expect(t.boss).toBe(def.boss);
        });
        expect(def.bossName).toMatch(/\S/);
      });

      it('every event builds a race whose field, route and grudges reach SimConfig', () => {
        const grudges = { [`${def.pack === 'base' ? 'base' : def.pack}:x`]: {} };
        // Any ride and any rider will do: the top of the bike ladder and the region's first rival.
        const bike = bikeLadder(REG, DEFS).at(-1)?.key ?? '';
        const rival = plans.flatMap((p) => p.field)[0] ?? '';
        expect(REG.bikes[bike], 'a ladder bike').toBeDefined();
        expect(REG.riders[rival], 'a rival').toBeDefined();
        for (const n of def.nodes) {
          const plan = eventPlan(REG, n.event);
          const length = plan.lengths[0];
          if (!length) throw new Error(n.event);
          const config = buildSimConfig(REG, streamForRoute(REG, length.route), {
            seed: 1,
            eventId: n.event,
            playerBike: bike,
            grudges: { [rival]: { 'base:player': 6 }, ...grudges },
          });
          const player = config.riders.find((r) => r.controller.kind === 'player');
          expect(player?.bike.contentId).toBe(bike);
          expect(config.grudges).toEqual({ [rival]: { 'base:player': 6 } });
          expect(config.event.tier).toBe(plan.tier);
          expect(config.riders.filter((r) => r.role === 'rival').map((r) => r.contentId)).toEqual(plan.field);
          if (plan.rules.rival) expect(plan.field).toContain(plan.rules.rival);
        }
      });

      it('secrets: a shortcut that is a real branch of its route, the pirate station and a stash', () => {
        // Every region hides at least one of each; secret roads (run W-U: the Keys' Unlisted Key, off
        // the marked sandbar) come on top.
        for (const kind of ['shortcut', 'stash', 'station'])
          expect(
            def.secrets.some((s) => s.kind === kind),
            `${def.regionId} hides a ${kind}`,
          ).toBe(true);
        for (const s of def.secrets.filter((x) => x.kind === 'road')) {
          // Its point and the roads the map hides until it is found are roads of the region's networks.
          for (const id of [s.road, ...(s.hides ?? [])])
            expect(REG.roads[`${def.pack}:${id}`], id).toBeDefined();
          expect(s.hides, s.id).toContain(s.road);
        }
        for (const s of def.secrets.filter((x) => x.kind === 'shortcut')) {
          const [route, branch] = s.ref.split('#');
          const key = `${def.pack}:${route ?? ''}`;
          const routeFile = REG.routes[key];
          if (!routeFile) throw new Error(`no route ${key}`);
          const ids = streamForRoute(REG, key)
            .routeFor(routeFile)
            .branches.map((b) => b.id);
          expect(ids, `${s.id}: ${s.ref}`).toContain(branch);
        }
      });

      it("the rules run from the first race to the boss, the next region's teaser and free play", () => {
        let p: Profile = startCareer(DEFS, { ...DEFAULT_PROFILE });
        let teaser = null;
        const order: string[] = [];
        for (let i = 0; i < def.nodes.length * 2; i++) {
          const node = suggestedNode(def, progressOf(def, p.regions));
          if (!node) break;
          order.push(node.id);
          const plan = eventPlan(REG, node.event);
          const r = settleRace(p, {
            reg: REG,
            def,
            node,
            plan,
            status: { state: 'won', endNow: false, objectives: [], headline: '' },
            tally: {
              finished: true,
              place: 1,
              racers: plan.field.length + 1,
              busted: false,
              fineCash: 0,
              takedowns: 0,
              style: {},
              styleCash: 0,
              toRivals: {},
              branches: [],
              secrets: [],
              field: [...plan.field],
              player: 'base:player',
            },
            build: 'test',
            at: 'now',
          });
          p = r.profile;
          teaser ??= r.report.teaser;
        }
        const progress = progressOf(def, p.regions);
        expect(progress.finaleBeaten).toBe(true);
        expect(order.at(-1)).toBe(def.boss);
        expect(teaser?.lines.length).toBeGreaterThan(0);
        expect(teaser?.freePlayAfter).toBe(true);
        // Free play: every node is open to ride again.
        expect(def.nodes.every((n) => nodeState(def, progress, n) !== 'locked')).toBe(true);
        // The boss's joke ride is in the garage now, and only now.
        const secret = def.unlocks[0]?.grant ?? '';
        expect(p.bikes.owned).toContain(secret);
        console.log(
          `${def.regionId}: the rules' path ${order.join(' > ')}; teaser next ${teaser?.next ?? 'none'}`,
        );
      });
    });
  }
});

describe('the garage over every region', () => {
  const start = startCareer(DEFS, { ...DEFAULT_PROFILE });
  const shown = garageBikes(REG, DEFS, start);
  const ladder = bikeLadder(REG, DEFS);

  it('the step-up bikes: each a clear step up, none for sale before its tier, the starting bike ridden', () => {
    expect(ladder.length).toBeGreaterThanOrEqual(3);
    const first = ladder[0];
    expect(shown.find((b) => b.current)?.key).toBe(first?.key);
    for (let i = 1; i < ladder.length; i++) {
      const [lower, higher] = [ladder[i - 1], ladder[i]];
      // Above the rubber band's 6%, so every upgrade reads as one (playtest 3, round 3: "Six bikes").
      expect(higher?.topSpeedMps, higher?.key).toBeGreaterThan((lower?.topSpeedMps ?? 0) * 1.06);
      expect(higher?.opensAt, higher?.key).toBeGreaterThanOrEqual(lower?.opensAt ?? 0);
      expect(higher?.opensAt, higher?.key).toBeGreaterThan(1);
      expect(shown.find((b) => b.key === higher?.key)?.state, higher?.key).toBe('locked');
    }
  });

  it("a later chapter's rides stay shut until its region opens; the joke rides hide until their boss", () => {
    const sellers = (bike: string) => DEFS.filter((d) => d.shop.some((s) => s.bike === bike));
    for (const b of shown.filter((x) => x.state !== 'owned')) {
      const by = sellers(b.key);
      if (by.length === 0 || by.some((d) => d === DEFS[0])) continue;
      expect(b.state, b.key).toBe('locked');
      expect(b.reason, b.key).toMatch(/^Opens when .+ falls\.$/);
    }
    // The joke rides are the bikes a career's boss unlocks, read from the career files.
    const jokes = [...new Set(DEFS.flatMap((d) => d.unlocks.map((u) => u.grant)))];
    console.log(`[print] joke rides examined: ${jokes.join(', ')}`);
    expect(jokes.length).toBeGreaterThan(0);
    for (const joke of jokes) {
      expect(REG.bikes[joke]?.tags, joke).toContain('secret');
      expect(
        shown.some((b) => b.key === joke),
        joke,
      ).toBe(false);
    }
    // And no bike kept secret is on show.
    for (const [key, bike] of Object.entries(REG.bikes))
      if (bike.tags?.includes('secret'))
        expect(
          shown.some((b) => b.key === key),
          key,
        ).toBe(false);
  });
});

describe('regions in order (playtest 3, round 3: "In order")', () => {
  it("a fresh career opens the first chapter; each later one opens when the one before's boss falls", () => {
    let p = startCareer(DEFS, { ...DEFAULT_PROFILE });
    expect(regionOpen(DEFS, p, DEFS[0] as CareerDef)).toBe(true);
    DEFS.forEach((def, i) => {
      const before = DEFS[i - 1];
      if (!before) return;
      expect(regionOpen(DEFS, p, def), def.regionId).toBe(false);
      expect(regionLockReason(DEFS, p, def)).toBe(`Opens when ${before.bossName} falls.`);
      const done = { ...progressOf(before, p.regions), finaleBeaten: true };
      p = { ...p, regions: { ...p.regions, [before.regionId]: done } };
      expect(regionOpen(DEFS, p, def), def.regionId).toBe(true);
    });
  });

  // The wave A live check rode Ferry Line Sprint and Pier Pressure on a fresh career: the ride path
  // is the gate, for every event of every shut region, with the real packs' names.
  it('the ride path refuses every event of a shut region, and the first chapter rides', () => {
    let p = startCareer(DEFS, { ...DEFAULT_PROFILE });
    const first = DEFS[0] as CareerDef;
    for (const n of first.nodes.filter((x) => nodeState(first, progressOf(first, p.regions), x) === 'open'))
      expect(rideLock(REG, DEFS, p, first, n), n.id).toBeNull();
    DEFS.forEach((def, i) => {
      const before = DEFS[i - 1];
      if (!before) return;
      const firstEvents = def.nodes.filter((x) => x.tier === 0);
      for (const n of def.nodes)
        expect(rideLock(REG, DEFS, p, def, n), `${def.regionId} ${n.id}`).toBe(
          `Opens when ${before.bossName} falls.`,
        );
      const done = { ...progressOf(before, p.regions), finaleBeaten: true };
      p = { ...p, regions: { ...p.regions, [before.regionId]: done } };
      // Open now: the first tier's events ride, a later tier's still wait on this region's own tiers.
      for (const n of firstEvents.filter((x) => x.requires.length === 0 && x.id !== def.tiers[0]?.boss))
        expect(rideLock(REG, DEFS, p, def, n), `${def.regionId} ${n.id}`).toBeNull();
      const late = def.nodes.find((x) => x.tier > 0);
      if (late) expect(rideLock(REG, DEFS, p, def, late), late.id).not.toBeNull();
    });
  });
});

describe('the field levels up every tier (playtest 3: "tier 3 rivals ride bikes as good as your best")', () => {
  const ladder = bikeLadder(REG, DEFS);
  for (const def of DEFS) {
    it(`${def.regionName}: the pace climbs tier by tier, bosses ride harder, fights climb gently`, () => {
      let pace = 0;
      def.tiers.forEach((_, t) => {
        const nodes = def.nodes.filter((n) => n.tier === t);
        const regular = nodes.filter((n) => n.id !== def.boss && n.id !== def.tiers[t]?.boss);
        const levels = regular.map((n) => fieldLevel(REG, DEFS, def, n));
        for (const [i, level] of levels.entries()) {
          const at = `${def.tiers[t]?.id} ${regular[i]?.id}`;
          if (!level) throw new Error(at);
          expect(level.paceMps, at).toBeGreaterThanOrEqual(pace);
          const best = ladder[bestOpenRank(ladder, globalTier(DEFS, def, t))];
          // From a region's third tier, rivals ride the best bike open; the law never outruns it.
          if (t >= 2 && !def.tiers[t]?.field?.rivalBike) expect(level.rivalBike, at).toBe(best?.key);
          expect(level.copTopCapMps, at).toBeLessThan(best?.topSpeedMps ?? 0);
          expect(level.paceMps, at).toBeLessThan(best?.topSpeedMps ?? 0);
        }
        if (levels[0]) pace = levels[0].paceMps;
        for (const boss of nodes.filter((n) => !regular.includes(n)))
          expect(fieldLevel(REG, DEFS, def, boss)?.paceMps, boss.id).toBeGreaterThanOrEqual(pace);
      });
      // "Gentle climb": about 10% easier to knock down at the first tier, about 20% harder by the last.
      const healthAt = (t: number) =>
        def.nodes
          .filter((n) => n.tier === t && n.id !== def.boss && n.id !== def.tiers[t]?.boss)
          .map((n) => fieldLevel(REG, DEFS, def, n)?.healthScale ?? 0);
      const within = (hs: number[], lo: number, hi: number) =>
        hs.forEach((h) => expect(h >= lo && h <= hi, `health ${h} in [${lo}, ${hi}]`).toBe(true));
      within(healthAt(0), 0.85, 0.95);
      within(healthAt(def.tiers.length - 1), 1.15, 1.25);
    });
  }
});

describe('free play keeps its own races', () => {
  it("the menu's region picker still starts each region's free-play race, never a career event", () => {
    const careerEvents = new Set(DEFS.flatMap((d) => d.nodes.map((n) => n.event)));
    const choices = regionChoices(REG);
    // Every career region keeps a free-play race on the menu.
    expect(choices.map((c) => c.id)).toEqual(expect.arrayContaining(DEFS.map((d) => d.regionKey)));
    for (const c of choices) {
      expect(careerEvents.has(c.eventId), `${c.id}: ${c.eventId} is a career event`).toBe(false);
      expect(REG.events[c.eventId]?.tier, `${c.id}: ${c.eventId} has a career tier`).toBeUndefined();
    }
  });
});
