import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tuningDefaults } from '../../src/core';
import {
  createRoadNetwork,
  createRouteProgress,
  jumpableWallAt,
  rampTruckShape,
  type BakedNetwork,
  type BakedRoad,
  type BakedRoute,
  type RoadNetwork,
  type RouteProgress,
} from '../../src/road';
import { lawMayTake, rivalTakeChance } from '../../src/sim/ai/branches';
import { SIM_TUNING } from '../../src/sim/create';
import { barrierLimits } from '../../src/sim/riders';
import { input, riderHarness, testConfig, type RiderHarness } from '../../src/sim/riders/testing';
import type { SimConfig, SimEvent } from '../../src/sim/types';

// Playtest 3, T5.2 (the maintainer, round 1: "The ramp trucks could be in motion and the static one
// could be used to get to shortcuts or something."): a static ramp truck on each of two hand-made
// networks, the Pacific Northwest's Mill Yard Cut and San Francisco's Plaza Cut. Each is a branch
// that stands behind a low `jumpable` wall beside the road, with its split zone past the lanes' outer
// edge: nobody on the ground can pick it, a bike that leaves the truck's lip and steers right flies
// over the wall and lands on it, and one that misses the truck simply stays on the road. These are
// the live checks, by sim ticks and on the baked files: the structure, who can get on, and what the
// rivals and the law do.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = <T>(pack: string, region: string, dir: string, id: string): T =>
  JSON.parse(readFileSync(path.join(root, 'packs', pack, 'regions', region, dir, `${id}.json`), 'utf8')) as T;

interface Cut {
  name: string;
  pack: string;
  region: string;
  network: string;
  /** The longest route over the avenue: the one every piece of the cut is on. */
  route: string;
  /** The avenue's piece the truck and the wall stand on, and the last piece (the route's finish). */
  avenue: string;
  end: string;
  /** The cut's branch, as the route names it, its roads and the sign's item in the region file. */
  branch: string;
  roads: readonly string[];
  signItem: string;
  /** The truck's feature id. */
  truck: string;
  /** Where the harness starts a rider, short of the truck, in the avenue piece's s. */
  runUpS: number;
}

const CUTS: readonly Cut[] = [
  {
    name: 'the Mill Yard Cut (Pacific Northwest)',
    pack: 'region-pnw',
    region: 'pacific-northwest',
    network: 'pnw-c1',
    route: 'pnw-sawmill-haul',
    avenue: 'pnw-sawmill-flats',
    end: 'pnw-sawmill-end',
    branch: 'pnw-mill-yard-cut',
    roads: ['c-pnw-mill-in', 'pnw-mill-yard-cut', 'c-pnw-mill-out'],
    signItem: 'mill-cut',
    truck: 'carrier-mill-cut',
    runUpS: 470,
  },
  {
    name: 'the Plaza Cut (San Francisco)',
    pack: 'region-sf',
    region: 'san-francisco',
    network: 'sf-downtown',
    route: 'sf-downtown-run',
    avenue: 'sf-dt-campus-way',
    end: 'sf-dt-campus-end',
    branch: 'sf-dt-plaza-cut',
    roads: ['c-dt-plaza-in', 'sf-dt-plaza-cut', 'c-dt-plaza-out'],
    signItem: 'dt-plaza-cut',
    truck: 'carrier-dt-plaza-cut',
    runUpS: 520,
  },
];

interface Live {
  road: RoadNetwork;
  route: RouteProgress;
  baked: BakedRoute;
  roads: BakedRoad[];
  config: SimConfig;
  region: { signs: { id: string; text: string; status?: string }[] };
}

function live(cut: Cut): Live {
  const network = json<BakedNetwork>(cut.pack, cut.region, 'networks', cut.network);
  const roads = network.roads.map((id) => json<BakedRoad>(cut.pack, cut.region, 'roads', id));
  const baked = json<BakedRoute>(cut.pack, cut.region, 'routes', cut.route);
  const road = createRoadNetwork({ network, roads });
  const route = createRouteProgress(road, baked);
  const base = testConfig();
  const config: SimConfig = {
    ...base,
    road,
    route,
    tuning: { ...base.tuning, ...tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)) },
  };
  const region = JSON.parse(
    readFileSync(path.join(root, 'packs', cut.pack, 'regions', cut.region, 'region.json'), 'utf8'),
  ) as Live['region'];
  return { road, route, baked, roads, config, region };
}

/** The outer edge of the avenue's lanes at s, on the right. */
function rightEdge(road: RoadNetwork, edge: number, s: number): number {
  return Math.max(...road.lanesAt(edge, s).map((l) => l.dCenterM + l.widthM / 2));
}

/** What a step of the sim did: the events by type. */
const kinds = (events: readonly SimEvent[]) => events.map((e) => e.type);

/** Steers a rider on a branch road along the middle of its lane. */
function follow(h: RiderHarness): number {
  const { pos } = h.rider;
  const lane = h.config.road.lanesAt(pos.edge, pos.s)[0];
  const target = lane?.dCenterM ?? 0;
  return Math.max(-1, Math.min(1, (target - pos.d) * 0.35 - h.rider.yaw * 1.5));
}

interface Flight {
  /** The edge ids the rider was on, in order, once each. */
  edges: string[];
  events: string[];
  /** Where it first touched down after the lip: its edge, d and the d limits a rider's centre keeps there. */
  landing: { edge: string; d: number; lo: number; hi: number } | null;
  end: { edge: string; s: number; d: number };
}

/**
 * Rides from `runUpS` at `speed` at full throttle up the truck and off its lip. While in the air on
 * the avenue's own piece it steers right until its d passes `steerUntilD`, from the `steerAfter`th
 * tick of the flight; after it touches down it follows the road's lane, up to `maxTicks`.
 */
function fly(
  l: Live,
  cut: Cut,
  opts: {
    speed: number;
    d: number;
    steerUntilD: number;
    steerAfter?: number;
    /** `air`: steer right in the air over the avenue (the default); `ground`: only once down again. */
    steerWhen?: 'air' | 'ground';
    /**
     * A thumb that holds the stick (1 right, -1 left, 0 none) from the lip until the bike is down,
     * over whatever road it is above, however far it has gone: it overrides `steerWhen`.
     */
    held?: -1 | 0 | 1;
    maxTicks?: number;
  },
): Flight {
  const avenue = l.road.edgeIndex(cut.avenue);
  const h = riderHarness(l.config, { edge: avenue, s: cut.runUpS, d: opts.d, speed: opts.speed });
  const edges: string[] = [];
  const events: string[] = [];
  let landing: Flight['landing'] = null;
  let airTicks = 0;
  let jumped = false;
  for (let t = 0; t < (opts.maxTicks ?? 900); t++) {
    const air = h.rider.mode === 'Airborne';
    if (air) airTicks++;
    const onAvenue = h.rider.pos.edge === avenue;
    let steer = 0;
    if (opts.held !== undefined) {
      steer = air ? opts.held : jumped ? follow(h) : 0;
    } else if (opts.steerWhen === 'ground') {
      // Down again after the jump on the avenue's own road: press right against the wall.
      if (jumped && !air && onAvenue) steer = 1;
      else if (!air && !onAvenue) steer = follow(h);
    } else if (air && onAvenue) {
      steer = airTicks > (opts.steerAfter ?? 0) && h.rider.pos.d < opts.steerUntilD ? 1 : 0;
    } else if (!air && !onAvenue) steer = follow(h);
    const out = h.step(input(1, 0, steer));
    events.push(...kinds(out));
    const id = l.road.edges[h.rider.pos.edge]?.id ?? '';
    if (edges[edges.length - 1] !== id) edges.push(id);
    if (out.some((e) => e.type === 'jump')) jumped = true;
    if (jumped && landing === null && out.some((e) => e.type === 'land')) {
      const limits = barrierLimits(l.config, h.rider.pos.edge, h.rider.pos.s);
      landing = { edge: id, d: h.rider.pos.d, lo: limits.lo, hi: limits.hi };
    }
    if (events.includes('crash')) break;
    if (t > 600 && id === cut.end) break;
  }
  const p = h.rider.pos;
  return {
    edges,
    events,
    landing,
    end: { edge: l.road.edges[p.edge]?.id ?? '', s: p.s, d: p.d },
  };
}

describe.each(CUTS)('$name', (cut) => {
  const l = live(cut);
  const avenue = l.road.edgeIndex(cut.avenue);
  const truck = l.road.featuresOf(avenue, 'rampTruck').find((f) => f.id === cut.truck);
  const zone = l.road.splitZones().find((z) => z.edge === avenue);
  const branch = l.route.branches.find((b) => b.id === cut.branch);

  it('is a named, signed branch no rival and no cop takes, on its own roads with no traffic', () => {
    expect(branch, 'the route names it').toBeDefined();
    expect(branch?.declared).toBe(true);
    expect(branch?.marked).toBe(true);
    expect(branch?.aiTake).toBe(0);
    expect(branch?.edges.map((e) => l.road.edges[e]?.id)).toEqual(cut.roads);
    // Every road of it is one shortcut lane: traffic runs the drive lanes, so none runs here.
    for (const id of cut.roads)
      expect(
        l.road.lanesAt(l.road.edgeIndex(id), 5).map((x) => x.kind),
        id,
      ).toEqual(['shortcut']);
    // Its sign is a live item of the region, with the sign's words, standing on the avenue before
    // the truck (so it can be vetoed like any sign).
    const item = l.region.signs.find((s) => s.id === cut.signItem);
    expect(item?.status).toBe('live');
    expect(branch?.sign).toBe(item?.text);
    const board = l.road
      .featuresOf(avenue, 'billboard')
      .find((f) => (f as { item?: string }).item === cut.signItem);
    expect(board, 'its sign is placed').toBeDefined();
    expect(board?.s1 ?? Infinity).toBeLessThan(truck?.s0 ?? 0);
    // A reward for the jump: a pad on the cut that is there in every race.
    const pads = cut.roads.flatMap((id) => l.road.featuresOf(l.road.edgeIndex(id), 'boostPad'));
    expect(pads).toHaveLength(1);
    expect(pads[0]?.params?.['slot']).toBeUndefined();
    console.log(
      `[examined] ${cut.branch}: ${branch?.kind}, gain ${branch?.gainM.toFixed(1)} m, aiTake ${branch?.aiTake}, sign "${branch?.sign}"`,
    );
  });

  it("stands a truck that is always there, a lip within 30 m of a zone that lies past the lanes' edge, behind a jumpable wall", () => {
    expect(truck, 'the truck').toBeDefined();
    expect(truck?.params?.['slot'], 'no slot: the seed never takes it away').toBeUndefined();
    expect(zone).toBeDefined();
    if (!truck || !zone) return;
    const len = l.road.edges[avenue]?.length ?? 0;
    const lip = truck.s0 + rampTruckShape(truck).run;
    // The zone is the road's last stretch, and its whole d range is out past the lanes' edge, which
    // no rider on the ground (whose centre stays inside it by half a bike) can reach.
    expect(zone.s1).toBeCloseTo(len, 6);
    const edge = rightEdge(l.road, avenue, zone.s0);
    expect(zone.d0).toBeGreaterThanOrEqual(edge);
    // The lip is close enough to the zone that every flight that clears the truck is still in the air
    // when it gets there, and the truck is on the right, on the side of the zone.
    expect(zone.s0 - lip).toBeGreaterThanOrEqual(0);
    expect(zone.s1 - lip).toBeLessThanOrEqual(30);
    expect(truck.d0).toBeGreaterThan(0);
    // The wall: jumpable, 1.2 m, on the right from the lip (at the latest) to the end of the avenue's piece,
    // on along the split connector and the first 125 m of the next piece (155 m past the split, as far
    // as the sim's hand-over between the roads looks), and nowhere else on the avenue's pieces.
    const connector = avenue + 1;
    const yard = avenue + 2;
    for (let s = lip; s <= len; s += 1)
      expect(jumpableWallAt(l.road, avenue, s, 'right')?.heightM, `s ${s}`).toBe(1.2);
    for (let s = 0; s < truck.s0 - 40; s += 5)
      expect(jumpableWallAt(l.road, avenue, s, 'right'), `s ${s}`).toBeNull();
    for (let s = 0; s <= (l.road.edges[connector]?.length ?? 0); s += 1)
      expect(jumpableWallAt(l.road, connector, s, 'right')?.heightM, `connector s ${s}`).toBe(1.2);
    for (let s = 0; s <= 125; s += 5)
      expect(jumpableWallAt(l.road, yard, s, 'right')?.heightM, `yard s ${s}`).toBe(1.2);
    for (let s = 126; s <= (l.road.edges[yard]?.length ?? 0); s += 5)
      expect(jumpableWallAt(l.road, yard, s, 'right'), `yard s ${s}`).toBeNull();
    for (const e of [avenue, connector, yard])
      for (let s = 0; s <= (l.road.edges[e]?.length ?? 0); s += 5)
        expect(jumpableWallAt(l.road, e, s, 'left'), `left ${e} ${s}`).toBeNull();
    // The cut's band starts inside the lanes' outer 2 m only, as far as a rider's centre goes, so a
    // grounded rider is never handed across (the sim tests below ride it).
    const first = l.road.edges[l.road.edgeIndex(cut.roads[0] ?? '')];
    expect(first).toBeDefined();
    console.log(
      `[examined] ${cut.avenue}: truck s ${truck.s0}-${truck.s1} (lip ${lip}), wall to ${len}, zone s ${zone.s0}-${zone.s1} d ${zone.d0}..${zone.d1}, lanes' edge ${edge}`,
    );
  });

  it('a rider on the ground never gets onto it, hugging the wall or not', () => {
    if (!truck) throw new Error('no truck');
    let rides = 0;
    for (const speed of [18, 28, 38]) {
      for (const steer of [0, 0.3, 1]) {
        // Past the truck, at the wall's foot, pressing right (or not) all the way past the split, the
        // stretch where the cut lies beside the road and the merge, to the avenue's last piece.
        const h = riderHarness(l.config, {
          edge: avenue,
          s: truck.s1 + 2,
          d: rightEdge(l.road, avenue, truck.s1) - 1.2,
          speed,
        });
        const seen = new Set<string>();
        for (let t = 0; t < 3000 && !seen.has(cut.end); t++) {
          h.step(input(1, 0, steer));
          seen.add(l.road.edges[h.rider.pos.edge]?.id ?? '');
        }
        console.log(
          `[examined] ground, ${speed} m/s steer ${steer}: ${[...seen].join(' > ')} (d ${h.rider.pos.d.toFixed(2)})`,
        );
        for (const id of cut.roads) expect(seen.has(id), `${speed} ${steer}: ${id}`).toBe(false);
        expect(seen.has(cut.end), `${speed} ${steer}: reached the last piece`).toBe(true);
        rides++;
      }
    }
    expect(rides).toBe(9);
  });

  it('a rider who rides up the truck and steers right lands on the cut, at every speed that clears the truck, and rides it to its end', () => {
    if (!truck) throw new Error('no truck');
    const lane = l.road.lanesAt(avenue, truck.s0).find((x) => x.dCenterM + x.widthM / 2 >= truck.d0) ?? null;
    expect(lane).not.toBeNull();
    const edge = rightEdge(l.road, avenue, truck.s0);
    let flights = 0;
    const lines: string[] = [];
    for (const speed of [24, 30, 36, 42]) {
      for (const d of [
        truck.d0 + 0.3,
        (truck.d0 + Math.min(truck.d1, edge - 0.9)) / 2,
        Math.min(truck.d1, edge - 1.2),
      ]) {
        for (const steerAfter of [0, 8]) {
          const f = fly(l, cut, { speed, d, steerUntilD: edge + 0.9, steerAfter });
          flights++;
          const label = `${speed} m/s from d ${d.toFixed(1)}, steering from tick ${steerAfter}`;
          lines.push(`${label}: ${f.edges.join(' > ')}`);
          expect(f.events, label).not.toContain('crash');
          expect(f.events, label).not.toContain('wobble');
          // Down on the cut's roads, inside the limits a rider's centre keeps there (the lane's edges,
          // a bike's half width in), so the landing is clean and nothing pulls the rider back.
          expect(cut.roads, label).toContain(f.landing?.edge);
          expect(f.landing?.d ?? NaN, label).toBeGreaterThanOrEqual(f.landing?.lo ?? Infinity);
          expect(f.landing?.d ?? NaN, label).toBeLessThanOrEqual(f.landing?.hi ?? -Infinity);
          // And along it to the avenue again, past every road of the cut, without a crash.
          expect(f.edges.slice(0, 4), label).toEqual(
            expect.arrayContaining([cut.avenue, ...cut.roads.slice(0, 1)]),
          );
          expect(f.edges.at(-1), label).toBe(cut.end);
        }
      }
    }
    console.log(`[examined] ${flights} flights up the truck, steering right\n  ${lines.join('\n  ')}`);
    expect(flights).toBe(24);
  });

  it('a rider who does not steer in the air, or presses right only once down again, stays on the avenue', () => {
    if (!truck) throw new Error('no truck');
    const edge = rightEdge(l.road, avenue, truck.s0);
    const d = (truck.d0 + Math.min(truck.d1, edge - 0.9)) / 2;
    for (const speed of [24, 36]) {
      const straight = fly(l, cut, { speed, d, steerUntilD: -99 });
      console.log(`[examined] no steering, ${speed} m/s: ${straight.edges.join(' > ')}`);
      for (const id of cut.roads) expect(straight.edges, `${speed}: ${id}`).not.toContain(id);
      expect(straight.events).not.toContain('crash');
      expect(straight.edges.at(-1)).toBe(cut.end);
      const down = fly(l, cut, { speed, d, steerUntilD: -99, steerWhen: 'ground' });
      console.log(`[examined] right only once down, ${speed} m/s: ${down.edges.join(' > ')}`);
      for (const id of cut.roads) expect(down.edges, `${speed} down: ${id}`).not.toContain(id);
    }
  });

  it("has a soft edge on the right of every road of the cut, so the cut's far side is never a wall that crashes a flight", () => {
    for (const id of cut.roads) {
      const e = l.road.edgeIndex(id);
      const len = l.road.edges[e]?.length ?? 0;
      for (const s of [0, len / 2, len]) {
        const v = l.road.vergeAt(e, s, 'right');
        expect(v.edge, `${id} s ${s}`).toBe('soft');
        expect(v.widthM, `${id} s ${s}`).toBeGreaterThan(0);
      }
    }
  });

  it('a thumb that holds right, holds left or holds nothing from the lip until the bike is down never crashes, at any speed off the lip, and rides on to the end of the route', () => {
    // The wave-B live check: a player who held the stick right through the whole flight crossed the
    // Plaza Cut in the air and crashed into its far edge (3 of 3). Whatever the thumb holds, the bike
    // comes down on the cut or on the avenue, and nothing on the way is a wall that crashes it.
    if (!truck) throw new Error('no truck');
    const edge = rightEdge(l.road, avenue, truck.s0);
    let flights = 0;
    const lines: string[] = [];
    for (const held of [1, -1, 0] as const) {
      for (const speed of [24, 30, 36, 40, 44, 48]) {
        for (const d of [truck.d0 + 0.3, Math.min(truck.d1, edge - 1.2)]) {
          const f = fly(l, cut, { speed, d, steerUntilD: 0, held, maxTicks: 2400 });
          flights++;
          const label = `held ${held}, ${speed} m/s from d ${d.toFixed(1)}`;
          lines.push(
            `${label}: ${f.edges.join(' > ')}; landed ${f.landing?.edge} d ${f.landing?.d.toFixed(2)}; ${f.events.filter((e) => e === 'crash' || e === 'wobble').join(',') || 'clean'}`,
          );
          expect(f.events, label).not.toContain('crash');
          expect(f.landing, label).not.toBeNull();
          // Down on the route's own roads (the avenue's pieces and the cut's), and on to its last piece.
          for (const id of f.edges)
            expect(l.route.allows(l.road.edgeIndex(id)), `${label}: ${id}`).toBe(true);
          expect(f.edges.at(-1), label).toBe(cut.end);
        }
      }
    }
    console.log(`[examined] ${flights} held-stick flights up the truck\n  ${lines.join('\n  ')}`);
    expect(flights).toBe(36);
  });

  it('is shut to every rival, the bold included, and to the law', () => {
    const choice = l.route.shortcuts.find((z) => z.edge === avenue);
    expect(choice, 'the route offers it as a choice').toBeDefined();
    if (!choice) return;
    for (const risk of [0, 0.5, 0.79, 0.8, 1])
      expect(rivalTakeChance(l.config, choice, risk, 0.9), `risk ${risk}`).toBe(0);
    expect(lawMayTake(l.config, choice)).toBe(false);
  });
});
