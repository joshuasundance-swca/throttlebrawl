// Structures are solid, on the real roads (the maintainer, 2026-10-06, [decided]: a road race in a physical
// world with honest edges; "I've been high enough to land on buildings but the wall prevented it"). The race's
// world is the road's structures plan (src/road/structures.ts), planned from its network and seed as it starts:
// - the maintainer's case on Duval Street (Old Town's fronts) and in the Mission (the alley walls and
//   shopfronts): a rider flying over the sidewalk above a one-storey roof lands on it and rides it; control,
//   the old rules (main) hold him at the band's edge, a wall at any height;
// - downtown San Francisco's towers stand far over any flight: at the hood launch's apex (9.5 m) a rider meets
//   a tower's wall and never stands on it.
// Real networks, one player, the world's systems off but the ground beside the road (ISOLATED with the
// structures and the supports on), sim ticks only.
import { describe, expect, it } from 'vitest';
import {
  raceStructures,
  topAt,
  type BakedNetwork,
  type BakedNetworkBundle,
  type BakedRoad,
  type BakedRoute,
  type RoadNetwork,
  type StructurePlan,
} from '../../src/road';
import { riderLimits, riderState, ridersSystem } from '../../src/sim/riders';
import { plannedFrontAt, structuresOver } from '../../src/sim/riders/structures';
import { supportKindOf } from '../../src/sim/riders/supports';
import { gapSimConfig } from '../../src/sim/tumble/gap-fixture';
import type { SimConfig, SimEvent, SimInput } from '../../src/sim/types';
import { addMover, createWorld, stepWorld, type Mover, type World } from '../../src/sim/world';
import { ISOLATED } from './batch';

const print = (line: string) => process.stdout.write(`[structures-solid] ${line}\n`);
const networkFiles = import.meta.glob<BakedNetwork>('/packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('/packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const routeFiles = import.meta.glob<BakedRoute>('/packs/*/regions/*/routes/*.json', {
  eager: true,
  import: 'default',
});

/** The structures on (the default), with the supports they land on; the old rules with them off. */
const SOLID = { 'riders.structures': 1, 'riders.supports': 1 };
const OLD_RULES = { 'riders.structures': 0, 'riders.supports': 1 };

/** The real network and its route, one player on it, the world's systems off but the ground beside the road. */
function configOf(networkId: string, rules: Record<string, number>): SimConfig {
  const network = Object.values(networkFiles).find((n) => n.id === networkId);
  if (!network) throw new Error(`no network ${networkId}`);
  const roads = network.roads.map((id) => {
    const r = Object.values(roadFiles).find((x) => x.id === id);
    if (!r) throw new Error(`no road ${id}`);
    return r;
  });
  const route = Object.values(routeFiles).find((r) => r.network === networkId);
  if (!route) throw new Error(`no route on ${networkId}`);
  const bundle: BakedNetworkBundle = { network, roads };
  return gapSimConfig(bundle, { route, tuning: { ...ISOLATED, 'ground.offRoad': 1, ...rules } });
}

/**
 * A building front: a road position at a band's edge with a building whose roof stands `top` m over the road,
 * and the highest thing (a false front's parapet, a balcony's posts) between the edge and that roof, `clear`.
 */
interface Front {
  edge: number;
  s: number;
  side: 1 | -1;
  top: number;
  clear: number;
  rule: string;
}

/**
 * The highest top over a world point, m above the road at (edge, s, d), of a structure that holds a bike (or of
 * any, `any`), or null.
 */
function topOver(
  road: RoadNetwork,
  plan: StructurePlan,
  edge: number,
  s: number,
  d: number,
  any = false,
): number | null {
  const p = road.toWorld(edge, s, d, 0);
  const ground = road.surfaceHeight(edge, s, d);
  let best: number | null = null;
  for (const st of structuresOver(plan, p.x, p.z)) {
    if (!any && (2 * st.foot.hu < 2 || 2 * st.foot.hv < 2)) continue;
    const t = (topAt(st, p.x, p.z) ?? 0) - ground;
    if (best === null || t > best) best = t;
  }
  return best;
}

/**
 * The first building front (in edge, s and side order) on a front whose buildings are planned, whose roof is
 * `lo` to `hi` m over the road just past the edge and stays within a kerb of that for the 10 m a flight
 * carries along it.
 */
function findFront(road: RoadNetwork, plan: StructurePlan, lo: number, hi: number, zoneM = 20): Front {
  for (const e of road.edges)
    for (let s = 40; s < e.length - 40; s += 4)
      for (const side of [1, -1] as const) {
        const vside = side > 0 ? 'right' : 'left';
        if (!plannedFrontAt(road, e.index, s, vside)) continue;
        const edgeD = road.vergeAt(e.index, s, vside).dOuter;
        const top = topOver(road, plan, e.index, s, edgeD + side * 1.5);
        if (top === null || top < lo || top > hi) continue;
        // Where the flight comes down (3 to `zoneM` m on, 1 to 3.5 m in), one roof with nothing standing on it.
        let even = true;
        for (let ds = 3; ds <= zoneM && even; ds += 1)
          for (let dd = 1; dd <= 3.5 && even; dd += 0.5) {
            const t = topOver(road, plan, e.index, s + ds, edgeD + side * dd);
            const any = topOver(road, plan, e.index, s + ds, edgeD + side * dd, true);
            if (t === null || any === null || Math.abs(t - top) > 0.3 || any > t + 0.05) even = false;
          }
        if (!even) continue;
        let clear = top;
        for (let ds = 0; ds <= 12; ds += 2)
          for (let dd = -1; dd <= 3; dd += 0.1)
            clear = Math.max(clear, topOver(road, plan, e.index, s + ds, edgeD + side * dd, true) ?? 0);
        const p = road.toWorld(e.index, s, edgeD + side * 1.5, 0);
        const st = structuresOver(plan, p.x, p.z)[0];
        return { edge: e.index, s, side, top, clear, rule: st?.rule ?? '' };
      }
  throw new Error(`no building front ${lo} to ${hi} m tall on ${road.id}`);
}

interface Flight {
  world: World;
  rider: Mover;
  events: SimEvent[];
  /** The furthest the rider's centre got past its riding limit on the front's side, m. */
  furthestPast: number;
  /** Ticks he rode on a structure's top (in Road mode, before any crash), and his lowest height then, m. */
  ridden: number;
  riddenLowH: number;
}

/** The player in the air at the riding limit beside a front, `hM` over the road, heading toward it. */
function fly(config: SimConfig, at: Front, hM: number, speed: number, yaw: number, ticks: number): Flight {
  const road = config.road;
  const world = createWorld(config);
  const p = addMover(world, 'rider', { edge: at.edge, s: at.s, d: 0, dir: 1 }, 0);
  ridersSystem.init(world, config);
  const lim = riderLimits(world, config, at.edge, at.s, 0);
  p.pos.d = at.side > 0 ? lim.hi - 0.05 : lim.lo + 0.05;
  const st = riderState(world);
  p.mode = 'Airborne';
  p.speed = speed;
  p.yaw = at.side * yaw;
  st.yAbs[p.id] = road.surfaceHeight(at.edge, at.s, p.pos.d) + hM;
  st.vy[p.id] = 0;
  st.airTicks[p.id] = 0;
  st.lastTick[p.id] = -1;
  const events: SimEvent[] = [];
  let furthestPast = 0;
  let ridden = 0;
  let riddenLowH = Infinity;
  let crashed = false;
  for (let t = 0; t < ticks; t++) {
    // The bars toward the front for a third of a second in the air, then let go.
    const cmd: SimInput = {
      steer: t < 20 && p.mode === 'Airborne' ? at.side * 127 : 0,
      throttle: 80,
      brake: 0,
      flags: 0,
    };
    const fresh = stepWorld(world, config, [ridersSystem], [cmd]);
    events.push(...fresh);
    crashed ||= fresh.some((e) => e.type === 'crash');
    const riding: string = p.mode;
    if (!crashed && riding === 'Road' && supportKindOf(world, p.id) === 'structure') {
      ridden++;
      riddenLowH = Math.min(riddenLowH, p.h);
    }
    if (p.pos.edge === at.edge) {
      const l = riderLimits(world, config, at.edge, p.pos.s, p.pos.d);
      furthestPast = Math.max(furthestPast, at.side > 0 ? p.pos.d - l.hi : l.lo - p.pos.d);
    }
  }
  return { world, rider: p, events, furthestPast, ridden, riddenLowH };
}

const brief = (f: Flight) =>
  f.events
    .filter((e) => ['land', 'jump', 'wobble', 'crash'].includes(e.type))
    .map((e) => `${e.tick}:${e.type}${JSON.stringify(e.data)}`)
    .join(' ');

describe('the maintainer’s case on the real roads: high enough to land on a building', () => {
  // Old Town's roofs are walled in by their false fronts and side parapets (7.5 to 15 m a building): a slower
  // flight comes down within one; the Mission's alley walls run on.
  for (const [id, speed, zone] of [
    ['osm-keys-duval', 9, 11],
    ['sf-mission', 15, 20],
  ] as const) {
    it(`${id}: over the sidewalk above a one-storey roof, he lands on it and rides it; the old rules hold him`, () => {
      const solid = configOf(id, SOLID);
      const plan = raceStructures(solid.road, solid.seed);
      const at = findFront(solid.road, plan, 4, 8, zone);
      // A metre over the highest thing between the edge and the roof (a false front, a balcony's posts).
      const h = at.clear + 1;
      const f = fly(solid, at, h, speed, 0.3, 90);
      const land = f.events.find((e) => e.type === 'land');
      print(
        `${id}: ${at.rule} roof ${at.top.toFixed(2)} m (clear ${at.clear.toFixed(2)}) at ${solid.road.edges[at.edge]?.id} s ${at.s} side ${at.side}, from ${h.toFixed(2)} m; furthest past the edge ${f.furthestPast.toFixed(2)} m; rode its top ${f.ridden} ticks; ${brief(f)}`,
      );
      expect(land?.data).toMatchObject({ on: 'structure' });
      expect(f.furthestPast).toBeGreaterThan(1);
      // Riding it: up on its roof, in Road mode, for a quarter of a second at least.
      expect(f.ridden).toBeGreaterThanOrEqual(15);
      expect(f.riddenLowH).toBeGreaterThan(at.top - 0.5);
      // Control: main's rules (the front a wall at any height) on the same flight.
      const old = fly(configOf(id, OLD_RULES), at, h, speed, 0.3, 90);
      print(`${id} old rules: furthest past ${old.furthestPast.toFixed(3)}; ${brief(old)}`);
      expect(old.furthestPast).toBeLessThanOrEqual(1e-9);
      expect(old.events.find((e) => e.type === 'land')?.data['on']).toBeUndefined();
      expect(old.rider.h).toBe(0);
    });
  }
});

describe('a downtown tower out of reach is a wall at every reachable height (sf-downtown)', () => {
  it('at the hood launch’s apex (9.5 m) he meets a tower’s wall and never stands on it', () => {
    const config = configOf('sf-downtown', SOLID);
    const plan = raceStructures(config.road, config.seed);
    const at = findFront(config.road, plan, 30, 1000);
    for (const h of [1, 5, 9.5]) {
      const f = fly(config, at, h, 20, 0.5, 120);
      const met = f.events.find((e) => (e.type === 'wobble' || e.type === 'crash') && e.data['structure']);
      print(
        `tower ${at.rule} ${at.top.toFixed(0)} m, from ${h} m: furthest past ${f.furthestPast.toFixed(2)}; ${brief(f)}`,
      );
      expect(met?.data).toMatchObject({ object: 'building' });
      expect(f.events.some((e) => e.type === 'land' && e.data['on'] === 'structure')).toBe(false);
      // Never into it: the bike's side stays at the face (the band's edge, 0.5 m past the limit).
      expect(f.furthestPast).toBeLessThan(0.5 + 0.05);
    }
  });
});
