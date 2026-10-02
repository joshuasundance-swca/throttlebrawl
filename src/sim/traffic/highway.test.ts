// Multi-lane highways (W-R; interview, 2026-10-02, round 3: "multi-lane highways (4-6 lanes, lane
// splitting)"). Traffic on a road with two or three lanes each way: as many cars per lane as a
// two-lane road has, every lane used, a lane that ends is merged out of in time (never two cars in
// one place, never a car stuck at the end of its lane), and threading between two cars side by
// side is a lane split: each near miss of the pair carries `split`.
import { describe, expect, it } from 'vitest';
import { tuningDefaults } from '../../core';
import {
  createRoadNetwork,
  createRouteProgress,
  fixtureNetwork,
  highwayLanes,
  type FixtureEdgeSpec,
} from '../../road';
import { aiSystem } from '../ai';
import { combatSystem } from '../combat';
import { copsSystem } from '../cops';
import { SIM_TUNING } from '../create';
import { modifiersSystem } from '../modifiers';
import { pedsSystem } from '../peds';
import { gridPosition, raceSystem } from '../race';
import { ridersSystem } from '../riders';
import { tumbleSystem } from '../tumble';
import type { SimConfig, SimEvent, SimInput, SimRiderDef, SimTrafficTypeDef } from '../types';
import { addMover, createWorld, orderSystems, stepWorld, type SimSystem, type World } from '../world';
import { toCorridor } from './corridor';
import { laneEndAhead, placeVehicle, TRAFFIC, trafficState, trafficSystem } from './index';

const CAR: SimTrafficTypeDef = {
  contentId: 'base:car',
  category: 'car',
  lengthM: 4.6,
  widthM: 1.8,
  cruiseMps: 24.6,
  hazard: 'normal',
};
/** A car that keeps its lane, so a scripted pass is exactly the one set up. */
const STEADY: SimTrafficTypeDef = { ...CAR, contentId: 'base:steady', behaviour: { laneChanges: false } };

/** 3.4 m lanes, so the highway's inner lanes are exactly a two-lane fixture road's. */
const HIGHWAY3 = highwayLanes(3, 3.4);
const HIGHWAY2 = highwayLanes(2, 3.4);

const bike = {
  contentId: 'base:bike',
  topSpeedMps: 38,
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
    faction: 'rider',
    controller: role === 'player' ? { kind: 'player', slot: 0 } : { kind: 'ai', style: 'racer' },
    bike,
    massKg: 85,
    healthMax: 100,
  };
}

function makeConfig(
  edges: readonly FixtureEdgeSpec[],
  o: { types?: readonly SimTrafficTypeDef[]; tuning?: Record<string, number>; riders?: SimRiderDef[] } = {},
): SimConfig {
  const road = createRoadNetwork(fixtureNetwork(edges));
  const ids = edges.map((e) => e.id);
  const last = edges[edges.length - 1];
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: ids[0] ?? 'a', s: 20, dir: 1 },
    finish: { road: last?.id ?? 'a', s: (last?.lengthM ?? 0) - 20 },
    mainPath: ids,
    allowedRoads: ids,
    closed: false,
  });
  return {
    seed: 7,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 31,
      byPlaceCash: [100],
      raceEndTimeoutTicks: 1800,
    },
    riders: o.riders ?? [rider('rival', 0), rider('player', 1)],
    weapons: [],
    trafficTypes: o.types ?? [CAR],
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

function raceWorld(config: SimConfig): World {
  const world = createWorld(config);
  config.riders.forEach((_d, i) => addMover(world, 'rider', gridPosition(config, i), i));
  for (const s of ALL) s.init(world, config);
  return world;
}

const hold = (throttle: number, steer = 0): SimInput => ({ steer, throttle, brake: 0, flags: 0 });

/** Records any two same-lane, same-way vehicles whose boxes overlap along the road. */
function overlaps(config: SimConfig, world: World, bad: string[]): number {
  const st = trafficState(world);
  let checks = 0;
  for (let a = 0; a < st.id.length; a++) {
    for (let b = a + 1; b < st.id.length; b++) {
      if (st.dir[a] !== st.dir[b] || st.rank[a] !== st.rank[b]) continue;
      checks++;
      const la = config.trafficTypes[st.type[a] ?? 0]?.lengthM ?? 0;
      const lb = config.trafficTypes[st.type[b] ?? 0]?.lengthM ?? 0;
      const dist = Math.abs((st.u[a] ?? 0) - (st.u[b] ?? 0));
      if (dist < (la + lb) / 2) bad.push(`tick ${world.tick} slots ${a}/${b}: ${dist.toFixed(2)} m apart`);
    }
  }
  return checks;
}

describe('multi-lane highways: traffic (interview, 2026-10-02)', () => {
  const TWO_LANE: FixtureEdgeSpec[] = [{ id: 'a', lengthM: 3000, kappa: 0 }];
  const SIX_LANE: FixtureEdgeSpec[] = [{ id: 'a', lengthM: 3000, kappa: 0, lanes: HIGHWAY3 }];

  it('a highway carries as many cars per lane as a two-lane road, in every lane', () => {
    const count = (edges: FixtureEdgeSpec[]) => {
      const config = makeConfig(edges);
      const world = raceWorld(config);
      const st = trafficState(world);
      const perDir = { plus: 0, minus: 0 };
      const ranks = new Set<string>();
      for (let k = 0; k < st.id.length; k++) {
        if (st.retired[k] !== 0) continue;
        if (st.dir[k] === 1) perDir.plus++;
        else perDir.minus++;
        ranks.add(`${st.dir[k]}:${st.rank[k]}`);
      }
      return { ...perDir, ranks: ranks.size };
    };
    const two = count(TWO_LANE);
    const six = count(SIX_LANE);
    console.log(
      `cars per direction at the start: two-lane ${JSON.stringify(two)}, six-lane ${JSON.stringify(six)}`,
    );
    expect(two.plus).toBeGreaterThan(0);
    expect(six.plus).toBeGreaterThanOrEqual(2.5 * two.plus);
    expect(six.minus).toBeGreaterThanOrEqual(2.5 * two.minus);
    expect(six.ranks).toBe(6);
    expect(six.plus).toBeLessThanOrEqual(TRAFFIC.maxPerDirectionHard);
  });

  it('a race on a highway keeps every lane clear of overlaps and is deterministic', () => {
    const run = () => {
      const config = makeConfig(SIX_LANE);
      const world = raceWorld(config);
      const bad: string[] = [];
      let checks = 0;
      for (let t = 0; t < 30 * 60; t++) {
        stepWorld(world, config, ALL, [hold(255, Math.round(Math.sin(t / 90) * 20))]);
        checks += overlaps(config, world, bad);
      }
      return { bad, checks, vehicles: trafficState(world).id.length, tick: world.tick };
    };
    const a = run();
    expect(a.checks).toBeGreaterThan(1000);
    expect(a.bad).toEqual([]);
    expect(run()).toEqual(a);
  });

  it('cars in a lane that ends merge out of it in time: no overlaps, nobody stuck at the end', () => {
    // A 600 m highway (three lanes each way) into a two-lane road: the outer lanes end at u 600.
    const edges: FixtureEdgeSpec[] = [
      { id: 'a', lengthM: 600, kappa: 0, lanes: HIGHWAY3 },
      { id: 'b', lengthM: 1400, kappa: 0 },
    ];
    const config = makeConfig(edges, {
      riders: [rider('player', 0)],
      tuning: { 'traffic.densitySame': 0, 'traffic.densityOncoming': 0 },
    });
    const world = createWorld(config);
    const me = addMover(world, 'rider', { edge: 1, s: 1300, d: 1.7, dir: 1 }, 0);
    me.speed = 0;
    for (const s of [ridersSystem, trafficSystem]) s.init(world, config);
    // Twelve cars spread over all three lanes, 60 to 400 m before the drop.
    for (let i = 0; i < 12; i++) {
      placeVehicle(world, config, { type: 0, u: 200 + 30 * i, dir: 1, rank: i % 3 });
    }
    const st = trafficState(world);
    expect(laneEndAhead(st, 300, 1, 2, 400)).toBeCloseTo(300, 6);
    expect(laneEndAhead(st, 300, 1, 0, 400)).toBe(Infinity);
    const bad: string[] = [];
    const past: boolean[] = [];
    for (let t = 0; t < 60 * 60; t++) {
      const before = st.u.map((u, k) => ({ u: u ?? 0, rank: st.rank[k] ?? 0 }));
      stepWorld(world, config, [ridersSystem, trafficSystem], [hold(0)]);
      overlaps(config, world, bad);
      for (let k = 0; k < st.id.length; k++) {
        const was = before[k];
        if (!was) continue;
        // Never shoved back along the road (a car that could not merge would be).
        if ((st.u[k] ?? 0) < was.u - 1e-9) bad.push(`tick ${world.tick} slot ${k} moved back`);
        if ((st.u[k] ?? 0) > 600 && was.u <= 600) {
          past[k] = true;
          // It crosses the drop already merged: in the one lane its way, on the narrow road's lane.
          if (was.rank !== 0 || Math.abs((st.cd[k] ?? 0) - 1.7) > 0.6) {
            bad.push(`slot ${k} crossed the drop in rank ${was.rank} at cd ${(st.cd[k] ?? 0).toFixed(2)}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
    expect(past.filter(Boolean)).toHaveLength(12);
  });

  it('a kerb rider moves in to the narrower kerb before its lane ends', () => {
    const EBIKE: SimTrafficTypeDef = {
      contentId: 'base:e-bike',
      category: 'car',
      lengthM: 1.8,
      widthM: 0.7,
      cruiseMps: 8.5,
      hazard: 'normal',
      behaviour: { kerb: true },
    };
    const edges: FixtureEdgeSpec[] = [
      { id: 'a', lengthM: 600, kappa: 0, lanes: HIGHWAY3 },
      { id: 'b', lengthM: 1400, kappa: 0 },
    ];
    const config = makeConfig(edges, {
      riders: [rider('player', 0)],
      types: [EBIKE],
      tuning: { 'traffic.densitySame': 0, 'traffic.densityOncoming': 0 },
    });
    const world = createWorld(config);
    addMover(world, 'rider', { edge: 1, s: 900, d: 1.7, dir: 1 }, 0);
    for (const s of [ridersSystem, trafficSystem]) s.init(world, config);
    placeVehicle(world, config, { type: 0, u: 300, dir: 1 });
    const st = trafficState(world);
    // On the highway's shoulder (the kerb, d 11.0) to start with.
    expect(st.cd[0] ?? 0).toBeGreaterThan(10);
    let crossedAt = NaN;
    for (let t = 0; t < 60 * 60 && Number.isNaN(crossedAt); t++) {
      stepWorld(world, config, [ridersSystem, trafficSystem], [hold(0)]);
      if ((st.u[0] ?? 0) > 600) crossedAt = st.cd[0] ?? NaN;
    }
    // The two-lane road's kerb: its shoulder, 3.4 to 4.9 m out.
    expect(crossedAt).toBeGreaterThan(3.4);
    expect(crossedAt).toBeLessThan(4.9);
  });

  it('spawns never put a car in a lane that ends soon', () => {
    const edges: FixtureEdgeSpec[] = [
      { id: 'a', lengthM: 1200, kappa: 0, lanes: HIGHWAY3 },
      { id: 'b', lengthM: 1800, kappa: 0 },
    ];
    const config = makeConfig(edges, { tuning: { 'traffic.density': 3 } });
    const world = raceWorld(config);
    const st = trafficState(world);
    let looked = 0;
    for (let t = 0; t < 20 * 60; t++) {
      stepWorld(world, config, ALL, [hold(255)]);
      for (let k = 0; k < st.id.length; k++) {
        if (st.spawnTick[k] !== world.tick - 1) continue;
        looked++;
        expect(laneEndAhead(st, st.u[k] ?? 0, st.dir[k] ?? 1, st.rank[k] ?? 0, TRAFFIC.mergeLookM)).toBe(
          Infinity,
        );
      }
    }
    expect(looked).toBeGreaterThan(0);
  });
});

describe('lane splitting (interview, 2026-10-02)', () => {
  const EDGES: FixtureEdgeSpec[] = [{ id: 'a', lengthM: 3000, kappa: 0, lanes: HIGHWAY2 }];

  /** A player at riding speed behind two cars side by side (or one), threading at d = `d`. */
  function pass(cars: { cd: number; rank: number }[], d: number) {
    const config = makeConfig(EDGES, {
      riders: [rider('player', 0)],
      types: [STEADY],
      tuning: { 'traffic.densitySame': 0, 'traffic.densityOncoming': 0 },
    });
    const world = createWorld(config);
    const me = addMover(world, 'rider', { edge: 0, s: 500, d, dir: 1 }, 0);
    me.speed = 34;
    for (const s of [ridersSystem, trafficSystem]) s.init(world, config);
    for (const c of cars)
      placeVehicle(world, config, { type: 0, u: 540, dir: 1, rank: c.rank, speed: 18, v0: 18 });
    const misses: SimEvent[] = [];
    const contacts: string[] = [];
    for (let t = 0; t < 3 * 60; t++) {
      const out = stepWorld(world, config, [ridersSystem, trafficSystem], [hold(255)]);
      for (const e of out) {
        if (e.type === 'nearMiss') misses.push(e);
        if (e.type === 'crash' || e.type === 'wobble') contacts.push(e.type);
      }
    }
    const p = toCorridor(trafficState(world).corridor, me.pos);
    return { misses, contacts, ahead: (p?.u ?? 0) > 560 };
  }

  it('threading between two cars side by side is a split near miss for each', () => {
    // Lanes R1 (d 1.7) and R2 (d 5.1), 3.4 m wide: 1.6 m between two 1.8 m cars; ride the line at 3.4.
    const r = pass(
      [
        { cd: 1.7, rank: 0 },
        { cd: 5.1, rank: 1 },
      ],
      3.4,
    );
    expect(r.contacts).toEqual([]);
    expect(r.ahead).toBe(true);
    expect(r.misses).toHaveLength(2);
    for (const e of r.misses) expect(e.data['split']).toBe(true);
  });

  it('passing one car close by is a near miss, not a split', () => {
    const r = pass([{ cd: 1.7, rank: 0 }], 3.4);
    expect(r.misses).toHaveLength(1);
    expect(r.misses[0]?.data['split']).toBeUndefined();
  });
});
