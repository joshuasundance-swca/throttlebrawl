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
  careerDefs,
  eventPlan,
  garageBikes,
  nodeState,
  progressOf,
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

      it('about ten events, across the four event types and every route of the region', () => {
        expect(def.nodes.length).toBe(10);
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

      it('three tiers of three and a finale tier with the boss, whose event is the only finale', () => {
        expect(def.tiers.map((t) => def.nodes.filter((n) => n.tier === def.tiers.indexOf(t)).length)).toEqual(
          [3, 3, 3, 1],
        );
        const boss = def.nodes.find((n) => n.id === def.boss);
        expect(boss?.tier).toBe(def.tiers.length - 1);
        expect(plans.filter((p) => p.finale).map((p) => p.key)).toEqual([boss?.event]);
        def.nodes.forEach((n, i) => expect(plans[i]?.tier, n.id).toBe(n.tier + 1));
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
        for (let i = 0; i < 20; i++) {
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
  it('three step-up bikes, a novelty ride per region, the joke rides hidden until their boss', () => {
    const start = startCareer(DEFS, { ...DEFAULT_PROFILE });
    const shown = garageBikes(REG, DEFS, start);
    expect(shown.map((b) => [b.key, b.state])).toEqual([
      ['base:moped', 'for-sale'],
      ['base:dirt-bike', 'for-sale'],
      ['base:chopper', 'for-sale'],
      ['base:rustbucket-400', 'owned'],
      ['base:streetfighter-750', 'locked'],
      ['base:superbike-1000', 'locked'],
    ]);
    const tops = ['base:rustbucket-400', 'base:streetfighter-750', 'base:superbike-1000'].map(
      (k) => REG.bikes[k]?.handling.topSpeedMps ?? 0,
    );
    // Each a clear step up: at least a fifth faster than the one before.
    expect(tops[1]).toBeGreaterThan((tops[0] ?? 0) * 1.2);
    expect(tops[2]).toBeGreaterThan((tops[1] ?? 0) * 1.2);
    for (const joke of ['base:golf-cart', 'base:lawnmower', 'base:mobility-scooter']) {
      expect(REG.bikes[joke]?.tags).toContain('secret');
      expect(shown.some((b) => b.key === joke)).toBe(false);
    }
  });
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
