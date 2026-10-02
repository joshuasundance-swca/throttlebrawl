// W-P "fill the world" (maintainer, 2026-10-01b: "more cars both ways, pedestrians, cyclists"):
// the traffic behaviour flags that make each region's traffic its own.
//   - `kerb`: a bicycle, e-bike, scooter or golf cart rides at the kerb (the shoulder where it is
//     wide enough, else the outer edge of the lane), and cars pass it without queuing or touching;
//   - `weaveM`: an e-scooter weaves side to side, inside the road;
//   - `convoy`: an RV convoy spawns nose to tail, every member under the fairness rule;
//   - `laneChanges`: a type's own flag beats its category default (a robotaxi never changes lanes);
//   - all of it seeded: the same seed replays to the same hashes.
import { describe, expect, it } from 'vitest';
import { tuningDefaults, type LaneInfo } from '../../core';
import {
  createRoadNetwork,
  createRouteProgress,
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
import type { SimConfig, SimInput, SimRiderDef, SimTrafficTypeDef } from '../types';
import { addMover, createWorld, orderSystems, stepWorld, type SimSystem, type World } from '../world';
import { toCorridor } from './corridor';
import { isKerb, kerbCd, placeVehicle, TRAFFIC, trafficState, trafficSystem } from './index';

// ---- fixtures ----------------------------------------------------------------------------

const CAR: SimTrafficTypeDef = {
  contentId: 'base:car',
  category: 'car',
  lengthM: 4.6,
  widthM: 1.8,
  cruiseMps: 24.6,
  hazard: 'normal',
};
const EBIKE: SimTrafficTypeDef = {
  contentId: 'sf:delivery-e-bike',
  category: 'car',
  lengthM: 1.8,
  widthM: 0.7,
  cruiseMps: 7,
  hazard: 'normal',
  behaviour: { kerb: true },
};
const SCOOTER: SimTrafficTypeDef = {
  ...EBIKE,
  contentId: 'sf:e-scooter',
  lengthM: 1.1,
  widthM: 0.5,
  cruiseMps: 6,
  behaviour: { kerb: true, weaveM: 0.4 },
};
const GOLF_CART: SimTrafficTypeDef = {
  ...EBIKE,
  contentId: 'base:golf-cart',
  lengthM: 2.4,
  widthM: 1.2,
  cruiseMps: 7,
  behaviour: { kerb: true },
};
const RV: SimTrafficTypeDef = {
  contentId: 'pnw:rv',
  category: 'rv',
  lengthM: 9,
  widthM: 2.5,
  cruiseMps: 21,
  hazard: 'big',
  behaviour: { convoy: 3 },
};
const ROBOTAXI: SimTrafficTypeDef = {
  ...CAR,
  contentId: 'sf:robotaxi',
  behaviour: { laneChanges: false },
};
const BIKE_TOP = 38;

/** One lane each way, 4 m wide, and no shoulders: kerb riders ride the lane's outer edge. */
const NO_SHOULDER: readonly LaneInfo[] = [
  { id: 'L1', dCenterM: -2, widthM: 4, direction: -1, kind: 'drive' },
  { id: 'R1', dCenterM: 2, widthM: 4, direction: 1, kind: 'drive' },
];
/** One 3.4 m lane each way, no shoulders: too narrow for a car to pass a bike without edging out. */
const NARROW: readonly LaneInfo[] = [
  { id: 'L1', dCenterM: -1.7, widthM: 3.4, direction: -1, kind: 'drive' },
  { id: 'R1', dCenterM: 1.7, widthM: 3.4, direction: 1, kind: 'drive' },
];
const TWO_LANES: readonly LaneInfo[] = [
  { id: 'L0', dCenterM: -7.6, widthM: 1.5, direction: -1, kind: 'shoulder' },
  { id: 'L2', dCenterM: -5.1, widthM: 3.4, direction: -1, kind: 'drive' },
  { id: 'L1', dCenterM: -1.7, widthM: 3.4, direction: -1, kind: 'drive' },
  { id: 'R1', dCenterM: 1.7, widthM: 3.4, direction: 1, kind: 'drive' },
  { id: 'R2', dCenterM: 5.1, widthM: 3.4, direction: 1, kind: 'drive' },
  { id: 'R0', dCenterM: 7.6, widthM: 1.5, direction: 1, kind: 'shoulder' },
];
const EDGES: readonly FixtureEdgeSpec[] = [
  { id: 'a', lengthM: 600, kappa: 0 },
  { id: 'b', lengthM: 800, kappa: 1 / 300, grade: 0.02 },
  { id: 'c', lengthM: 600, kappa: -1 / 400 },
];

function bundle(lanes: readonly LaneInfo[] | null): BakedNetworkBundle {
  const b = fixtureNetwork(EDGES);
  return {
    network: b.network,
    roads: b.roads.map((r) => (lanes ? { ...r, laneSections: [{ s0: 0, lanes }] } : r)),
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
const FIELD = [rider('rival', 0), rider('rival', 1), rider('rival', 2), rider('cop', 3), rider('player', 4)];
const SOLO = [rider('player', 0)];

interface Opts {
  lanes?: readonly LaneInfo[] | null;
  riders?: readonly SimRiderDef[];
  types?: readonly SimTrafficTypeDef[];
  tuning?: Record<string, number>;
  seed?: number;
}

function makeConfig(o: Opts = {}): SimConfig {
  const road = createRoadNetwork(bundle(o.lanes ?? null));
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 20, dir: 1 },
    finish: { road: 'c', s: 580 },
    mainPath: ['a', 'b', 'c'],
    allowedRoads: ['a', 'b', 'c'],
    closed: false,
  });
  return {
    seed: o.seed ?? 5,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 31,
      byPlaceCash: [100, 50],
      raceEndTimeoutTicks: 1800,
    },
    riders: o.riders ?? FIELD,
    weapons: [],
    trafficTypes: o.types ?? [CAR, EBIKE, SCOOTER, RV],
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
const scripted = (tick: number): SimInput => ({
  steer: Math.round(Math.sin(tick / 90) * 20),
  throttle: 255,
  brake: 0,
  flags: 0,
});
const NO_TRAFFIC = { 'traffic.densitySame': 0, 'traffic.densityOncoming': 0 };

/** Vehicle boxes (u along the corridor, cd across) that overlap. */
function boxesOverlap(config: SimConfig, world: World, a: number, b: number): boolean {
  const st = trafficState(world);
  const ta = config.trafficTypes[st.type[a] ?? -1];
  const tb = config.trafficTypes[st.type[b] ?? -1];
  if (!ta || !tb || st.dir[a] !== st.dir[b]) return false;
  const du = Math.abs((st.u[a] ?? 0) - (st.u[b] ?? 0));
  const dd = Math.abs((st.cd[a] ?? 0) - (st.cd[b] ?? 0));
  return du < (ta.lengthM + tb.lengthM) / 2 && dd < (ta.widthM + tb.widthM) / 2;
}

/**
 * A slow kerb rider at u 500 heading +1 and a car coming up behind it at u 300, 40 s of traffic
 * with a lone rider waiting far behind. Returns whether the car got past, any touch, and the car's
 * slowest speed while it was behind the kerb rider.
 */
function passKerb(lanes: readonly LaneInfo[] | null, kerbType: SimTrafficTypeDef) {
  const config = makeConfig({ riders: SOLO, types: [CAR, kerbType], tuning: NO_TRAFFIC, lanes });
  const world = scenarioWorld(config, [{ pos: { edge: 0, s: 30, d: -1.7, dir: 1 }, speed: 0 }]);
  const kerb = placeVehicle(world, config, { type: 1, u: 500, dir: 1 });
  const car = placeVehicle(world, config, { type: 0, u: 300, dir: 1 });
  const st = trafficState(world);
  let touched = 0;
  let carSlowest = Infinity;
  const kerbCds: number[] = [];
  for (let t = 0; t < 60 * 40; t++) {
    stepWorld(world, config, SCENARIO, [hold(0)]);
    if (boxesOverlap(config, world, kerb, car)) touched++;
    kerbCds.push(st.cd[kerb] ?? 0);
    if ((st.u[car] ?? 0) < (st.u[kerb] ?? 0))
      carSlowest = Math.min(carSlowest, world.movers[st.id[car] ?? -1]?.speed ?? 0);
  }
  const passed = (st.u[car] ?? 0) > (st.u[kerb] ?? 0) + 20;
  return { config, world, st, kerb, car, touched, carSlowest, passed, kerbCds };
}

// ---- tests -------------------------------------------------------------------------------

describe('W-P kerb riders: bicycles, e-bikes, scooters and golf carts', () => {
  it('isKerb: only a road vehicle flagged kerb, never a parked one', () => {
    expect(isKerb(EBIKE)).toBe(true);
    expect(isKerb(CAR)).toBe(false);
    expect(isKerb({ ...EBIKE, category: 'oddity', cruiseMps: 0 })).toBe(false);
    expect(isKerb(undefined)).toBe(false);
  });

  it('rides the middle of the shoulder where it fits, else just inside the outer lane edge', () => {
    // The fixture road: a 1.5 m shoulder outside each 3.4 m lane (shoulder centre at d 4.15).
    const withShoulder = passKerb(null, EBIKE);
    expect(withShoulder.st.cd[withShoulder.kerb]).toBeCloseTo(4.15, 6);
    // A golf cart (1.2 m, plus the 0.2 m spare) fits that shoulder too.
    const cart = passKerb(null, GOLF_CART);
    expect(cart.st.cd[cart.kerb]).toBeCloseTo(4.15, 6);
    // No shoulder: the lane is centred at 2 and 4 m wide, so its kerb is at 4.
    const bare = passKerb(NO_SHOULDER, EBIKE);
    expect(bare.st.cd[bare.kerb]).toBeCloseTo(4 - EBIKE.widthM / 2 - TRAFFIC.kerbInsetM, 6);
    const c = bare.st.corridor;
    expect(kerbCd(bare.config.road, c, 500, -1, 0.35)?.cd).toBeCloseTo(-(4 - 0.35 - TRAFFIC.kerbInsetM), 6);
  });

  it('cars pass a kerb rider without queuing behind it or touching it, shoulder or not', () => {
    for (const [name, lanes, type] of [
      ['shoulder', null, EBIKE],
      ['wide lane', NO_SHOULDER, EBIKE],
      ['narrow lane', NARROW, EBIKE],
      ['narrow lane, golf cart', NARROW, GOLF_CART],
    ] as const) {
      const r = passKerb(lanes, type);
      console.log(
        `kerb pass (${name}): passed ${r.passed}, touches ${r.touched}, car slowest behind it ` +
          `${r.carSlowest.toFixed(1)} m/s (kerb rider cruises at ${type.cruiseMps})`,
      );
      expect(r.passed, name).toBe(true);
      expect(r.touched, name).toBe(0);
      // Never stuck behind it at its speed: the car keeps well above a bike's pace.
      expect(r.carSlowest, name).toBeGreaterThan(type.cruiseMps + 8);
    }
  }, 60_000);

  it('an e-scooter weaves inside the road, seeded, and never changes lanes', () => {
    const config = makeConfig({ riders: SOLO, types: [CAR, SCOOTER], tuning: NO_TRAFFIC });
    const world = scenarioWorld(config, [{ pos: { edge: 0, s: 30, d: -1.7, dir: 1 }, speed: 0 }]);
    const k = placeVehicle(world, config, { type: 1, u: 500, dir: 1 });
    const st = trafficState(world);
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t < 60 * 10; t++) {
      stepWorld(world, config, SCENARIO, [hold(0)]);
      lo = Math.min(lo, st.cd[k] ?? 0);
      hi = Math.max(hi, st.cd[k] ?? 0);
      expect(st.rank[k]).toBe(0);
    }
    console.log(`scooter weave: cd ${lo.toFixed(2)} to ${hi.toFixed(2)} on a 1.5 m shoulder at 4.15`);
    expect(hi - lo).toBeGreaterThan(0.5);
    // Inside the shoulder: its centre 4.15, half width 0.75, the scooter's half width 0.25.
    expect(lo).toBeGreaterThanOrEqual(4.15 - 0.5 - 1e-9);
    expect(hi).toBeLessThanOrEqual(4.15 + 0.5 + 1e-9);
  });
});

describe('W-P: a rider stopped at the side of the lane', () => {
  /** A rider stopped at d (on edge a, s 500) and an RV coming up behind it from u 300. */
  const pass = (d: number) => {
    const config = makeConfig({ riders: SOLO, types: [CAR, RV], tuning: NO_TRAFFIC });
    const world = scenarioWorld(config, [{ pos: { edge: 0, s: 500, d, dir: 1 }, speed: 0 }]);
    const rv = placeVehicle(world, config, { type: 1, u: 300, dir: 1 });
    const st = trafficState(world);
    let touched = 0;
    const events: string[] = [];
    for (let t = 0; t < 60 * 30; t++) {
      for (const e of stepWorld(world, config, SCENARIO, [hold(0)])) events.push(e.type);
      const m = world.movers[0];
      const ru = m ? (toCorridor(st.corridor, m.pos)?.u ?? 0) : 0;
      const rcd = m ? (toCorridor(st.corridor, m.pos)?.cd ?? 0) : 0;
      const du = Math.abs((st.u[rv] ?? 0) - ru);
      const dd = Math.abs((st.cd[rv] ?? 0) - rcd);
      if (du < (RV.lengthM + TRAFFIC.riderLengthM) / 2 && dd < (RV.widthM + TRAFFIC.riderWidthM) / 2)
        touched++;
    }
    return { passed: (st.u[rv] ?? 0) > 520, touched, events };
  };

  it('traffic edges round a rider stopped mostly outside the lane (a cop on the shoulder)', () => {
    // The fixture lane is centred at d 1.7, 3.4 m wide; a rider at d 3.3 is mostly past its edge.
    const side = pass(3.3);
    console.log(`stopped rider at d 3.3: RV passed ${side.passed}, touches ${side.touched}`);
    expect(side.passed).toBe(true);
    expect(side.touched).toBe(0);
    expect(side.events.filter((e) => e === 'crash' || e === 'wobble')).toEqual([]);
    // In the middle of the lane (a crash), traffic still stops behind the rider.
    const middle = pass(1.7);
    expect(middle.passed).toBe(false);
    expect(middle.touched).toBe(0);
  });
});

describe('W-P convoys and lane-change flags', () => {
  it('an RV convoy spawns nose to tail, and no vehicle ever spawns inside reaction range', () => {
    const step = RV.lengthM + 3 + RV.cruiseMps * 1.2;
    /** Convoys: pairs of RVs in one lane at most one convoy step (plus jitter) apart. */
    const convoyPairs = (st: ReturnType<typeof trafficState>) => {
      let pairs = 0;
      for (let a = 0; a < st.id.length; a++)
        for (let b = a + 1; b < st.id.length; b++) {
          if (st.dir[a] !== st.dir[b] || st.rank[a] !== st.rank[b]) continue;
          if (st.retired[a] !== 0 || st.retired[b] !== 0) continue;
          if (Math.abs((st.u[a] ?? 0) - (st.u[b] ?? 0)) < step * 1.15) pairs++;
        }
      return pairs;
    };
    // Without the flag, the spawn gap keeps every RV much further apart than a convoy step.
    const solo = raceWorld(makeConfig({ types: [{ ...RV, behaviour: {} }] }));
    expect(convoyPairs(trafficState(solo))).toBe(0);
    const config = makeConfig({ types: [RV] });
    const world = raceWorld(config);
    const st = trafficState(world);
    const atStart = convoyPairs(st);
    const tooClose: string[] = [];
    let spawns = 0;
    while (world.tick < 60 * 60) {
      stepWorld(world, config, ALL, [scripted(world.tick)]);
      const anchors = world.movers
        .filter((m) => m.kind === 'rider' && config.riders[m.riderIndex]?.role !== 'cop')
        .map((m) => toCorridor(st.corridor, m.pos)?.u)
        .filter((u): u is number => u !== undefined);
      for (let k = 0; k < st.id.length; k++) {
        if (st.spawnTick[k] !== world.tick - 1) continue;
        spawns++;
        const near = Math.min(...anchors.map((a) => Math.abs(a - (st.u[k] ?? 0))));
        if (near < st.reactionM - 1e-6) tooClose.push(`tick ${world.tick}: ${near.toFixed(1)} m`);
      }
    }
    console.log(`convoys: ${atStart} close RV pairs at the start; ${spawns} spawns in 60 s`);
    expect(atStart).toBeGreaterThan(0);
    expect(spawns).toBeGreaterThan(0);
    expect(tooClose.slice(0, 3)).toEqual([]);
  }, 120_000);

  it("a type's laneChanges flag beats its category: robotaxis never change lanes, cars do", () => {
    const changes = (type: SimTrafficTypeDef) => {
      const config = makeConfig({ lanes: TWO_LANES, types: [type], tuning: { 'traffic.density': 3 } });
      const world = raceWorld(config);
      const st = trafficState(world);
      let n = 0;
      let ranks = [...st.rank];
      while (world.tick < 60 * 120) {
        stepWorld(world, config, ALL, [scripted(world.tick)]);
        st.rank.forEach((r, k) => {
          if (ranks[k] !== undefined && ranks[k] !== r && st.spawnTick[k] !== world.tick - 1) n++;
        });
        ranks = [...st.rank];
      }
      return n;
    };
    const cars = changes(CAR);
    const taxis = changes(ROBOTAXI);
    console.log(`lane changes in 120 s: cars ${cars}, robotaxis ${taxis}`);
    expect(cars).toBeGreaterThan(0);
    expect(taxis).toBe(0);
  }, 120_000);

  it('the same seed replays to the same hashes with every W-P behaviour on the road', () => {
    const run = (seed: number, types: readonly SimTrafficTypeDef[]) => {
      const sim = createSim(makeConfig({ seed, types }));
      const hashes: number[] = [];
      for (let t = 0; t < 60 * 40; t++) {
        sim.step([scripted(t)]);
        if (t % 60 === 0) hashes.push(sim.hash());
      }
      return hashes;
    };
    const types = [CAR, EBIKE, SCOOTER, GOLF_CART, RV, ROBOTAXI];
    const a = run(11, types);
    expect(run(11, types)).toEqual(a);
    expect(run(12, types)).not.toEqual(a);
    // The flags are sim inputs: dropping the scooter's weave changes the race.
    const flat = types.map((t) => (t === SCOOTER ? { ...t, behaviour: { kerb: true } } : t));
    expect(run(11, flat)).not.toEqual(a);
  }, 120_000);
});
