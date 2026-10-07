// Supports (the maintainer, playing on the phone, 2026-10-06: "landing on vehicles shouldn't necessarily
// be a crash. I flipped up onto a truck and crashed. It would have been much more satisfying to land on
// it and ride on it with real physics"; [decided] the same day: "include landing on big solid things
// beyond vehicles"). One rule: a solid thing whose top holds the bike (the rider's own box fits on it) is
// ground. A rider coming down on it lands through land() (the road's own vertical, sideways and attitude
// judgement), then rides it in Road mode, carried at its velocity, the throttle and the brake acting on
// his speed over it, the wind on his speed through the air; riding off an edge is a take-off. A smaller
// top (a hydrant) is an obstacle met from above by the closing-speed rule. Each rule has its control:
// with `riders.supports` off, the old rules (a roof is a contact by the fall speed; the rest is passed
// over). Fixture roads, only the riders and traffic stepping, counted in sim ticks.
import { describe, expect, it } from 'vitest';
import { cos, FNV_OFFSET, sin, tuningDefaults } from '../../core';
import {
  createRoadNetwork,
  createRouteProgress,
  fixtureNetwork,
  planStreetFurniture,
  type BakedFeature,
  type BakedTag,
  type StreetFurniture,
} from '../../road';
import { SIM_TUNING } from '../create';
import { placeVehicle, trafficState, trafficSystem } from '../traffic';
import { TRAFFIC_HIT_DEFAULT_MPS } from '../traffic/contact-rule';
import {
  InputFlag,
  type SimConfig,
  type SimEvent,
  type SimInput,
  type SimRiderDef,
  type SimTrafficTypeDef,
} from '../types';
import {
  addMover,
  createWorld,
  hashPlain,
  riderHitbox,
  stepWorld,
  worldHash,
  type Mover,
  type SimSystem,
  type World,
} from '../world';
import { RAMP_TRUCK_LENGTH_M, RAMP_TRUCK_LIP_M } from './features';
import { riderState, ridersSystem, touchdownOf } from './index';
import { holdsBike, supportKeyOf, SUPPORT_STATE_KEY, SUPPORTS_KEY } from './supports';

const BOX_TRUCK: SimTrafficTypeDef = {
  contentId: 'base:box-truck',
  category: 'truck',
  lengthM: 7.5,
  widthM: 2.4,
  heightM: 3.4,
  cruiseMps: 15,
  hazard: 'big',
};
const SEMI: SimTrafficTypeDef = {
  contentId: 'base:semi',
  category: 'truck',
  lengthM: 16,
  widthM: 2.6,
  heightM: 4,
  cruiseMps: 20,
  hazard: 'big',
};
/** A sedan to wheelie into (cruising), and one that stands where it is put. */
const SEDAN: SimTrafficTypeDef = {
  contentId: 'base:sedan',
  category: 'car',
  lengthM: 4.6,
  widthM: 1.8,
  heightM: 1.5,
  cruiseMps: 12,
  hazard: 'normal',
};
const PARKED_SEDAN: SimTrafficTypeDef = { ...SEDAN, contentId: 'base:stopped-sedan', cruiseMps: 0 };
const TYPES = [BOX_TRUCK, SEMI, SEDAN, PARKED_SEDAN];
const T_BOX = 0;
const T_SEMI = 1;
const T_SEDAN = 2;
const T_PARKED = 3;

const PLAYER: SimRiderDef = {
  contentId: 'base:player',
  name: 'You',
  role: 'player',
  faction: 'rider',
  controller: { kind: 'player', slot: 0 },
  bike: {
    contentId: 'base:bike',
    topSpeedMps: 40,
    accelMps2: 4.2,
    brakeMps2: 9,
    steerRateMps: 5.5,
    massKg: 180,
  },
  massKg: 85,
  healthMax: 100,
};

/** The carrier (a parked ramp truck): its empty top deck from s 611.95 to 617, then its cab to 622. */
const CARRIER: BakedFeature = {
  kind: 'rampTruck',
  id: 'carrier-1',
  s0: 600,
  s1: 622,
  d0: 2.4,
  d1: 4.4,
  params: { rampLengthM: RAMP_TRUCK_LENGTH_M, lipHeightM: RAMP_TRUCK_LIP_M },
};
/** Where the carrier's cab starts: 16.8 m from its ramp foot (where the model's flat deck ends). */
const CAB_S = CARRIER.s0 + 16.8;
/** The ferry deck's parked pickup (a solid hazard, 5.4 by 2.1 m, 1.9 m tall). */
const PICKUP: BakedFeature = {
  kind: 'hazard',
  id: 'deck-pickup-1',
  s0: 700,
  s1: 705.4,
  d0: 2.4,
  d1: 4.5,
  params: { solid: true, object: 'pickup', heightM: 1.9 },
};
/** A downtown sidewalk on the road's right (render's towers): its hydrants, planters and lamps. */
const TOWERS: BakedTag = { s0: 0, s1: 2000, side: 'right', tag: 'towers' };

interface ConfigOptions {
  tuning?: Record<string, number>;
  features?: readonly BakedFeature[];
  tags?: readonly BakedTag[];
  /** The road's curvature, 1/m (positive: a right turn); 0, a straight road. */
  kappa?: number;
}

function makeConfig(opts: ConfigOptions = {}): SimConfig {
  const bundle = fixtureNetwork([{ id: 'a', lengthM: 2000, kappa: opts.kappa ?? 0 }]);
  const road0 = bundle.roads[0];
  if (!road0) throw new Error('no road');
  const road = createRoadNetwork({
    ...bundle,
    roads: [{ ...road0, features: [...(opts.features ?? [])], tags: [...(opts.tags ?? [])] }],
  });
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 20, dir: 1 },
    finish: { road: 'a', s: 1980 },
    mainPath: ['a'],
    allowedRoads: ['a'],
    closed: false,
  });
  return {
    seed: 7,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 30,
      byPlaceCash: [100],
      raceEndTimeoutTicks: 1800,
    },
    riders: [PLAYER],
    weapons: [],
    trafficTypes: TYPES,
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: {
      ...tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)),
      // No population: every vehicle here is placed by hand.
      'traffic.densitySame': 0,
      'traffic.densityOncoming': 0,
      ...(opts.tuning ?? {}),
    },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

const OLD_RULES = { [SUPPORTS_KEY]: 0 };
const SCENARIO: SimSystem[] = [ridersSystem, trafficSystem];
const coast: SimInput = { steer: 0, throttle: 0, brake: 0, flags: 0 };
const held = (throttle: number, brake = 0, steer = 0): SimInput => ({
  steer: Math.round(steer * 127),
  throttle: Math.round(throttle * 255),
  brake: Math.round(brake * 255),
  flags: 0,
});

interface Scene {
  world: World;
  config: SimConfig;
  rider: Mover;
  events: SimEvent[];
  step(input?: SimInput): SimEvent[];
  /** Places a vehicle (u = s on this road), returns its entity id. */
  vehicle(type: number, u: number, dir?: 1 | -1, speed?: number): number;
}

/** The player at s, d riding +s at `speed`; in the air at `air.h` above the road, rising at `air.vy`. */
function scene(
  config: SimConfig,
  rider: {
    s: number;
    d: number;
    speed: number;
    yaw?: number;
    air?: { h: number; vy: number; pitch?: number };
  },
): Scene {
  const world = createWorld(config);
  const m = addMover(world, 'rider', { edge: 0, s: rider.s, d: rider.d, dir: 1 }, 0);
  for (const s of SCENARIO) s.init(world, config);
  m.speed = rider.speed;
  m.yaw = rider.yaw ?? 0;
  const rs = riderState(world);
  const surface = config.road.surfaceHeight(0, rider.s, rider.d);
  rs.yAbs[m.id] = surface;
  if (rider.air) {
    m.mode = 'Airborne';
    m.h = rider.air.h;
    rs.yAbs[m.id] = surface + rider.air.h;
    rs.vy[m.id] = rider.air.vy;
    // A short hop so far: a clean landing gives no surge (Air that pays), so the ride is the support's.
    rs.airTicks[m.id] = 0;
    rs.pitch[m.id] = rider.air.pitch ?? 0;
    rs.pitchRate[m.id] = 0;
  }
  const events: SimEvent[] = [];
  return {
    world,
    config,
    rider: m,
    events,
    step(input = coast) {
      const out = stepWorld(world, config, SCENARIO, [input]);
      events.push(...out);
      return out;
    },
    vehicle(type, u, dir = 1, speed) {
      const v = speed ?? config.trafficTypes[type]?.cruiseMps ?? 0;
      const slot = placeVehicle(world, config, { type, u, dir, v0: v, speed: v });
      return trafficState(world).id[slot] ?? -1;
    },
  };
}

/** Where a vehicle's centre is across the road (its lane's d). */
function laneD(sc: Scene, vid: number): number {
  return sc.world.movers[vid]?.pos.d ?? 0;
}

/** Steps until a `land` or a `crash` (or `max` ticks); returns that event. */
function untilDown(sc: Scene, input: SimInput = coast, max = 300): SimEvent | undefined {
  for (let t = 0; t < max; t++) {
    const hit = sc.step(input).find((e) => e.type === 'land' || e.type === 'crash');
    if (hit) return hit;
  }
  return undefined;
}

const isTraffic = (e: SimEvent) =>
  (e.type === 'crash' || e.type === 'wobble') && e.data['cause'] === 'traffic';

describe('a top that holds a bike (the threshold, from the rider’s own box)', () => {
  it('holds the 2.0 by 0.8 m box on a pickup, a box truck, a golf cart; not on a scooter, a bench or a bear', () => {
    const box = { lengthM: 2, widthM: 0.8 };
    expect(holdsBike(5.4, 2.0, box)).toBe(true); // a pickup
    expect(holdsBike(7.5, 2.4, box)).toBe(true); // a box truck
    expect(holdsBike(2.4, 1.3, box)).toBe(true); // a golf cart's canopy
    expect(holdsBike(1.1, 0.55, box)).toBe(false); // an e-scooter rider
    expect(holdsBike(2.0, 0.62, box)).toBe(false); // a downtown bench
    expect(holdsBike(1.1, 1.1, box)).toBe(false); // a carved bear
    expect(holdsBike(1.8, 1.8, box)).toBe(false); // a downtown planter
  });
});

describe('landing on a vehicle (the maintainer’s case, 2026-10-06)', () => {
  /** A drop onto a box truck driving +s at 15 m/s: just over its roof, falling at `vy`, 3 m/s faster. */
  function dropOnTruck(vy: number, pitch = 0, tuning: Record<string, number> = {}) {
    const sc = scene(makeConfig({ tuning }), { s: 299, d: 0, speed: 18, air: { h: 3.45, vy, pitch } });
    const vid = sc.vehicle(T_BOX, 300);
    sc.rider.pos.d = laneD(sc, vid);
    return { sc, vid };
  }

  it('a clean drop at 11 m/s lands through land() and rides the roof, carried at the truck’s speed', () => {
    const { sc, vid } = dropOnTruck(-11);
    const down = untilDown(sc);
    console.log(`[examined] drop on a box truck: ${down?.type} ${JSON.stringify(down?.data)}`);
    expect(down?.type).toBe('land');
    expect(down?.data).toMatchObject({ quality: 'clean', on: 'vehicle' });
    expect(Number(down?.data['verticalMps'])).toBeGreaterThan(TRAFFIC_HIT_DEFAULT_MPS);
    expect(sc.events.filter(isTraffic)).toEqual([]);
    // Rides it: on its roof, in Road mode, for a second, moving with it.
    const truck = sc.world.movers[vid];
    const gap0 = sc.rider.pos.s - (truck?.pos.s ?? 0);
    for (let t = 0; t < 60; t++) {
      sc.step(held(0, 1));
      expect(sc.rider.mode).toBe('Road');
      expect(sc.rider.h).toBeCloseTo(3.4, 6);
      expect(supportKeyOf(sc.world, sc.rider.id)).toBe(`v:${vid}`);
    }
    const gap1 = sc.rider.pos.s - (truck?.pos.s ?? 0);
    console.log(
      `[examined] after 1 s on the brake: rider ${gap0.toFixed(2)} → ${gap1.toFixed(2)} m from the truck's middle, truck ${truck?.speed.toFixed(1)} m/s`,
    );
    expect(Math.abs(gap1 - gap0)).toBeLessThan(1.5);
    expect(sc.events.some((e) => e.type === 'crash')).toBe(false);
  });

  it('control: the old roof rule crashes the same drop (closing at the fall speed, over 10 m/s)', () => {
    const { sc } = dropOnTruck(-11, 0, OLD_RULES);
    const down = untilDown(sc);
    expect(down?.type).toBe('crash');
    expect(down?.data).toMatchObject({ cause: 'traffic', hit: 'top', air: true });
  });

  it('a nose-first drop onto the same roof crashes, by the same attitude rule as the road', () => {
    const { sc } = dropOnTruck(-11, -1.0);
    const down = untilDown(sc);
    expect(down?.type).toBe('land');
    expect(down?.data['quality']).toBe('crash');
    const crash = sc.events.find((e) => e.type === 'crash');
    expect(crash?.data['cause']).toBe('landing');
  });

  /** Rides the wheelie by the gauge (holds the button while the front is under 0.5, lets go over 0.7). */
  function balancer(world: World, id: number): () => SimInput {
    let up = true;
    return () => {
      const theta = riderState(world).wheelie[id] ?? 0;
      if (theta > 0.7) up = false;
      else if (theta < 0.5) up = true;
      return { steer: 0, throttle: 153, brake: 0, flags: up ? InputFlag.wheelie : 0 };
    };
  }

  /**
   * The maintainer's case: a wheelie into an oncoming sedan's hood (closing about 30 m/s) launches the
   * rider about 9.5 m up, two backflips; a box truck stands where he comes down. Returns the scene, or
   * with `truckAt` null, the first point (s, d) and tick at which the flight comes down through the
   * truck's roof height.
   */
  function hoodFlight(truckAt: number | null, tuning: Record<string, number> = {}) {
    const sc = scene(makeConfig({ tuning }), { s: 100, d: 0, speed: 20 });
    const sedan = sc.vehicle(T_SEDAN, 160, -1);
    sc.rider.pos.d = laneD(sc, sedan);
    const truck = truckAt === null ? -1 : sc.vehicle(T_BOX, truckAt, -1, 0);
    const ride = balancer(sc.world, sc.rider.id);
    let launched = false;
    let apex = 0;
    let crossing: { s: number; tick: number } | null = null;
    for (let t = 0; t < 60 * 10; t++) {
      const out = sc.step(launched ? held(0.5) : ride());
      if (out.some((e) => e.type === 'hoodLaunch')) launched = true;
      if (launched && sc.rider.mode === 'Airborne') {
        apex = Math.max(apex, sc.rider.h);
        if (!crossing && sc.rider.h < apex && sc.rider.h <= BOX_TRUCK.heightM!)
          crossing = { s: sc.rider.pos.s, tick: sc.world.tick };
      }
      if (truckAt === null && crossing) break;
      if (truckAt !== null && out.some((e) => e.type === 'land' || e.type === 'crash')) break;
    }
    return { sc, truck, apex, crossing };
  }

  it('the maintainer’s hood-launch backflip onto a box truck lands clean and rides it; the old rule crashes it', () => {
    const dry = hoodFlight(null);
    expect(dry.sc.events.find((e) => e.type === 'hoodLaunch')?.data['flips']).toBe(2);
    const at = dry.crossing;
    if (!at) throw new Error('the flight never came down through 3.4 m');
    const run = hoodFlight(at.s);
    const land = run.sc.events.find((e) => e.type === 'land');
    console.log(
      `[examined] hood launch to ${run.apex.toFixed(1)} m, down through 3.4 m at s ${at.s.toFixed(1)}; on the truck: ${JSON.stringify(land?.data)}`,
    );
    expect(land?.data).toMatchObject({
      quality: 'clean',
      on: 'vehicle',
      trick: 'backflip',
      flips: 2,
      hood: true,
    });
    expect(land?.target).toBe(run.truck);
    // It rides the roof until it rolls off the (stopped) truck's far end, then lands on the road.
    let onRoof = 0;
    for (let t = 0; t < 120 && run.sc.rider.mode === 'Road'; t++) {
      if (supportKeyOf(run.sc.world, run.sc.rider.id) === `v:${run.truck}`) onRoof++;
      run.sc.step(held(0.5));
    }
    const after = untilDown(run.sc, held(0.5));
    console.log(
      `[examined] rode the roof ${onRoof} ticks, then ${after?.type} ${JSON.stringify(after?.data)}`,
    );
    expect(onRoof).toBeGreaterThan(5);
    expect(after?.type).toBe('land');
    expect(after?.data['quality']).not.toBe('crash');
    // Control: the old roof rule, same flight, crashes on the roof.
    const old = hoodFlight(at.s, OLD_RULES);
    const hit = old.sc.events.find(isTraffic);
    console.log(`[examined] old rule: ${hit?.type} ${JSON.stringify(hit?.data)}`);
    expect(hit?.type).toBe('crash');
    expect(hit?.data).toMatchObject({ hit: 'top' });
    expect(Number(hit?.data['impactMps'])).toBeGreaterThanOrEqual(TRAFFIC_HIT_DEFAULT_MPS);
  });
});

describe('riding it', () => {
  /** A semi driving +s at 20 m/s, and the player set down on its roof at `along` m from its middle. */
  function onSemi(along = 0, tuning: Record<string, number> = {}) {
    const sc = scene(makeConfig({ tuning }), { s: 400 + along, d: 0, speed: 20, air: { h: 4.05, vy: -1 } });
    const vid = sc.vehicle(T_SEMI, 400);
    sc.rider.pos.d = laneD(sc, vid);
    const down = untilDown(sc);
    expect(down?.data).toMatchObject({ quality: 'clean', on: 'vehicle' });
    return { sc, vid };
  }

  it('rides a semi for 10 s on the brake, carried at its speed; let go, the wind rolls him off its tail', () => {
    const { sc, vid } = onSemi();
    const semi = sc.world.movers[vid];
    const s0 = sc.rider.pos.s;
    for (let t = 0; t < 60 * 10; t++) {
      sc.step(held(0, 1));
      expect(supportKeyOf(sc.world, sc.rider.id)).toBe(`v:${vid}`);
    }
    const carried = sc.rider.pos.s - s0;
    const offMiddle = sc.rider.pos.s - (semi?.pos.s ?? 0);
    console.log(
      `[examined] 10 s on the semi: carried ${carried.toFixed(1)} m, ${offMiddle.toFixed(2)} m off its middle, speed over it ${sc.rider.speed.toFixed(2)} m/s`,
    );
    expect(carried).toBeGreaterThan(190);
    expect(Math.abs(offMiddle)).toBeLessThan(1);
    expect(sc.rider.h).toBeCloseTo(4, 6);
    // Let go: the wind (the air drag on his speed through the air) rolls him back off its tail.
    let jump: SimEvent | undefined;
    let tailAt = 0;
    for (let t = 0; t < 60 * 20 && !jump; t++) {
      const out = sc.step(coast);
      jump = out.find((e) => e.type === 'jump');
      tailAt = (semi?.pos.s ?? 0) - SEMI.lengthM / 2;
    }
    expect(jump, 'rolled off').toBeDefined();
    expect(sc.rider.pos.s).toBeLessThan(tailAt + 0.5);
    const down = untilDown(sc);
    console.log(
      `[examined] off the tail at ${JSON.stringify(jump?.data)}, then ${JSON.stringify(down?.data)}`,
    );
    expect(down?.type).toBe('land');
    expect(down?.data['quality']).not.toBe('crash');
    expect(sc.events.some((e) => e.type === 'crash')).toBe(false);
  });

  it('a side drop: steering off a moving truck is a take-off at its speed; he lands on the road beside it', () => {
    const sc = scene(makeConfig(), { s: 300, d: 0, speed: 15, air: { h: 3.45, vy: -1 } });
    const vid = sc.vehicle(T_BOX, 300);
    sc.rider.pos.d = laneD(sc, vid);
    expect(untilDown(sc)?.data['on']).toBe('vehicle');
    let jump: SimEvent | undefined;
    for (let t = 0; t < 180 && !jump; t++) jump = sc.step(held(0.3, 0, 1)).find((e) => e.type === 'jump');
    expect(jump, 'stepped off the side').toBeDefined();
    const truck = sc.world.movers[vid];
    expect(sc.rider.pos.d).toBeGreaterThan((truck?.pos.d ?? 0) + BOX_TRUCK.widthM / 2 - 0.05);
    expect(Number(jump?.data['speed'])).toBeGreaterThan(14);
    const down = untilDown(sc, held(0.3));
    console.log(`[examined] side drop: ${JSON.stringify(jump?.data)}; ${JSON.stringify(down?.data)}`);
    expect(down?.type).toBe('land');
    expect(down?.data['quality']).not.toBe('crash');
  });

  it('the truck braking hard under him: he rolls on over it and off its front, with no jolt', () => {
    const { sc, vid } = onSemi(-2);
    sc.vehicle(T_PARKED, 470);
    const semi = sc.world.movers[vid];
    const rel: number[] = [];
    let jump: SimEvent | undefined;
    for (let t = 0; t < 60 * 6 && !jump; t++) {
      const out = sc.step(coast);
      jump = out.find((e) => e.type === 'jump');
      rel.push(sc.rider.pos.s - (semi?.pos.s ?? 0));
    }
    console.log(
      `[examined] braking semi: rider ${rel[0]?.toFixed(2)} → ${rel[rel.length - 1]?.toFixed(2)} m from its middle over ${rel.length} ticks; semi ${semi?.speed.toFixed(1)} m/s at the drop`,
    );
    expect(jump, 'rolled off its front').toBeDefined();
    expect(rel[rel.length - 1]).toBeGreaterThan(SEMI.lengthM / 2 - 0.5);
    expect(sc.events.filter((e) => e.data['hit'] === 'jolt')).toEqual([]);
  });

  it('a hard stop (the no-overlap snap) throws him: a crash at the speed the truck lost', () => {
    const { sc, vid } = onSemi();
    // A stopped car just ahead of the semi's nose: the next traffic step snaps the semi to a stop.
    sc.vehicle(T_PARKED, 400 + (SEMI.lengthM + SEDAN.lengthM) / 2 + 0.3 + 0.05);
    let jolt: SimEvent | undefined;
    for (let t = 0; t < 10 && !jolt; t++) jolt = sc.step(held(0, 1)).find((e) => e.data['hit'] === 'jolt');
    console.log(`[examined] hard stop: ${jolt?.type} ${JSON.stringify(jolt?.data)}`);
    expect(jolt?.type).toBe('crash');
    expect(jolt?.target).toBe(vid);
    expect(Number(jolt?.data['impactMps'])).toBeGreaterThanOrEqual(TRAFFIC_HIT_DEFAULT_MPS);
  });
});

describe('big solid things beyond vehicles', () => {
  it('lands on the carrier’s cab roof, rides it to the front and drops off; control: supports off never stands on it', () => {
    const drop = (tuning: Record<string, number>) => {
      const sc = scene(makeConfig({ tuning, features: [CARRIER] }), {
        s: CAB_S + 1,
        d: 3.4,
        speed: 8,
        air: { h: 3.15 + 0.05, vy: -2 },
      });
      return { sc, down: untilDown(sc) };
    };
    const { sc, down } = drop({});
    console.log(`[examined] onto the carrier's cab roof: ${JSON.stringify(down?.data)}`);
    expect(down?.data).toMatchObject({ quality: 'clean', on: 'truck' });
    expect(supportKeyOf(sc.world, sc.rider.id)).toBe('t:carrier-1');
    const off = untilDown(sc, held(0.3));
    expect(off?.type).toBe('land');
    expect(off?.data['quality']).not.toBe('crash');
    expect(sc.rider.pos.s).toBeGreaterThan(CARRIER.s1);
    const old = drop(OLD_RULES).down;
    expect(old?.data['on']).toBeUndefined();
  });

  it('lands on a parked pickup (a solid hazard) and rides off it; control: the old rule never stood on it', () => {
    const drop = (tuning: Record<string, number>) => {
      const sc = scene(makeConfig({ tuning, features: [PICKUP] }), {
        s: 702,
        d: 3.4,
        speed: 6,
        air: { h: 1.95, vy: -2 },
      });
      return sc;
    };
    const sc = drop({});
    const down = untilDown(sc);
    expect(down?.data).toMatchObject({ quality: 'clean', on: 'hazard', object: 'pickup' });
    expect(sc.rider.h).toBeCloseTo(1.9, 6);
    const off = untilDown(sc, held(0.3));
    expect(off?.type).toBe('land');
    expect(off?.data['on']).toBeUndefined();
    expect(sc.rider.pos.s).toBeGreaterThan(PICKUP.s1);
    const old = drop(OLD_RULES);
    const oldDown = untilDown(old);
    expect(oldDown?.data['on']).toBeUndefined();
  });

  /** The first hydrant on the downtown sidewalk with nothing else near it. */
  function hydrantOf(config: SimConfig): StreetFurniture {
    const items = planStreetFurniture(config.road, config.seed).items;
    const it = items.find(
      (p) =>
        p.kind === 'hydrant' &&
        p.s > 40 &&
        !items.some((q) => q !== p && Math.abs(q.s - p.s) < 4 && Math.abs(q.shape.d - p.shape.d) < 2.5),
    );
    if (!it) throw new Error('no lone hydrant in the plan');
    return it;
  }

  it('a hydrant from above is an obstacle: a hard drop crashes on it, a soft one wobbles off it; control: off', () => {
    const downtown = (tuning: Record<string, number>) =>
      makeConfig({ tuning: { 'ground.offRoad': 1, 'riders.furniture': 1, ...tuning }, tags: [TOWERS] });
    const drop = (vy: number, tuning: Record<string, number> = {}) => {
      const config = downtown(tuning);
      const h = hydrantOf(config);
      const sc = scene(config, { s: h.shape.s, d: h.shape.d, speed: 1, air: { h: h.heightM + 0.05, vy } });
      for (let t = 0; t < 120; t++) {
        const out = sc.step();
        if (out.some((e) => e.type === 'crash' || e.type === 'land')) break;
      }
      return sc.events.filter((e) => e.data['object'] === 'hydrant');
    };
    const hard = drop(-12);
    const soft = drop(-3);
    const off = drop(-12, OLD_RULES);
    console.log(
      `[examined] hydrant from above: hard ${JSON.stringify(hard.map((e) => [e.type, e.data]))}; soft ${JSON.stringify(soft.map((e) => [e.type, e.data]))}; old rule ${JSON.stringify(off.map((e) => [e.type, e.data]))}`,
    );
    expect(hard[0]?.type).toBe('crash');
    expect(hard[0]?.data).toMatchObject({ hit: 'top' });
    expect(Number(hard[0]?.data['impactMps'])).toBeGreaterThanOrEqual(TRAFFIC_HIT_DEFAULT_MPS);
    expect(soft[0]?.type).toBe('wobble');
    expect(soft[0]?.data).toMatchObject({ hit: 'top' });
    expect(off.filter((e) => e.data['hit'] === 'top')).toEqual([]);
  });
});

describe('the chalk mark (Air that pays) knows the tops', () => {
  it('forecasts the landing on a moving truck’s roof, at its height, where and when it happens', () => {
    const sc = scene(makeConfig(), { s: 290, d: 0, speed: 20, air: { h: 6, vy: 0 } });
    const vid = sc.vehicle(T_BOX, 300, 1, 5);
    sc.rider.pos.d = laneD(sc, vid);
    const mark = touchdownOf(sc.world, sc.config, sc.rider);
    const roofY = sc.config.road.surfaceHeight(0, 300, sc.rider.pos.d) + BOX_TRUCK.heightM!;
    let ticks = 0;
    let down: SimEvent | undefined;
    for (; ticks < 180 && !down; ticks++) down = sc.step(held(0.5)).find((e) => e.type === 'land');
    const p = sc.config.road.toWorld(0, sc.rider.pos.s, sc.rider.pos.d, sc.rider.h);
    console.log(
      `[examined] mark at y ${mark?.y.toFixed(2)} in ${mark?.inS.toFixed(2)} s (roof y ${roofY.toFixed(2)}); landed ${JSON.stringify(down?.data['on'])} after ${(ticks / 60).toFixed(2)} s, ${Math.hypot((mark?.x ?? 0) - p.x, (mark?.z ?? 0) - p.z).toFixed(2)} m from the mark`,
    );
    expect(mark?.y).toBeCloseTo(roofY, 1);
    expect(down?.data['on']).toBe('vehicle');
    expect(Math.abs((mark?.inS ?? 0) - ticks / 60)).toBeLessThan(0.1);
    expect(Math.hypot((mark?.x ?? 0) - p.x, (mark?.z ?? 0) - p.z)).toBeLessThan(1);
    // Control: the old rules forecast the road under it, as before.
    const old = scene(makeConfig({ tuning: OLD_RULES }), { s: 290, d: 0, speed: 20, air: { h: 6, vy: 0 } });
    old.rider.pos.d = laneD(old, old.vehicle(T_BOX, 300, 1, 5));
    expect(touchdownOf(old.world, old.config, old.rider)?.y).toBeCloseTo(roofY - BOX_TRUCK.heightM!, 6);
  });
});

describe('determinism', () => {
  /** The semi ride, then off its tail: the world hash after every tick. */
  function rideHashes(kappa = 0): number[] {
    const sc = scene(makeConfig({ kappa }), { s: 400, d: 0, speed: 20, air: { h: 4.05, vy: -1 } });
    const vid = sc.vehicle(T_SEMI, 400);
    sc.rider.pos.d = laneD(sc, vid);
    const out: number[] = [];
    for (let t = 0; t < 60 * 8; t++) {
      sc.step(t < 60 * 3 ? held(0.2) : t < 60 * 5 ? held(0, 1, 0.3) : coast);
      out.push(worldHash(sc.world));
    }
    expect(sc.world.systems[SUPPORT_STATE_KEY]).toBeDefined();
    return out;
  }

  it('a ride on a semi records and replays to the same hash, tick by tick', () => {
    const a = rideHashes();
    const b = rideHashes();
    expect(b).toEqual(a);
  });

  it('a ride on a semi round a bend (carried along its path, off its edge) records and replays the same', () => {
    const a = rideHashes(1 / 300);
    const b = rideHashes(1 / 300);
    expect(b).toEqual(a);
    expect(a).not.toEqual(rideHashes());
  });

  it('a race that never stands on a support hashes as before: the same state, the switch on or off', () => {
    // A jump over a sedan (1.5 m) that clears it and lands on the road beyond.
    const run = (tuning: Record<string, number>) => {
      const sc = scene(makeConfig({ tuning }), { s: 295, d: 0, speed: 25, air: { h: 2, vy: 5 } });
      const vid = sc.vehicle(T_SEDAN, 300, 1, 0);
      sc.rider.pos.d = laneD(sc, vid);
      for (let t = 0; t < 180; t++) sc.step(held(0.5));
      const { tick, timeScale, movers, inputs, rng, systems, facts } = sc.world;
      return {
        events: sc.events.map((e) => `${e.tick}:${e.type}:${JSON.stringify(e.data)}`),
        state: hashPlain(FNV_OFFSET, { tick, timeScale, movers, inputs, rng, systems, facts }),
        supports: sc.world.systems[SUPPORT_STATE_KEY],
      };
    };
    const on = run({});
    const off = run(OLD_RULES);
    expect(on.events.some((e) => e.includes(':land:'))).toBe(true);
    expect(on.supports).toBeUndefined();
    expect(on.events).toEqual(off.events);
    expect(on.state).toBe(off.state);
  });
});

// The one support rule (the maintainer, 2026-10-06, [decided]: "consistent physics and gameplay is
// important here so players know what to expect"), from the support and barrier run's live check
// (2026-10-07): a rider is on a top or falling, never held in the air by another system. A rider whose
// box still overlaps a top's end but whose middle is off it falls past the edge, at the speed a fall from
// there gives; traffic does not hold him at the top while gravity builds (live, Seven Mile seed 6: 123
// ticks at a shrimp truck's tail, then a crash landing at 32.2 m/s from 3.25 m).
describe('one rule at a top’s edge: supported or falling, never held in the air', () => {
  const G = 9.81;
  /** Consecutive ticks in the air at exactly a top's height (a rider held there, not falling), and the touch-down. */
  function hoverRun(sc: Scene, top: number, ticks: number, input: SimInput = coast) {
    let run = 0;
    let longest = 0;
    let down: SimEvent | undefined;
    for (let t = 0; t < ticks && !down; t++) {
      const out = sc.step(input);
      if (sc.rider.mode === 'Airborne' && Math.abs(sc.rider.h - top) < 1e-6)
        longest = Math.max(longest, ++run);
      else run = 0;
      down = out.find((e) => e.type === 'land' || e.type === 'crash');
    }
    return { longest, down };
  }

  it('comes down at a truck’s tail (35 offsets and speeds per truck): never held at the top, lands at a fall’s speed', () => {
    const rows: string[] = [];
    let worstHover = 0;
    let worstExcess = -Infinity;
    let noClosing = 0;
    for (const [type, vT] of [
      [T_BOX, 15],
      [T_SEMI, 20],
    ] as const) {
      const def = TYPES[type];
      if (!def?.heightM) throw new Error('no truck');
      const h0 = def.heightM + 1.6;
      // The fastest a fall from where he starts can be: 4 m/s down, h0 above the road.
      const fallMps = Math.sqrt(4 * 4 + 2 * G * h0);
      for (const dx of [-0.6, -0.3, 0.1, 0.4, 0.7, 0.95, 1.2]) {
        for (const dv of [-3, -1, 0, 1, 3]) {
          const sc = scene(makeConfig(), { s: 0, d: 0, speed: vT + dv, air: { h: h0, vy: -4 } });
          const vid = sc.vehicle(type, 300, 1, vT);
          const truck = sc.world.movers[vid];
          // dx: how far the rider's middle is behind the truck's tail (negative: over its top).
          sc.rider.pos.s = (truck?.pos.s ?? 0) - def.lengthM / 2 - dx;
          sc.rider.pos.d = laneD(sc, vid);
          riderState(sc.world).yAbs[sc.rider.id] =
            sc.config.road.surfaceHeight(0, sc.rider.pos.s, sc.rider.pos.d) + h0;
          const { longest, down } = hoverRun(sc, def.heightM, 400);
          const vertical = Number(down?.data['verticalMps'] ?? down?.data['impactMps'] ?? NaN);
          worstHover = Math.max(worstHover, longest);
          worstExcess = Math.max(worstExcess, vertical - fallMps);
          // A contact with the truck is one he closed on it to make: by the closing speed, never at 0.
          for (const e of sc.events.filter(isTraffic)) noClosing += Number(e.data['impactMps']) > 0 ? 0 : 1;
          rows.push(
            `${def.contentId} dx ${dx} dv ${dv}: held ${longest} ticks; ${down?.type} ${String(down?.data['quality'] ?? down?.data['cause'])} on ${String(down?.data['on'] ?? 'road')} at ${vertical.toFixed(1)} m/s (a fall gives ≤ ${fallMps.toFixed(1)}); traffic [${sc.events
              .filter(isTraffic)
              .map((e) => `${e.type} ${String(e.data['hit'])} ${Number(e.data['impactMps']).toFixed(2)}`)
              .join(', ')}]`,
          );
          expect(down, `${def.contentId} dx ${dx} dv ${dv} came down`).toBeDefined();
        }
      }
    }
    console.log(`[examined] tail come-downs:\n${rows.join('\n')}`);
    console.log(
      `[examined] longest hold ${worstHover} ticks; worst excess over a fall ${worstExcess.toFixed(2)} m/s`,
    );
    // A hold of one tick is traffic's catch for a truck that moved under him as it stepped: landed next tick.
    expect(worstHover).toBeLessThanOrEqual(1);
    expect(worstExcess).toBeLessThan(0.5);
    expect(noClosing).toBe(0);
  });

  it('rides off a semi’s front onto the road: falls at once from the edge, with no contact with the semi', () => {
    const sc = scene(makeConfig(), { s: 405, d: 0, speed: 20, air: { h: 4.05, vy: -1 } });
    const vid = sc.vehicle(T_SEMI, 400);
    sc.rider.pos.d = laneD(sc, vid);
    expect(untilDown(sc)?.data).toMatchObject({ quality: 'clean', on: 'vehicle' });
    let jump: SimEvent | undefined;
    for (let t = 0; t < 600 && !jump; t++) jump = sc.step(held(0.6)).find((e) => e.type === 'jump');
    expect(jump, 'rode off the front').toBeDefined();
    const { longest, down } = hoverRun(sc, SEMI.heightM ?? 4, 300, held(0.6));
    const hits = sc.events.filter((e) => isTraffic(e) && e.target === vid);
    const fallMps = Math.sqrt(2 * G * (SEMI.heightM ?? 4));
    console.log(
      `[examined] off the semi's front: ${JSON.stringify(jump?.data)}; held ${longest} ticks; ${down?.type} ${JSON.stringify(down?.data)}; traffic contacts with the semi ${JSON.stringify(hits.map((e) => e.data))}`,
    );
    expect(longest).toBeLessThanOrEqual(1);
    expect(hits).toEqual([]);
    expect(down?.type).toBe('land');
    expect(down?.data['quality']).not.toBe('crash');
    expect(Number(down?.data['verticalMps'])).toBeLessThan(fallMps + 0.5);
  });
});

// Punch 1 of the live check: the landing surge beat the brake on a top. On a 20 m/s semi, braking from
// a big landing still carried the bike 1.8, 5.7 and 10.3 m forward (0, 0.4 and 1.7 m with no surge);
// live, a 7 m truck ride ran off its front in 0.43 s. On a top the brake holds the surge back.
describe('the landing surge on a top yields to the brake', () => {
  /** A big flight (2.5 s of air, so the surge is due) onto a truck 3 m in from its tail, `vr0` faster. */
  function bigLanding(
    vr0: number,
    type: number,
    input: (landed: boolean) => SimInput,
    tuning: Record<string, number> = {},
  ) {
    const def = TYPES[type];
    if (!def?.heightM) throw new Error('no truck');
    const vT = def.cruiseMps;
    const h0 = def.heightM + 0.6;
    const sc = scene(makeConfig({ tuning }), { s: 0, d: 0, speed: vT + vr0, air: { h: h0, vy: -11 } });
    const vid = sc.vehicle(type, 300, 1, vT);
    const truck = sc.world.movers[vid];
    sc.rider.pos.s = (truck?.pos.s ?? 0) - def.lengthM / 2 + 3;
    sc.rider.pos.d = laneD(sc, vid);
    const rs = riderState(sc.world);
    rs.yAbs[sc.rider.id] = sc.config.road.surfaceHeight(0, sc.rider.pos.s, sc.rider.pos.d) + h0;
    rs.airTicks[sc.rider.id] = 150;
    let land: SimEvent | undefined;
    let r0 = 0;
    let furthest = -Infinity;
    let onTicks = 0;
    for (let t = 0; t < 60 * 3; t++) {
      const out = sc.step(input(land !== undefined));
      const l = out.find((e) => e.type === 'land');
      const rel = sc.rider.pos.s - (truck?.pos.s ?? 0);
      if (l && !land) {
        land = l;
        r0 = rel;
      }
      if (land && supportKeyOf(sc.world, sc.rider.id) === `v:${vid}`) {
        onTicks++;
        furthest = Math.max(furthest, rel);
      }
      if (land && sc.rider.mode !== 'Road') break;
    }
    return { land, carry: furthest - r0, onTicks };
  }
  const brakeFromLanding = (landed: boolean) => (landed ? held(0, 1) : coast);

  it('on the semi, braking from the landing carries him no further than with no surge, and he stays on', () => {
    const rows: string[] = [];
    for (const vr0 of [0, 3, 6]) {
      const surge = bigLanding(vr0, T_SEMI, brakeFromLanding);
      const none = bigLanding(vr0, T_SEMI, brakeFromLanding, { 'riders.surgeS': 0 });
      rows.push(
        `${vr0} m/s over the semi: surge ${String(surge.land?.data['surge'])}, carried ${surge.carry.toFixed(2)} m, on ${surge.onTicks} ticks; no surge ${none.carry.toFixed(2)} m, on ${none.onTicks}`,
      );
      expect(surge.land?.data).toMatchObject({ quality: 'clean', on: 'vehicle', surge: true });
      expect(surge.carry).toBeLessThan(none.carry + 0.1);
      expect(surge.onTicks).toBeGreaterThanOrEqual(60 * 2.5);
    }
    console.log(`[examined] braking from a surge landing on a 20 m/s semi:\n${rows.join('\n')}`);
  });

  it('on a 7.5 m box truck, 3 m/s faster, braking keeps him on it for 2.5 s', () => {
    const r = bigLanding(3, T_BOX, brakeFromLanding);
    console.log(`[examined] box truck: carried ${r.carry.toFixed(2)} m, on ${r.onTicks} ticks`);
    expect(r.land?.data).toMatchObject({ quality: 'clean', on: 'vehicle', surge: true });
    expect(r.onTicks).toBeGreaterThanOrEqual(60 * 2.5);
  });

  it('control: off the brake the surge still spits him forward over the top', () => {
    const coasting = bigLanding(0, T_SEMI, () => coast);
    const flat = bigLanding(0, T_SEMI, () => coast, { 'riders.surgeS': 0 });
    console.log(
      `[examined] coasting after the landing: surge carried ${coasting.carry.toFixed(2)} m, no surge ${flat.carry.toFixed(2)} m`,
    );
    expect(coasting.carry).toBeGreaterThan(flat.carry + 1);
  });
});

// The live check of 2026-10-07 (the maintainer's rule of 2026-10-06, [decided]: one consistent physics,
// what is drawn is what is met, nothing is a ghost). On I-5 by Lake Samish a rider braked to a standstill
// on a semi's roof slid 1.24 m sideways in 5 s and dropped off its side: the top carried him by its own
// straight-line velocity, with no turn, on a bend of 350 to 840 m radius. Then he fell through the
// trailer (48 ticks inside it) because the vehicle he left was a ghost to him until they were apart, and
// a rider sliding off a semi's back had his nose inside its tail for 10 to 25 ticks. A moving top carries
// its rider along its own path, and a vehicle a rider has left is solid to him again at once.
describe('a moving top carries its rider along its own path; the one he left is solid at once', () => {
  /** Where the rider's middle is on a vehicle's box: along its heading and across it, m. */
  function onBox(sc: Scene, vid: number): { du: number; dc: number } {
    const v = sc.world.movers[vid];
    if (!v) throw new Error('no vehicle');
    const road = sc.config.road;
    const f = road.frameAt(v.pos.edge, v.pos.s);
    const tx = f.tx * v.pos.dir;
    const tz = f.tz * v.pos.dir;
    const c = cos(v.yaw);
    const sn = sin(v.yaw);
    const hx = c * tx - sn * tz;
    const hz = c * tz + sn * tx;
    const p = road.toWorld(sc.rider.pos.edge, sc.rider.pos.s, sc.rider.pos.d, 0);
    const o = road.toWorld(v.pos.edge, v.pos.s, v.pos.d, 0);
    const ox = p.x - o.x;
    const oz = p.z - o.z;
    return { du: ox * hx + oz * hz, dc: -ox * hz + oz * hx };
  }

  /**
   * The live check's pass-through detector, per tick: the rider's box (riderHitbox) into the vehicle's
   * footprint by 5 cm or more both ways while 5 cm or more under its top (`box`), and his middle inside
   * the footprint under its top (`middle`).
   */
  function inside(sc: Scene, vid: number, def: SimTrafficTypeDef): { box: boolean; middle: boolean } {
    const { du, dc } = onBox(sc, vid);
    const box = riderHitbox(sc.config, sc.rider.riderIndex);
    const under = sc.rider.mode !== 'Tumble' && sc.rider.h <= (def.heightM ?? 0) - 0.05;
    const overU = (def.lengthM + box.lengthM) / 2 - Math.abs(du);
    const overD = (def.widthM + box.widthM) / 2 - Math.abs(dc);
    return {
      box: under && overU >= 0.05 && overD >= 0.05,
      middle: under && Math.abs(du) < def.lengthM / 2 && Math.abs(dc) < def.widthM / 2,
    };
  }

  /** A semi at 20 m/s, the player set down on its roof `along` m from its middle (a road of `kappa`). */
  function onSemiAt(along: number, kappa: number) {
    const sc = scene(makeConfig({ kappa }), { s: 400 + along, d: 0, speed: 20, air: { h: 4.05, vy: -1 } });
    const vid = sc.vehicle(T_SEMI, 400);
    sc.rider.pos.d = laneD(sc, vid);
    expect(untilDown(sc)?.data).toMatchObject({ quality: 'clean', on: 'vehicle' });
    return { sc, vid };
  }

  it('braked still on a semi on a 400 m bend, left or right, he stays where he is on it for 6 s', () => {
    const rows: string[] = [];
    for (const kappa of [1 / 400, -1 / 400, 0]) {
      const { sc, vid } = onSemiAt(-6, kappa);
      const at0 = onBox(sc, vid);
      let across = 0;
      let alongMove = 0;
      let onTicks = 0;
      for (let t = 0; t < 60 * 6; t++) {
        sc.step(held(0, 1));
        if (supportKeyOf(sc.world, sc.rider.id) !== `v:${vid}`) break;
        onTicks++;
        const at = onBox(sc, vid);
        across = Math.max(across, Math.abs(at.dc - at0.dc));
        alongMove = Math.max(alongMove, Math.abs(at.du - at0.du));
      }
      rows.push(
        `kappa ${kappa.toFixed(4)}: on ${onTicks} ticks, from (${at0.du.toFixed(2)}, ${at0.dc.toFixed(2)}) on the box moved at most ${across.toFixed(3)} m across, ${alongMove.toFixed(3)} m along`,
      );
      expect(onTicks, `kappa ${kappa}: still on the semi`).toBe(60 * 6);
      expect(across, `kappa ${kappa}: across`).toBeLessThan(0.05);
      expect(alongMove, `kappa ${kappa}: along`).toBeLessThan(0.3);
    }
    console.log(`[examined] braked on a 20 m/s semi, 6 m behind its middle:\n${rows.join('\n')}`);
  });

  /** Steps until he is down off the semi (or `max` ticks); the detector's ticks and the semi's contacts. */
  function afterLeaving(sc: Scene, vid: number, input: () => SimInput, max = 240) {
    let box = 0;
    let middle = 0;
    let down: SimEvent | undefined;
    // The most his place on the semi's box moved in one tick (the slide clear of its edge included).
    let step = 0;
    let was = onBox(sc, vid);
    for (let t = 0; t < max && !down; t++) {
      const out = sc.step(input());
      const at = inside(sc, vid, SEMI);
      if (at.box) box++;
      if (at.middle) middle++;
      const now = onBox(sc, vid);
      step = Math.max(step, Math.hypot(now.du - was.du, now.dc - was.dc));
      was = now;
      down = out.find((e) => e.type === 'land' || e.type === 'crash');
    }
    // A few ticks on the road after it, beside the semi.
    for (let t = 0; t < 30; t++) {
      sc.step(input());
      const at = inside(sc, vid, SEMI);
      if (at.box) box++;
      if (at.middle) middle++;
    }
    const hits = sc.events.filter((e) => isTraffic(e) && e.target === vid);
    return { box, middle, down, hits, step };
  }

  /** Steps until he leaves the top (a `jump`): it, and how far his place on the box moved in that tick. */
  function offTop(sc: Scene, vid: number, input: SimInput, max: number) {
    let jump: SimEvent | undefined;
    let moved = 0;
    for (let t = 0; t < max && !jump; t++) {
      const was = onBox(sc, vid);
      jump = sc.step(input).find((e) => e.type === 'jump');
      const now = onBox(sc, vid);
      moved = Math.hypot(now.du - was.du, now.dc - was.dc);
    }
    expect(inside(sc, vid, SEMI)).toEqual({ box: false, middle: false });
    return { jump, moved };
  }

  it('off a semi’s side on a bend, steering back into it: never inside it; he meets it by the closing speed', () => {
    const rows: string[] = [];
    for (const kappa of [1 / 300, -1 / 300]) {
      const { sc, vid } = onSemiAt(-5, kappa);
      // Toward the inside of the bend (a right bend turns toward +d): off that side, then back at the semi.
      const toInside = kappa > 0 ? 1 : -1;
      const { jump, moved } = offTop(sc, vid, held(0.25, 0, toInside), 240);
      expect(jump, 'stepped off the side').toBeDefined();
      const r = afterLeaving(sc, vid, () => held(0.3, 0, -toInside));
      rows.push(
        `kappa ${kappa.toFixed(4)}: moved ${moved.toFixed(2)} m on the box as he left it; box inside ${r.box} ticks, middle inside ${r.middle}; most moved on the box in a tick after ${r.step.toFixed(2)} m; ${r.down?.type} ${String(r.down?.data['quality'] ?? r.down?.data['cause'])}; contacts ${JSON.stringify(r.hits.map((e) => [e.type, e.data['hit'], Number(e.data['impactMps']).toFixed(2)]))}`,
      );
      expect(r.middle, `kappa ${kappa}: middle inside`).toBe(0);
      expect(r.box, `kappa ${kappa}: box inside`).toBe(0);
      for (const e of r.hits) expect(Number(e.data['impactMps'])).toBeGreaterThan(0);
    }
    console.log(`[examined] off a semi's side toward the bend's inside, steering back:\n${rows.join('\n')}`);
  });

  it('rolled back off a semi’s tail by the wind: his nose never inside its tail, no contact at 0', () => {
    const { sc, vid } = onSemiAt(-6, 0);
    const { jump, moved } = offTop(sc, vid, coast, 60 * 20);
    expect(jump, 'rolled off its tail').toBeDefined();
    const r = afterLeaving(sc, vid, () => coast);
    console.log(
      `[examined] off the semi's tail: ${JSON.stringify(jump?.data)}; moved ${moved.toFixed(2)} m on the box as he left it; box inside ${r.box} ticks, middle ${r.middle}; most moved on the box in a tick after ${r.step.toFixed(2)} m; ${r.down?.type} ${JSON.stringify(r.down?.data)}; contacts ${JSON.stringify(r.hits.map((e) => e.data))}`,
    );
    expect(r.box).toBe(0);
    expect(r.middle).toBe(0);
    expect(r.down?.type).toBe('land');
    expect(r.down?.data['quality']).not.toBe('crash');
    for (const e of r.hits) expect(Number(e.data['impactMps'])).toBeGreaterThan(0);
  });
});
