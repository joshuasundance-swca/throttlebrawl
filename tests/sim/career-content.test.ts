/// <reference types="vite/client" />
// The career as shipped (run W-R; interview, 2026-10-02: "Network map, tiered": events on each
// region's roads across all its routes and the four event types, wins open roads and the next tier,
// then the boss; "The map": claimed roads, secrets and shortcuts). Checked against the real packs:
// the maps, the events, the shop, and the rules' path from the first race to the teaser and free
// play. The bot's own races are tests/sim/career-headless-*.test.ts.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, regionChoices, streamForRoute } from '../../src/app';
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

describe('the career maps', () => {
  it('one per region, in chapter order: the Keys, the Pacific Northwest, San Francisco', () => {
    expect(DEFS.map((d) => d.regionId)).toEqual(['florida-keys', 'pacific-northwest', 'san-francisco']);
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
        for (const r of routes) expect(used, `${r} has no event`).toContain(r);
        console.log(
          `${def.regionId}: ${def.nodes.length} events, kinds ${[...new Set(plans.map((p) => p.kind))].join(', ')}, ` +
            `routes ${routes.map(bare).join(', ')}`,
        );
      });

      it('tiers of events ending in the boss, whose event is the only finale', () => {
        def.tiers.forEach((t, i) =>
          expect(
            def.nodes.some((n) => n.tier === i),
            t.id,
          ).toBe(true),
        );
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
        for (const n of def.nodes) {
          const plan = eventPlan(REG, n.event);
          const length = plan.lengths[0];
          if (!length) throw new Error(n.event);
          const config = buildSimConfig(REG, streamForRoute(REG, length.route), {
            seed: 1,
            eventId: n.event,
            playerBike: 'base:superbike-1000',
            grudges: { 'base:kevin-from-accounting': { 'base:player': 6 }, ...grudges },
          });
          const player = config.riders.find((r) => r.controller.kind === 'player');
          expect(player?.bike.contentId).toBe('base:superbike-1000');
          expect(config.grudges).toEqual({ 'base:kevin-from-accounting': { 'base:player': 6 } });
          expect(config.event.tier).toBe(plan.tier);
          expect(config.riders.filter((r) => r.role === 'rival').map((r) => r.contentId)).toEqual(plan.field);
          if (plan.rules.rival) expect(plan.field).toContain(plan.rules.rival);
        }
      });

      it('secrets: a shortcut that is a real branch of its route, the pirate station and a stash', () => {
        // Run W-U: the Keys add a secret road, Unlisted Key, off the marked sandbar.
        expect(
          def.secrets
            .map((s) => s.kind)
            .filter((k) => k !== 'road')
            .sort(),
        ).toEqual(['shortcut', 'stash', 'station']);
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
    for (const joke of ['base:golf-cart', 'base:lawnmower', 'base:mobility-scooter']) {
      expect(REG.bikes[joke]?.tags).toContain('secret');
      expect(shown.some((b) => b.key === joke)).toBe(false);
    }
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
    expect(regionChoices(REG).map((c) => c.eventId)).toEqual([
      'base:m1-skeleton-sprint',
      'region-pnw:pnw-fogline-run',
      'region-sf:sf-hill-sprint',
    ]);
  });
});
