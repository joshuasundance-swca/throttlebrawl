// Run W-U fixes' live re-check, mustFix: #423 bent the Keys boardwalk's and sandbar's last stretch
// across the main road's asphalt to rejoin in the travel lane, but traffic only touched riders on
// its own corridor (the chain of roads it drives). A rider still on the branch road, over the main
// road's asphalt, had no contact with the cars there, so bikes drove through them (long race, seeds
// 1-10: 5 pass-throughs on branch ends, 0 on the main road; seed 6 an oncoming sedan).
//
// This checks every edge a route allows that traffic does not drive (the branches, their
// connectors, any road off the corridor), on every route of every live network, map-data ones
// included: wherever a rider's centre on that edge lies on a corridor road's asphalt (found here by
// brute force, independently of the sim), a car placed on the rider there makes contact through the
// sim's own traffic step. And off the asphalt, no corridor position is made up for the rider.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tuningDefaults, type LaneInfo } from '../../src/core';
import { createRoadNetwork, createRouteProgress, type RoadNetwork, type RoadPos } from '../../src/road';
import type { BakedNetwork, BakedRoad, BakedRoute } from '../../src/road/types';
import { SIM_TUNING } from '../../src/sim/create';
import { ridersSystem } from '../../src/sim/riders';
import type { SimConfig, SimEvent, SimRiderDef, SimTrafficTypeDef } from '../../src/sim/types';
import { addMover, createWorld, stepWorld, type SimSystem, type World } from '../../src/sim/world';
import {
  buildCorridor,
  linkOf,
  riderOnCorridor,
  toCorridor,
  type Corridor,
} from '../../src/sim/traffic/corridor';
import { placeVehicle, TRAFFIC, trafficState, trafficSystem } from '../../src/sim/traffic';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = <T>(file: string) => JSON.parse(readFileSync(file, 'utf8')) as T;

interface Live {
  network: BakedNetwork;
  roads: BakedRoad[];
  routes: BakedRoute[];
}

function live(): Live[] {
  const out: Live[] = [];
  for (const pack of readdirSync(path.join(root, 'packs'))) {
    const regions = path.join(root, 'packs', pack, 'regions');
    if (!existsSync(regions)) continue;
    for (const region of readdirSync(regions)) {
      const dir = (sub: string) => path.join(regions, region, sub);
      const list = <T>(sub: string) =>
        existsSync(dir(sub))
          ? readdirSync(dir(sub))
              .filter((f) => f.endsWith('.json'))
              .map((f) => json<T>(path.join(dir(sub), f)))
          : [];
      const roads = list<BakedRoad>('roads');
      const routes = list<BakedRoute>('routes');
      for (const network of list<BakedNetwork>('networks')) {
        const mine = new Set(network.roads);
        out.push({
          network,
          roads: roads.filter((r) => mine.has(r.id)),
          routes: routes.filter((r) => r.network === network.id),
        });
      }
    }
  }
  return out;
}

const CAR: SimTrafficTypeDef = {
  contentId: 'base:car',
  category: 'car',
  lengthM: 4.6,
  widthM: 1.8,
  cruiseMps: 24.6,
  hazard: 'normal',
};
const PLAYER: SimRiderDef = {
  contentId: 'base:player-0',
  name: 'player 0',
  role: 'player',
  faction: 'rider',
  controller: { kind: 'player', slot: 0 },
  bike: {
    contentId: 'base:bike',
    topSpeedMps: 38,
    accelMps2: 4.2,
    brakeMps2: 9,
    steerRateMps: 5.5,
    massKg: 180,
  },
  massKg: 85,
  healthMax: 100,
};

function simConfig(road: RoadNetwork, route: SimConfig['route']): SimConfig {
  return {
    seed: 7,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 31,
      byPlaceCash: [100, 50],
      raceEndTimeoutTicks: 1800,
    },
    riders: [PLAYER],
    weapons: [],
    trafficTypes: [CAR],
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: {
      ...tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)),
      'traffic.densitySame': 0,
      'traffic.densityOncoming': 0,
    },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

/** The drawn surface's outer edges at (edge, s): the outermost lane edges. */
function band(road: RoadNetwork, edge: number, s: number): { lo: number; hi: number } {
  let lo = 0;
  let hi = 0;
  for (const l of road.lanesAt(edge, s)) {
    lo = Math.min(lo, l.dCenterM - l.widthM / 2);
    hi = Math.max(hi, l.dCenterM + l.widthM / 2);
  }
  return { lo, hi };
}

/** The lanes a rider travelling `dir` along s rides: drive or shortcut lanes running that way. */
const travel = (lanes: readonly LaneInfo[], dir: number) =>
  lanes.filter((l) => (dir === 0 || l.direction === dir) && (l.kind === 'drive' || l.kind === 'shortcut'));

/**
 * The oracle: the foot of a world point on an edge by brute force (the nearest of all its samples,
 * then Newton steps on s), and whether it lies on the edge's drawn surface, `inset` inside its
 * outer edges, at the same height within the sim's contact height. Independent of the road
 * module's own projections.
 */
function onAsphalt(road: RoadNetwork, edge: number, x: number, y: number, z: number, inset: number) {
  const e = road.edges[edge];
  if (!e) return null;
  let best = 0;
  let bestD2 = Infinity;
  for (let i = 0; i < e.count; i++) {
    const dx = x - (e.x[i] ?? 0);
    const dz = z - (e.z[i] ?? 0);
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  if (bestD2 > 40 * 40) return null;
  let s = best * e.spacing;
  let d = 0;
  let along = 0;
  for (let iter = 0; iter < 40; iter++) {
    s = Math.min(e.length, Math.max(0, s));
    const f = road.frameAt(edge, s);
    const ox = x - f.x;
    const oz = z - f.z;
    d = -ox * f.tz + oz * f.tx;
    along = ox * f.tx + oz * f.tz;
    if (Math.abs(along) < 1e-9) break;
    const den = Math.max(0.1, 1 - f.kappa * d);
    const next = s + along / den;
    if ((next <= 0 && s === 0) || (next >= e.length && s === e.length)) break;
    s = next;
  }
  if (Math.abs(along) > 1e-3) return null;
  const b = band(road, edge, s);
  if (d < b.lo + inset || d > b.hi - inset) return null;
  if (Math.abs(road.toWorld(edge, s, d, 0).y - y) > TRAFFIC.maxContactH) return null;
  return { edge, s, d };
}

interface Hit {
  pos: RoadPos;
  on: { edge: number; s: number; d: number };
}

/** Every sampled rider centre on an off-corridor edge the route allows, on or clearly off asphalt. */
function sample(road: RoadNetwork, route: SimConfig['route'], c: Corridor) {
  const on: Hit[] = [];
  const off: RoadPos[] = [];
  let points = 0;
  for (let e = 0; e < road.edges.length; e++) {
    const edge = road.edges[e];
    if (!edge || !route.allows(e) || linkOf(c, e) >= 0) continue;
    const o = route.orientation(e);
    const dir: 1 | -1 = o === -1 ? -1 : 1;
    for (let s = 0; s <= edge.length; s += Math.min(4, edge.length / 2)) {
      const own = travel(road.lanesAt(e, s), o);
      if (own.length === 0) continue;
      const lo = Math.min(...own.map((l) => l.dCenterM - l.widthM / 2)) + 0.5;
      const hi = Math.max(...own.map((l) => l.dCenterM + l.widthM / 2)) - 0.5;
      for (const d of hi > lo ? [lo, (lo + hi) / 2, hi] : [(lo + hi) / 2]) {
        points++;
        const w = road.toWorld(e, s, d, 0);
        let hit: Hit['on'] | null = null;
        let near = false;
        for (const ce of c.edges) {
          hit ??= onAsphalt(road, ce, w.x, w.y, w.z, 0.3);
          // Clearly off: not within 0.5 m outside any corridor road's surface.
          near ||= onAsphalt(road, ce, w.x, w.y, w.z, -0.5) !== null;
        }
        if (hit) on.push({ pos: { edge: e, s, d, dir }, on: hit });
        else if (!near) off.push({ edge: e, s, d, dir });
      }
    }
  }
  return { on, off, points };
}

const SCENARIO: SimSystem[] = [ridersSystem, trafficSystem];

/** One rider at `pos` at 8 m/s, a car parked right on it on the corridor road below: one step. */
function touches(config: SimConfig, hit: Hit): { contact: boolean; events: SimEvent[] } {
  const world: World = createWorld(config);
  const m = addMover(world, 'rider', { ...hit.pos }, 0);
  m.speed = 8;
  for (const s of SCENARIO) s.init(world, config);
  const st = trafficState(world);
  const at = toCorridor(st.corridor, { edge: hit.on.edge, s: hit.on.s, d: hit.on.d, dir: 1 });
  if (!at) throw new Error('the oracle found a corridor road');
  const slot = placeVehicle(world, config, { type: 0, u: at.u, dir: 1, speed: 8, v0: 8 });
  st.cd[slot] = at.cd;
  const car = world.movers[st.id[slot] ?? -1];
  if (car) car.pos = { edge: hit.on.edge, s: hit.on.s, d: hit.on.d, dir: car.pos.dir };
  const events = stepWorld(world, config, SCENARIO, [{ steer: 0, throttle: 0, brake: 0, flags: 0 }]);
  return { contact: st.contactWith[0] === st.id[slot], events };
}

describe('a rider over a corridor road has contact with its traffic, on every live network', () => {
  it('every branch rider on the main road asphalt touches a car there; none off it gets a corridor spot', () => {
    const lines: string[] = [];
    const faults: string[] = [];
    let routes = 0;
    let points = 0;
    let overlaps = 0;
    let offChecked = 0;
    for (const n of live()) {
      const road = createRoadNetwork({ network: n.network, roads: n.roads });
      for (const r of n.routes) {
        routes++;
        const route = createRouteProgress(road, r);
        const config = simConfig(road, route);
        const c = buildCorridor(config);
        const got = sample(road, route, c);
        points += got.points;
        overlaps += got.on.length;
        // Per off-corridor edge and corridor road: the stretch overlapped, for the record.
        const stretch = new Map<string, { s0: number; s1: number; n: number; missed: number }>();
        for (const h of got.on) {
          const key = `${road.edges[h.pos.edge]?.id} over ${road.edges[h.on.edge]?.id}`;
          const t = stretch.get(key) ?? { s0: Infinity, s1: -Infinity, n: 0, missed: 0 };
          t.s0 = Math.min(t.s0, h.pos.s);
          t.s1 = Math.max(t.s1, h.pos.s);
          t.n++;
          const res = touches(config, h);
          if (!res.contact) {
            t.missed++;
            faults.push(
              `${r.id}: rider on ${road.edges[h.pos.edge]?.id} s ${h.pos.s.toFixed(0)} d ${h.pos.d.toFixed(1)} ` +
                `over ${road.edges[h.on.edge]?.id} s ${h.on.s.toFixed(0)} d ${h.on.d.toFixed(1)}: no contact`,
            );
          }
          stretch.set(key, t);
        }
        for (const [key, t] of stretch) {
          lines.push(
            `${r.id}: ${key}, s ${t.s0.toFixed(0)}..${t.s1.toFixed(0)}, ${t.n} points, ${t.missed} without contact`,
          );
        }
        // Off the asphalt: no corridor position, so no contact with a car the rider is not touching.
        for (const p of got.off) {
          offChecked++;
          if (riderOnCorridor(road, c, p, TRAFFIC.maxContactH)) {
            faults.push(
              `${r.id}: rider on ${road.edges[p.edge]?.id} s ${p.s.toFixed(0)} d ${p.d.toFixed(1)} is off the ` +
                'asphalt but has a corridor spot',
            );
          }
        }
      }
    }
    console.log(
      `[examined] ${routes} routes, ${points} rider points on off-corridor edges, ${overlaps} over a ` +
        `corridor road's asphalt (each run through the traffic step with a car on it), ${offChecked} ` +
        `clearly off it\n  ${lines.join('\n  ')}\n  ${faults.slice(0, 30).join('\n  ')}`,
    );
    expect(faults).toEqual([]);
    // The Keys' re-bent boardwalk and sandbar ends lie over the main road (run W-U fixes' re-check).
    expect(lines.some((l) => l.startsWith('m1-long-haul') && l.includes('m1-mangrove-boardwalk'))).toBe(true);
  }, 120_000);
});
