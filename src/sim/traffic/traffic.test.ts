// traffic-1 acceptance (docs/milestones/M1.md, "traffic-1 · Traffic both ways"): sim tests that
// check no two vehicles overlap in a lane, a car stops behind a stopped obstacle without touching
// it, no vehicle spawns inside reaction range of a sim anchor, oncoming vehicles move toward
// decreasing s, no vehicle enters a shortcut edge, a scripted close pass fires a nearMiss, and a
// scripted run gives the same hash every run. Plus the contact rules and the density sliders.
import { describe, expect, it } from 'vitest';
import { tuningDefaults, type LaneInfo } from '../../core';
import {
  createRoadNetwork,
  createRouteProgress,
  FIXTURE_LANES,
  fixtureNetwork,
  type BakedNetworkBundle,
  type FixtureEdgeSpec,
  type RoadPos,
} from '../../road';
import { aiSystem } from '../ai';
import { combatSystem } from '../combat';
import { copsSystem } from '../cops';
import { createSim, SIM_TUNING } from '../create';
import { modifiersSystem } from '../modifiers';
import { pedsSystem } from '../peds';
import { gridPosition, raceSystem } from '../race';
import { ridersSystem } from '../riders';
import { tumbleSystem } from '../tumble';
import type { SimConfig, SimEvent, SimInput, SimRiderDef, SimTrafficTypeDef } from '../types';
import { addMover, createWorld, orderSystems, stepWorld, type SimSystem, type World } from '../world';
import { buildCorridor, pickLink, toCorridor, trafficMayEnter } from './corridor';
import { idmAccel } from './idm';
import {
  capPerDirection,
  oncomingEase,
  placeVehicle,
  spawnAllowed,
  TRAFFIC,
  trafficState,
  trafficSystem,
  vehicleInfo,
} from './index';

// ---- fixtures ----------------------------------------------------------------------------

const CAR: SimTrafficTypeDef = {
  contentId: 'base:car',
  category: 'car',
  lengthM: 4.6,
  widthM: 1.8,
  cruiseMps: 24.6,
  hazard: 'normal',
};
const TRUCK: SimTrafficTypeDef = {
  contentId: 'base:truck',
  category: 'truck',
  lengthM: 7.5,
  widthM: 2.4,
  cruiseMps: 22,
  hazard: 'big',
};
const PED: SimTrafficTypeDef = {
  contentId: 'base:ped',
  category: 'pedestrian',
  lengthM: 0.5,
  widthM: 0.5,
  cruiseMps: 1.4,
  hazard: 'normal',
};
const BROKEN: SimTrafficTypeDef = { ...CAR, contentId: 'base:broken', cruiseMps: 0 };
const TYPES = [CAR, TRUCK, PED];
const BIKE_TOP = 38;
const MAX_CRUISE = 24.6;
/** The fairness rule, computed independently of the module: (top speed + cruise) × 2 s. */
const REACTION_M = (BIKE_TOP + MAX_CRUISE) * 2;

const TWO_LANES: readonly LaneInfo[] = [
  { id: 'L0', dCenterM: -7.6, widthM: 1.5, direction: -1, kind: 'shoulder' },
  { id: 'L2', dCenterM: -5.1, widthM: 3.4, direction: -1, kind: 'drive' },
  { id: 'L1', dCenterM: -1.7, widthM: 3.4, direction: -1, kind: 'drive' },
  { id: 'R1', dCenterM: 1.7, widthM: 3.4, direction: 1, kind: 'drive' },
  { id: 'R2', dCenterM: 5.1, widthM: 3.4, direction: 1, kind: 'drive' },
  { id: 'R0', dCenterM: 7.6, widthM: 1.5, direction: 1, kind: 'shoulder' },
];
const WITH_SHORTCUT: readonly LaneInfo[] = [
  ...FIXTURE_LANES,
  { id: 'X1', dCenterM: 6.5, widthM: 3.0, direction: 1, kind: 'shortcut' },
];

const EDGES: readonly FixtureEdgeSpec[] = [
  { id: 'a', lengthM: 600, kappa: 0 },
  { id: 'b', lengthM: 800, kappa: 1 / 300, grade: 0.02 },
  { id: 'c', lengthM: 600, kappa: -1 / 400 },
];

function bundle(
  edges: readonly FixtureEdgeSpec[],
  lanes: Record<string, readonly LaneInfo[]> = {},
): BakedNetworkBundle {
  const b = fixtureNetwork(edges);
  return {
    network: b.network,
    roads: b.roads.map((r) =>
      lanes[r.id] ? { ...r, laneSections: [{ s0: 0, lanes: lanes[r.id] ?? [] }] } : r,
    ),
  };
}

const bike = {
  contentId: 'base:bike',
  topSpeedMps: BIKE_TOP,
  accelMps2: 4.2,
  brakeMps2: 9,
  steerRateMps: 5.5,
  massKg: 180,
};
function rider(role: SimRiderDef['role'], i: number): SimRiderDef {
  return {
    contentId: `base:${role}-${i}`,
    name: `${role} ${i}`,
    role,
    faction: role === 'cop' ? 'law' : 'rider',
    controller:
      role === 'player'
        ? { kind: 'player', slot: 0 }
        : role === 'cop'
          ? { kind: 'cop' }
          : { kind: 'ai', style: 'racer' },
    bike,
    massKg: 85,
    healthMax: 100,
  };
}
const FIELD = [
  rider('rival', 0),
  rider('rival', 1),
  rider('rival', 2),
  rider('rival', 3),
  rider('cop', 4),
  rider('player', 5),
];

interface Opts {
  edges?: readonly FixtureEdgeSpec[];
  lanes?: Record<string, readonly LaneInfo[]>;
  riders?: readonly SimRiderDef[];
  types?: readonly SimTrafficTypeDef[];
  tuning?: Record<string, number>;
  seed?: number;
  pace?: number;
}

function makeConfig(o: Opts = {}): SimConfig {
  const edges = o.edges ?? EDGES;
  const road = createRoadNetwork(bundle(edges, o.lanes));
  const ids = edges.map((e) => e.id);
  const last = edges[edges.length - 1];
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: ids[0] ?? 'a', s: 20, dir: 1 },
    finish: { road: last?.id ?? 'c', s: (last?.lengthM ?? 0) - 20 },
    mainPath: ids,
    allowedRoads: ids,
    closed: false,
  });
  return {
    seed: o.seed ?? 99,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: o.pace ?? 31,
      byPlaceCash: [100, 50],
      raceEndTimeoutTicks: 1800,
    },
    riders: o.riders ?? FIELD,
    weapons: [],
    trafficTypes: o.types ?? TYPES,
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: { ...tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)), ...(o.tuning ?? {}) },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

const ALL: SimSystem[] = orderSystems([
  aiSystem,
  ridersSystem,
  combatSystem,
  copsSystem,
  trafficSystem,
  pedsSystem,
  tumbleSystem,
  raceSystem,
  modifiersSystem,
]);

/** A world built the way createSim builds it, with access to traffic's state. */
function raceWorld(config: SimConfig): World {
  const world = createWorld(config);
  config.riders.forEach((_d, i) => addMover(world, 'rider', gridPosition(config, i), i));
  for (const s of ALL) s.init(world, config);
  return world;
}

/** A scripted player: full throttle, a slow weave inside its lane. */
function scripted(tick: number): SimInput {
  return { steer: Math.round(Math.sin(tick / 90) * 20), throttle: 255, brake: 0, flags: 0 };
}

/** Only riders and traffic, for scripted scenarios with hand-placed movers. */
const SCENARIO: SimSystem[] = [ridersSystem, trafficSystem];
function scenarioWorld(config: SimConfig, riders: { pos: RoadPos; speed: number }[]): World {
  const world = createWorld(config);
  riders.forEach((r, i) => {
    const m = addMover(world, 'rider', { ...r.pos }, i);
    m.speed = r.speed;
  });
  for (const s of SCENARIO) s.init(world, config);
  return world;
}
const hold = (throttle: number): SimInput => ({ steer: 0, throttle, brake: 0, flags: 0 });
const SOLO = [rider('player', 0)];
const NO_TRAFFIC = { 'traffic.densitySame': 0, 'traffic.densityOncoming': 0 };

function uOf(world: World, id: number): number {
  const m = world.movers[id];
  const p = m ? toCorridor(trafficState(world).corridor, m.pos) : null;
  if (!p) throw new Error(`entity ${id} is off the corridor`);
  return p.u;
}

function anchors(world: World, config: SimConfig): number[] {
  const out: number[] = [];
  for (const m of world.movers) {
    const role = config.riders[m.riderIndex]?.role;
    if (m.kind !== 'rider' || (role !== 'player' && role !== 'rival')) continue;
    const p = toCorridor(trafficState(world).corridor, m.pos);
    if (p) out.push(p.u);
  }
  return out;
}

/** Counts same-lane vehicle pairs and records any whose boxes overlap along the lane. */
function laneOverlaps(config: SimConfig, world: World, out: { checks: number; bad: string[] }): void {
  const st = trafficState(world);
  for (let a = 0; a < st.id.length; a++) {
    for (let b = a + 1; b < st.id.length; b++) {
      if (st.dir[a] !== st.dir[b] || st.rank[a] !== st.rank[b]) continue;
      out.checks++;
      const la = config.trafficTypes[st.type[a] ?? 0]?.lengthM ?? 0;
      const lb = config.trafficTypes[st.type[b] ?? 0]?.lengthM ?? 0;
      const dist = Math.abs((st.u[a] ?? 0) - (st.u[b] ?? 0));
      if (dist < (la + lb) / 2)
        out.bad.push(`tick ${world.tick} slots ${a}/${b}: ${dist.toFixed(2)} m apart`);
    }
  }
}

// ---- tests -------------------------------------------------------------------------------

describe('traffic corridor and route choice', () => {
  it('chains the main road into one coordinate that round-trips road positions', () => {
    const config = makeConfig();
    const c = buildCorridor(config);
    expect(c.edges).toEqual([0, 1, 2]);
    expect(c.length).toBeCloseTo(2000, 6);
    // Traffic's span ends at the finish line (road c, s 580), not at the road's end.
    expect(c.lo).toBe(0);
    expect(c.hi).toBeCloseTo(1980, 6);
    const p = toCorridor(c, { edge: 1, s: 123, d: -1.7, dir: -1 });
    expect(p).toEqual({ u: 723, cd: -1.7, dir: -1 });
  });

  it('never routes onto a road with a shortcut lane, and prefers drive roads at a junction', () => {
    const config = makeConfig({
      edges: [...EDGES, { id: 'd', lengthM: 300, kappa: 0 }],
      lanes: { c: WITH_SHORTCUT },
    });
    expect(trafficMayEnter(config.road, 2)).toBe(false);
    expect(trafficMayEnter(config.road, 1)).toBe(true);
    expect(buildCorridor(config).edges).toEqual([0, 1]); // stops at the shortcut road
    const both = [
      { edge: 2, entersAt: 'from' as const },
      { edge: 3, entersAt: 'from' as const },
    ];
    expect(pickLink(config.road, both, () => true)?.edge).toBe(3);
    expect(pickLink(config.road, [{ edge: 2, entersAt: 'from' }], () => true)).toBeNull();
  });
});

describe('IDM car-following', () => {
  it('cruises on a free road and brakes hard for a stopped leader close ahead', () => {
    expect(idmAccel(24.6, 24.6, Infinity, 0)).toBeCloseTo(0, 6);
    expect(idmAccel(10, 24.6, Infinity, 0)).toBeGreaterThan(1);
    expect(idmAccel(24.6, 24.6, 30, 0)).toBeLessThan(-8);
    expect(idmAccel(0, 24.6, 2.9, 0)).toBeLessThan(0); // stays put inside the minimum gap
  });
});

describe('traffic-1 sim acceptance', () => {
  it('no two vehicles overlap in a lane, and oncoming vehicles move toward decreasing s', () => {
    const config = makeConfig({ tuning: { 'traffic.densitySame': 3, 'traffic.densityOncoming': 3 } });
    const world = raceWorld(config);
    const st = trafficState(world);
    const overlap = { checks: 0, bad: [] as string[] };
    const wrongWay: string[] = [];
    let oncomingSteps = 0;
    let sameSteps = 0;
    let edgeCrossings = 0;
    let crossingError = 0;
    let maxVehicles = 0;
    let prev = new Map<number, { pos: RoadPos; u: number }>();
    while (world.tick < 60 * 120) {
      stepWorld(world, config, ALL, [scripted(world.tick)]);
      const n = st.id.length;
      maxVehicles = Math.max(maxVehicles, n);
      laneOverlaps(config, world, overlap);
      const next = new Map<number, { pos: RoadPos; u: number }>();
      for (let k = 0; k < n; k++) {
        const id = st.id[k] ?? -1;
        const m = world.movers[id];
        if (!m) continue;
        const u = st.u[k] ?? 0;
        next.set(id, { pos: { ...m.pos }, u });
        const oncoming = st.dir[k] !== st.corridor.routeDir;
        if (m.pos.dir !== (oncoming ? -1 : 1))
          wrongWay.push(`tick ${world.tick} slot ${k}: dir ${m.pos.dir}`);
        const was = prev.get(id);
        if (!was || st.spawnTick[k] === world.tick - 1 || m.speed < 0.01) continue;
        if (was.pos.edge !== m.pos.edge) {
          // Across a junction: the distance travelled equals speed × dt (nothing lost or doubled).
          edgeCrossings++;
          crossingError = Math.max(crossingError, Math.abs(Math.abs(u - was.u) - m.speed / 60));
          continue;
        }
        const ok = oncoming ? m.pos.s < was.pos.s : m.pos.s > was.pos.s;
        if (!ok) wrongWay.push(`tick ${world.tick} slot ${k}: s ${was.pos.s} -> ${m.pos.s}`);
        if (oncoming) oncomingSteps++;
        else sameSteps++;
      }
      prev = next;
    }
    console.log(
      `traffic overlap run: ${world.tick} ticks, up to ${maxVehicles} vehicles, ${overlap.checks} same-lane pair checks, ` +
        `${oncomingSteps} oncoming and ${sameSteps} same-way moving steps, ${edgeCrossings} edge crossings ` +
        `(max distance error ${crossingError.toExponential(1)} m), ${st.spawns} spawns (${st.recycles} recycled)`,
    );
    expect(overlap.bad.slice(0, 3)).toEqual([]);
    expect(wrongWay.slice(0, 3)).toEqual([]);
    expect(crossingError).toBeLessThan(1e-6);
    expect(maxVehicles).toBeGreaterThanOrEqual(10);
    expect(overlap.checks).toBeGreaterThan(1000);
    expect(oncomingSteps).toBeGreaterThan(1000);
    expect(sameSteps).toBeGreaterThan(1000);
    expect(edgeCrossings).toBeGreaterThan(0);
    expect(st.recycles).toBeGreaterThan(0);
  }, 120_000);

  it('a car stops behind a stopped rider, and behind a stopped vehicle, without touching', () => {
    for (const obstacle of ['rider', 'vehicle'] as const) {
      const config = makeConfig({ riders: SOLO, types: [CAR, BROKEN], tuning: NO_TRAFFIC });
      const world = scenarioWorld(config, [{ pos: { edge: 0, s: 500, d: 1.7, dir: 1 }, speed: 0 }]);
      let obstacleU = 500;
      let obstacleLen = TRAFFIC.riderLengthM;
      if (obstacle === 'vehicle') {
        // Move the rider out of the way; a broken-down car sits in the lane instead.
        const m = world.movers[0];
        if (m) m.pos.d = -1.7;
        placeVehicle(world, config, { type: 1, u: 480, dir: 1, speed: 0 });
        obstacleU = 480;
        obstacleLen = BROKEN.lengthM;
      }
      const car = placeVehicle(world, config, { type: 0, u: 250, dir: 1 });
      const st = trafficState(world);
      let minGap = Infinity;
      const events: SimEvent[] = [];
      for (let t = 0; t < 60 * 40; t++) {
        events.push(...stepWorld(world, config, SCENARIO, [hold(0)]));
        const gap = obstacleU - obstacleLen / 2 - ((st.u[car] ?? 0) + CAR.lengthM / 2);
        minGap = Math.min(minGap, gap);
      }
      const speed = world.movers[st.id[car] ?? -1]?.speed ?? -1;
      console.log(
        `stop behind a stopped ${obstacle}: final speed ${speed.toFixed(3)} m/s, min gap ${minGap.toFixed(2)} m`,
      );
      expect(minGap).toBeGreaterThan(0.5);
      expect(speed).toBeLessThan(0.05);
      expect(events.filter((e) => e.type === 'crash')).toEqual([]);
      expect(st.contactWith[0]).toBe(-1);
    }
  });

  it('no vehicle ever spawns inside reaction range of a sim anchor', () => {
    expect(spawnAllowed([0], REACTION_M - 0.01, REACTION_M)).toBe(false);
    expect(spawnAllowed([0, 900], REACTION_M + 0.01, REACTION_M)).toBe(true);
    expect(spawnAllowed([0, 200], 100, REACTION_M)).toBe(false);
    let spawns = 0;
    let minDist = Infinity;
    for (const seed of [1, 2, 3, 4]) {
      const config = makeConfig({ seed, tuning: { 'traffic.densitySame': 2, 'traffic.densityOncoming': 2 } });
      const world = raceWorld(config);
      const st = trafficState(world);
      expect(st.reactionM).toBeCloseTo(REACTION_M, 9);
      const check = (tick: number) => {
        const a = anchors(world, config);
        for (let k = 0; k < st.id.length; k++) {
          if (st.spawnTick[k] !== tick) continue;
          spawns++;
          const d = Math.min(...a.map((x) => Math.abs(x - (st.spawnU[k] ?? 0))));
          minDist = Math.min(minDist, d);
          // Contacts after the spawn can shove an anchor up to ~2 m in the same tick.
          expect(d, `seed ${seed} tick ${tick} slot ${k}`).toBeGreaterThanOrEqual(REACTION_M - 2.5);
        }
      };
      check(0);
      while (world.tick < 60 * 100) {
        const tick = world.tick;
        // Swing the sliders mid-race, as the tuning panel would.
        if (tick === 1800) world.pendingParams.push({ id: 'traffic.densityOncoming', value: 0.3 });
        if (tick === 3600) world.pendingParams.push({ id: 'traffic.densityOncoming', value: 3 });
        stepWorld(world, config, ALL, [scripted(tick)]);
        check(tick);
      }
    }
    console.log(
      `fairness: ${spawns} spawns checked over 4 seeded 100 s races, nearest spawn ${minDist.toFixed(1)} m from an anchor (rule ${REACTION_M.toFixed(1)} m)`,
    );
    expect(spawns).toBeGreaterThan(50);
  }, 120_000);

  it('no vehicle ever enters a shortcut edge, nor waits at the end of the traffic road', () => {
    // The third road carries a shortcut lane, so traffic lives on the first two only; riders ride on.
    const config = makeConfig({
      edges: [...EDGES, { id: 'd', lengthM: 300, kappa: 0 }],
      lanes: { c: WITH_SHORTCUT },
    });
    const world = raceWorld(config);
    const st = trafficState(world);
    const endU = st.corridor.hi; // the finish is off the traffic road here, so this is its end
    const route = config.route;
    let vehicleTicks = 0;
    let onShortcut = 0;
    let waitingAtEnd = 0;
    let spawnChecks = 0;
    const tooClose: string[] = [];
    while (world.tick < 60 * 90) {
      const tick = world.tick;
      stepWorld(world, config, ALL, [scripted(tick)]);
      for (const m of world.movers) {
        if (m.kind === 'vehicle') {
          vehicleTicks++;
          expect(m.pos.edge).not.toBe(2);
        } else if (m.pos.edge === 2) {
          onShortcut++;
        }
      }
      for (let k = 0; k < st.id.length; k++) {
        // Driving through the last metre is fine; standing there is a wall.
        const atEnd = Math.abs((st.u[k] ?? 0) - (st.dir[k] === 1 ? endU : 0)) < 5;
        if (atEnd && (world.movers[st.id[k] ?? -1]?.speed ?? 0) < 1) waitingAtEnd++;
        if (st.spawnTick[k] !== tick) continue;
        // Fairness measured along the route, so riders past the junction (off the traffic road) count.
        const v = world.movers[st.id[k] ?? -1];
        if (!v) continue;
        const vDtf = route.distanceToFinish(v.pos.edge, v.pos.s);
        for (const r of world.movers) {
          const role = config.riders[r.riderIndex]?.role;
          if (r.kind !== 'rider' || (role !== 'player' && role !== 'rival')) continue;
          spawnChecks++;
          const gap = Math.abs(route.distanceToFinish(r.pos.edge, r.pos.s) - vDtf);
          // The vehicle has already moved one tick since it spawned (under 0.5 m).
          if (gap < REACTION_M - 3) tooClose.push(`tick ${tick} slot ${k}: ${gap.toFixed(1)} m`);
        }
      }
    }
    console.log(
      `shortcut run: ${vehicleTicks} vehicle-ticks, riders past the traffic road's end for ${onShortcut} rider-ticks, ` +
        `${st.spawns} spawns, ${st.parks} parked off the end, ${waitingAtEnd} vehicle-ticks at the end, ` +
        `${spawnChecks} spawn-to-anchor checks`,
    );
    expect(vehicleTicks).toBeGreaterThan(1000);
    expect(onShortcut).toBeGreaterThan(600);
    expect(st.parks).toBeGreaterThan(0);
    expect(waitingAtEnd).toBe(0);
    expect(tooClose.slice(0, 3)).toEqual([]);
  }, 60_000);

  it('traffic ends at the finish line: no queue behind riders parked past it walls off the line', () => {
    // A finished rival has rolled to a stop at the road's end, 5 m past the line's 20 m run-out.
    // Four cars head that way ahead of the player, who still has to cross the line.
    const riders = [rider('rival', 0), rider('player', 1)];
    // Straight roads, so the player can hold its lane with no steering at all.
    const straight = EDGES.map((e) => ({ ...e, kappa: 0 }));
    const config = makeConfig({ edges: straight, riders, tuning: NO_TRAFFIC });
    const world = scenarioWorld(config, [
      { pos: { edge: 2, s: 595, d: 1.7, dir: 1 }, speed: 0 },
      { pos: { edge: 2, s: 60, d: 1.7, dir: 1 }, speed: 30 },
    ]);
    const st = trafficState(world);
    for (const u of [1560, 1590, 1620, 1650]) placeVehicle(world, config, { type: 0, u, dir: 1, v0: 20 });
    let playerBest = 0;
    let pastLine = 0;
    for (let t = 0; t < 60 * 40; t++) {
      stepWorld(world, config, SCENARIO, [hold(255)]);
      playerBest = Math.max(playerBest, uOf(world, 1));
      for (let k = 0; k < st.id.length; k++) if ((st.u[k] ?? 0) > st.corridor.hi + 1e-9) pastLine++;
    }
    console.log(
      `finish run: player reached u ${playerBest.toFixed(1)} (line at ${st.corridor.hi}), ` +
        `${st.parks} parked and ${st.retired.filter((r) => r === 1).length} retired at the line, ${pastLine} vehicle-ticks past it`,
    );
    expect(pastLine).toBe(0);
    expect(playerBest).toBeGreaterThan(st.corridor.hi);
    expect(st.retired.every((r) => r === 1)).toBe(true); // both sliders at zero: none come back
  }, 30_000);

  it('a scripted close pass fires nearMiss; a wide pass does not', () => {
    const results: Record<string, SimEvent[]> = {};
    for (const [name, d] of [
      ['close', 0.25],
      ['wide', 1.7],
    ] as const) {
      const config = makeConfig({ riders: SOLO, tuning: NO_TRAFFIC });
      const world = scenarioWorld(config, [{ pos: { edge: 0, s: 100, d, dir: 1 }, speed: 30 }]);
      const slot = placeVehicle(world, config, { type: 0, u: 400, dir: -1 });
      const events: SimEvent[] = [];
      for (let t = 0; t < 60 * 8; t++) events.push(...stepWorld(world, config, SCENARIO, [hold(200)]));
      results[name] = events.filter((e) => e.type === 'nearMiss');
      if (name === 'close') {
        const e = results[name][0];
        expect(results[name]).toHaveLength(1);
        expect(e?.actor).toBe(0);
        expect(e?.target).toBe(trafficState(world).id[slot]);
        expect(e?.data['oncoming']).toBe(true);
        expect(e?.data['clearanceM']).toBeCloseTo(1.95 - (CAR.widthM + TRAFFIC.riderWidthM) / 2, 1);
      }
      expect(events.filter((e) => e.type === 'crash')).toEqual([]);
    }
    expect(results['wide']).toEqual([]);
  });

  it('a first side brush wobbles, a second while unstable crashes, and a truck always crashes', () => {
    // Ride alongside a car and lean into it: a wobble, no crash, speed scrubbed.
    const config = makeConfig({ riders: SOLO, types: [CAR, TRUCK], tuning: NO_TRAFFIC });
    const world = scenarioWorld(config, [{ pos: { edge: 0, s: 100, d: 0.3, dir: 1 }, speed: 20 }]);
    placeVehicle(world, config, { type: 0, u: 101, dir: 1, v0: 20, speed: 20 });
    const st = trafficState(world);
    const events: SimEvent[] = [];
    let t = 0;
    let before = 0;
    while (st.contactWith[0] === -1 && t++ < 600) {
      before = world.movers[0]?.speed ?? 0;
      events.push(...stepWorld(world, config, SCENARIO, [{ steer: 40, throttle: 150, brake: 0, flags: 0 }]));
    }
    expect(st.contactWith[0]).not.toBe(-1);
    expect(events.filter((e) => e.type === 'crash')).toEqual([]);
    const wobbles = events.filter((e) => e.type === 'wobble');
    expect(wobbles).toHaveLength(1);
    expect(wobbles[0]?.data['cause']).toBe('traffic');
    expect(wobbles[0]?.data['hit']).toBe('side');
    expect(wobbles[0]?.target).toBe(st.id[0]);
    expect(st.unstableS[0]).toBeGreaterThan(1);
    // Speed lost (the scrub), and nothing thrown back: the rider sits just clear of the car's side.
    expect(world.movers[0]?.speed ?? 99).toBeLessThan(before * TRAFFIC.wobbleScrub + 0.2);
    const side =
      Math.abs((st.cd[0] ?? 0) - (world.movers[0]?.pos.d ?? 0)) - (CAR.widthM + TRAFFIC.riderWidthM) / 2;
    expect(side).toBeGreaterThanOrEqual(0);
    expect(side).toBeLessThan(0.1);
    // Still unstable: pull clear for a moment, then brush the car again and crash.
    const again: SimEvent[] = [];
    const rider0 = world.movers[0];
    if (rider0) rider0.pos.d -= 0.6;
    again.push(...stepWorld(world, config, SCENARIO, [hold(150)]));
    expect(st.contactWith[0]).toBe(-1);
    if (rider0) rider0.pos.d = (st.cd[0] ?? 0) - (CAR.widthM + TRAFFIC.riderWidthM) / 2 + 0.3;
    again.push(...stepWorld(world, config, SCENARIO, [hold(150)]));
    const crash = again.find((e) => e.type === 'crash');
    expect(crash?.data['cause']).toBe('traffic');
    expect(crash?.data['hazard']).toBe('normal');

    // A truck crashes you on the first touch, even a side brush.
    const w2 = scenarioWorld(config, [{ pos: { edge: 0, s: 100, d: 0.1, dir: 1 }, speed: 20 }]);
    const truck = placeVehicle(w2, config, { type: 1, u: 101, dir: 1, v0: 20, speed: 20 });
    const e2: SimEvent[] = [];
    for (let i = 0; i < 600 && !e2.some((e) => e.type === 'crash'); i++)
      e2.push(...stepWorld(w2, config, SCENARIO, [{ steer: 40, throttle: 150, brake: 0, flags: 0 }]));
    const truckCrash = e2.find((e) => e.type === 'crash');
    expect(truckCrash?.data['hazard']).toBe('big');
    expect(truckCrash?.data['hit']).toBe('side');
    expect(truckCrash?.target).toBe(trafficState(w2).id[truck]);
    expect(vehicleInfo(w2, config, truckCrash?.target ?? -1)?.contentId).toBe('base:truck');
  });

  it('the density sliders: oncoming at zero spawns none, and turning it up mid-race brings them', () => {
    const config = makeConfig({ tuning: { 'traffic.densitySame': 1, 'traffic.densityOncoming': 0 } });
    const world = raceWorld(config);
    const st = trafficState(world);
    const count = (dir: number) => st.dir.filter((d, k) => d === dir && st.retired[k] === 0).length;
    while (world.tick < 60 * 30) stepWorld(world, config, ALL, [scripted(world.tick)]);
    expect(count(-1)).toBe(0);
    expect(count(1)).toBeGreaterThan(0);
    world.pendingParams.push({ id: 'traffic.densityOncoming', value: 1.5 });
    while (world.tick < 60 * 45) stepWorld(world, config, ALL, [scripted(world.tick)]);
    expect(count(-1)).toBeGreaterThan(0);
    // Pedestrian types never spawn as road traffic (traffic-2 owns them).
    expect(st.type.some((t) => config.trafficTypes[t]?.category === 'pedestrian')).toBe(false);
  }, 60_000);

  it('the master density slider (W-P): 0 empties the road both ways, 2 carries more than the default', () => {
    /** The most vehicles live per direction over 30 s of a race at these sliders. */
    const peak = (tuning: Record<string, number>) => {
      const config = makeConfig({ tuning });
      const world = raceWorld(config);
      const st = trafficState(world);
      const most = { plus: 0, minus: 0, cap: capPerDirection(world) };
      while (world.tick < 60 * 30) {
        stepWorld(world, config, ALL, [scripted(world.tick)]);
        const live = (dir: number) => st.dir.filter((d, k) => d === dir && st.retired[k] === 0).length;
        most.plus = Math.max(most.plus, live(1));
        most.minus = Math.max(most.minus, live(-1));
      }
      return most;
    };
    const none = peak({ 'traffic.density': 0 });
    const normal = peak({});
    const busy = peak({ 'traffic.density': 2 });
    const packed = peak({ 'traffic.density': 3 });
    console.log(
      `peak vehicles (your way / oncoming, cap): off ${none.plus}/${none.minus}, ` +
        `default ${normal.plus}/${normal.minus} (${normal.cap}), x2 ${busy.plus}/${busy.minus} (${busy.cap}), ` +
        `x3 ${packed.plus}/${packed.minus} (${packed.cap})`,
    );
    expect([none.plus, none.minus]).toEqual([0, 0]);
    // The default is M1's road, cap and all; the slider raises the cap with the density.
    expect(normal.cap).toBe(TRAFFIC.maxPerDirection);
    expect(busy.cap).toBe(2 * TRAFFIC.maxPerDirection);
    expect(packed.cap).toBe(TRAFFIC.maxPerDirectionHard);
    expect(busy.plus).toBeGreaterThan(normal.plus);
    expect(busy.minus).toBeGreaterThan(normal.minus);
    expect(Math.max(normal.plus, normal.minus)).toBeLessThanOrEqual(normal.cap);
    expect(Math.max(packed.plus, packed.minus)).toBeLessThanOrEqual(TRAFFIC.maxPerDirectionHard);
  }, 120_000);

  it('two lanes a direction: rare seeded lane changes, still no overlap in any lane', () => {
    const config = makeConfig({
      lanes: { a: TWO_LANES, b: TWO_LANES, c: TWO_LANES },
      tuning: { 'traffic.densitySame': 3, 'traffic.densityOncoming': 3 },
    });
    const world = raceWorld(config);
    const st = trafficState(world);
    let changes = 0;
    let ranks = [...st.rank];
    const overlap = { checks: 0, bad: [] as string[] };
    while (world.tick < 60 * 150) {
      stepWorld(world, config, ALL, [scripted(world.tick)]);
      st.rank.forEach((r, k) => {
        if (ranks[k] !== undefined && ranks[k] !== r && st.spawnTick[k] !== world.tick - 1) changes++;
      });
      ranks = [...st.rank];
      laneOverlaps(config, world, overlap);
    }
    console.log(
      `two-lane run: ${changes} lane changes in 150 s with up to ${st.id.length} vehicles, ${overlap.checks} same-lane pair checks`,
    );
    expect(overlap.bad.slice(0, 3)).toEqual([]);
    expect(changes).toBeGreaterThan(0);
  }, 120_000);

  it('a scripted run gives the same hash every run, and the traffic changes it', () => {
    const run = (seed: number, types: readonly SimTrafficTypeDef[]) => {
      const sim = createSim(makeConfig({ seed, types }));
      const hashes: number[] = [];
      for (let t = 0; t < 60 * 60; t++) {
        sim.step([scripted(t)]);
        if (t % 60 === 0) hashes.push(sim.hash());
      }
      const vehicles = sim.snapshot().entities.filter((e) => e.kind === 'vehicle');
      return { hashes, vehicles: vehicles.length, ids: vehicles.map((v) => v.contentId) };
    };
    const a = run(5, TYPES);
    const b = run(5, TYPES);
    expect(a.vehicles).toBeGreaterThan(0);
    // The snapshot names each vehicle's traffic type, so render can draw a truck as a truck.
    expect(new Set(a.ids)).toEqual(new Set([CAR.contentId, TRUCK.contentId]));
    expect(a.hashes).toEqual(b.hashes);
    expect(run(6, TYPES).hashes).not.toEqual(a.hashes);
    expect(run(5, []).hashes).not.toEqual(a.hashes);
  }, 60_000);
});

describe('traffic-3 (M2): near misses, oncoming ease-in, the region mix', () => {
  /** Rides the solo rider past a parked car at a constant speed, 0.5 m clear, and returns its events. */
  const passParked = (speed: number) => {
    const config = makeConfig({ riders: SOLO, types: [CAR, BROKEN], tuning: NO_TRAFFIC });
    // The car's lane centre is d 1.7; the boxes clear by 0.5 m with the rider at d −0.1.
    const world = scenarioWorld(config, [{ pos: { edge: 0, s: 100, d: -0.1, dir: 1 }, speed }]);
    placeVehicle(world, config, { type: 1, u: 130, dir: 1, speed: 0 });
    const events: SimEvent[] = [];
    for (let t = 0; t < 60 * 8; t++) {
      const m = world.movers[0];
      if (m) m.speed = speed;
      events.push(...stepWorld(world, config, SCENARIO, [hold(0)]));
    }
    return { events, near: events.filter((e) => e.type === 'nearMiss'), world };
  };

  it('a slow pass fires no nearMiss, and a fast one fires exactly one', () => {
    // 9 m/s is above M1's 8 m/s rider-speed rule, so the old rule fired here; the closing speed is too low.
    const slow = passParked(9);
    const fast = passParked(30);
    const clearance = fast.near[0]?.data['clearanceM'];
    console.log(
      `near-miss rule: closing speed at least ${TRAFFIC.nearMissClosingMps} m/s and at most ${TRAFFIC.nearMissM} m clear; ` +
        `slow pass (9 m/s past a parked car) ${slow.near.length} nearMiss, fast pass (30 m/s) ${fast.near.length} ` +
        `(clearance ${typeof clearance === 'number' ? clearance.toFixed(2) : '?'} m, closing ${String(fast.near[0]?.data['closingMps'])} m/s)`,
    );
    expect(slow.near).toEqual([]);
    expect(fast.near).toHaveLength(1);
    expect(fast.near[0]?.data['oncoming']).toBe(false);
    expect(fast.near[0]?.data['closingMps']).toBeCloseTo(30, 0);
    expect(clearance).toBeCloseTo(0.5, 1);
    for (const r of [slow, fast])
      expect(r.events.filter((e) => e.type === 'crash' || e.type === 'wobble')).toEqual([]);
  });

  it('the near-miss closing speed is a slider: lowered, the slow pass counts', () => {
    const config = makeConfig({
      riders: SOLO,
      types: [CAR, BROKEN],
      tuning: { ...NO_TRAFFIC, 'traffic.nearMissClosingMps': 8 },
    });
    const world = scenarioWorld(config, [{ pos: { edge: 0, s: 100, d: -0.1, dir: 1 }, speed: 9 }]);
    placeVehicle(world, config, { type: 1, u: 130, dir: 1, speed: 0 });
    const near: SimEvent[] = [];
    for (let t = 0; t < 60 * 8; t++) {
      const m = world.movers[0];
      if (m) m.speed = 9;
      near.push(...stepWorld(world, config, SCENARIO, [hold(0)]).filter((e) => e.type === 'nearMiss'));
    }
    expect(near).toHaveLength(1);
  });

  it('with ease-in on, oncoming density at the start is below its full value, and reaches it', () => {
    const oncoming = (world: World) => {
      const st = trafficState(world);
      return st.dir.filter((d, k) => d !== st.corridor.routeDir && st.retired[k] === 0).length;
    };
    const sameWay = (world: World) => {
      const st = trafficState(world);
      return st.dir.filter((d, k) => d === st.corridor.routeDir && st.retired[k] === 0).length;
    };
    const lines: string[] = [];
    const run = (easeS: number) => {
      const config = makeConfig({ seed: 3, tuning: { 'traffic.oncomingEaseInS': easeS } });
      const world = raceWorld(config);
      const at: Record<string, number> = { start: oncoming(world), sameStart: sameWay(world) };
      while (world.tick < 60 * 90) {
        stepWorld(world, config, ALL, [scripted(world.tick)]);
        if (world.tick === 60 * 10) at['10s'] = oncoming(world);
        if (world.tick === 60 * 90) {
          at['90s'] = oncoming(world);
          at['ease90'] = oncomingEase(world, trafficState(world).clockS);
        }
      }
      lines.push(
        `ease-in ${easeS} s: oncoming ${at['start']} at the start, ${at['10s']} at 10 s, ${at['90s']} at 90 s (same way ${at['sameStart']} at the start)`,
      );
      return at;
    };
    const off = run(0);
    const on = run(60);
    console.log(`oncoming ease-in (from ${TRAFFIC.oncomingEaseFrom} of full density): ${lines.join('; ')}`);
    expect(on['start'] ?? 99).toBeLessThan(off['start'] ?? 0);
    expect(on['10s'] ?? 99).toBeLessThan(off['10s'] ?? 0);
    // Once the ease-in is over, oncoming traffic is at its full density; your-way traffic never
    // eases. (The vehicle count at one instant is not compared: on one seed it is luck. With the
    // playtest 1c launch it was 4 off against 9 on at 90 s, and with the old launch seed 4 gave 9
    // against 5, while the density factor was full in both.)
    expect(on['ease90']).toBe(1);
    expect(off['ease90']).toBe(1);
    expect(on['sameStart']).toBe(off['sameStart']);
  }, 120_000);

  it('the region mix picks the vehicles: weight 0 never spawns, and no weight means the category default', () => {
    const spawned = (types: readonly SimTrafficTypeDef[]) => {
      const config = makeConfig({
        seed: 4,
        types,
        tuning: { 'traffic.densitySame': 2, 'traffic.densityOncoming': 2 },
      });
      const world = raceWorld(config);
      const seen = new Map<string, number>();
      const st = trafficState(world);
      while (world.tick < 60 * 40) {
        stepWorld(world, config, ALL, [scripted(world.tick)]);
        for (let k = 0; k < st.id.length; k++) {
          if (st.spawnTick[k] !== world.tick - 1) continue;
          const id = config.trafficTypes[st.type[k] ?? -1]?.contentId ?? '?';
          seen.set(id, (seen.get(id) ?? 0) + 1);
        }
      }
      return seen;
    };
    const trucksOnly = spawned([{ ...CAR, weight: 0 }, { ...TRUCK, weight: 1 }, PED]);
    const defaults = spawned(TYPES);
    const carHeavy = spawned([{ ...CAR, weight: 1 }, { ...TRUCK, weight: 0.05 }, PED]);
    const fmt = (m: Map<string, number>) => [...m].map(([k, v]) => `${k} ${v}`).join(', ');
    console.log(
      `region mix: trucks only {${fmt(trucksOnly)}}; defaults {${fmt(defaults)}}; car-heavy {${fmt(carHeavy)}}`,
    );
    expect(trucksOnly.get(CAR.contentId) ?? 0).toBe(0);
    expect(trucksOnly.get(TRUCK.contentId) ?? 0).toBeGreaterThan(0);
    expect(defaults.get(CAR.contentId) ?? 0).toBeGreaterThan(0);
    expect(defaults.get(TRUCK.contentId) ?? 0).toBeGreaterThan(0);
    expect(carHeavy.get(CAR.contentId) ?? 0).toBeGreaterThan(5 * (carHeavy.get(TRUCK.contentId) ?? 0));
  }, 120_000);
});

describe('traffic contacts, playtest 1: head-on is a wipeout, a graze is a wobble, no rebound', () => {
  const run = (o: {
    rider: { d: number; speed: number };
    vehicle: { u: number; dir: 1 | -1; speed: number; d?: number };
    tuning?: Record<string, number>;
    throttle?: number;
  }) => {
    const config = makeConfig({
      riders: SOLO,
      types: [CAR, TRUCK],
      tuning: { ...NO_TRAFFIC, ...(o.tuning ?? {}) },
    });
    const world = scenarioWorld(config, [
      { pos: { edge: 0, s: 100, d: o.rider.d, dir: 1 }, speed: o.rider.speed },
    ]);
    const slot = placeVehicle(world, config, {
      type: 0,
      u: o.vehicle.u,
      dir: o.vehicle.dir,
      v0: o.vehicle.speed,
      speed: o.vehicle.speed,
    });
    const st = trafficState(world);
    if (o.vehicle.d !== undefined) st.cd[slot] = o.vehicle.d;
    const events: SimEvent[] = [];
    let t = 0;
    while (st.contactWith[0] === -1 && t++ < 600)
      events.push(...stepWorld(world, config, SCENARIO, [hold(o.throttle ?? 255)]));
    const m = world.movers[0];
    const along = Math.abs((st.u[slot] ?? 0) - uOf(world, 0)) - (CAR.lengthM + TRAFFIC.riderLengthM) / 2;
    return {
      events,
      crash: events.find((e) => e.type === 'crash'),
      wobble: events.find((e) => e.type === 'wobble'),
      speed: m?.speed ?? -1,
      carSpeed: world.movers[st.id[slot] ?? -1]?.speed ?? -1,
      along,
    };
  };

  it('rear-ending a car at speed throws you off, at the car speed, with no bounce back', () => {
    const r = run({ rider: { d: 1.7, speed: 36 }, vehicle: { u: 160, dir: 1, speed: 15 } });
    console.log(
      `rear-end at 36 m/s into a 15 m/s car: ${r.crash ? 'crash' : 'no crash'} (hit ${String(r.crash?.data['hit'])}, ` +
        `impact ${Number(r.crash?.data['impactMps']).toFixed(1)} m/s), rider left at ${r.speed.toFixed(2)} m/s, ` +
        `${r.along.toFixed(3)} m behind the car's tail`,
    );
    expect(r.wobble).toBeUndefined();
    expect(r.crash?.data['cause']).toBe('traffic');
    expect(r.crash?.data['hit']).toBe('frontal');
    expect(r.crash?.data['contact']).toBe('crash');
    expect(Number(r.crash?.data['impactMps'])).toBeGreaterThan(15);
    // Inelastic: the rider ends at the car's speed along the road, never faster, never thrown back.
    expect(r.speed).toBeCloseTo(r.carSpeed, 6);
    expect(r.along).toBeGreaterThanOrEqual(0);
    expect(r.along).toBeLessThan(0.1);
  });

  it('a head-on with an oncoming car throws you off, stopped dead, even when stable', () => {
    const r = run({ rider: { d: -1.7, speed: 30 }, vehicle: { u: 180, dir: -1, speed: 24.6 } });
    expect(r.wobble).toBeUndefined();
    expect(r.crash?.data['hit']).toBe('frontal');
    expect(Number(r.crash?.data['impactMps'])).toBeGreaterThan(50);
    expect(r.speed).toBe(0);
    expect(r.along).toBeGreaterThanOrEqual(0);
    expect(r.along).toBeLessThan(0.1);
  });

  it('a slow nudge into a tail is a wobble, not a wipeout', () => {
    // Coasting at 18 m/s into a 15 m/s car's tail 3 m ahead: a closing speed of about 3 m/s.
    const r = run({ rider: { d: 1.7, speed: 18 }, vehicle: { u: 106.3, dir: 1, speed: 15 }, throttle: 0 });
    expect(Number(r.wobble?.data['impactMps'])).toBeLessThan(TRAFFIC.solidHitMps);
    expect(r.crash).toBeUndefined();
    expect(r.wobble?.data['hit']).toBe('frontal');
    expect(r.speed).toBeLessThanOrEqual(r.carSpeed + 1e-9);
  });

  it('the solid-hit speed is a slider: raised, the rear-end is a wobble', () => {
    const r = run({
      rider: { d: 1.7, speed: 36 },
      vehicle: { u: 160, dir: 1, speed: 15 },
      tuning: { 'traffic.solidHitMps': 30 },
    });
    expect(r.crash).toBeUndefined();
    expect(r.wobble).toBeDefined();
  });

  it('clipping a car corner end-on is a graze: a wobble, not a wipeout', () => {
    // Lateral overlap 0.15 m, under the graze width.
    const graze = (CAR.widthM + TRAFFIC.riderWidthM) / 2 - 0.15;
    const r = run({ rider: { d: 1.7 - graze, speed: 36 }, vehicle: { u: 160, dir: 1, speed: 15 } });
    expect(r.crash).toBeUndefined();
    expect(r.wobble?.data['hit']).toBe('graze');
  });
});
