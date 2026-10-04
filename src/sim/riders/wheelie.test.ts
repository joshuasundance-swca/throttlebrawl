// The wheelie and the hood launch (playtest 3: "I'd love a way to do wheelies and if you wheelie into
// the hood of a car it should launch you up into a jump doing backflips"; the gesture: double-tap the
// throttle to pop it, balance it by thumb height). Tests from the spec's acceptance lists (scratch
// moves.md §3.2 and §3.3, the critic's S2 for parked cars), counted in ticks with quantized inputs.
import { describe, expect, it } from 'vitest';
import { tuningDefaults } from '../../core';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type BakedFeature } from '../../road';
import { SIM_TUNING } from '../create';
import { gridPosition, raceSystem } from '../race';
import { trafficState, trafficSystem, placeVehicle } from '../traffic';
import {
  InputFlag,
  type SimConfig,
  type SimEvent,
  type SimInput,
  type SimRiderDef,
  type SimStyleRewards,
  type SimTrafficTypeDef,
} from '../types';
import { addMover, createWorld, stepWorld, type SimSystem, type World } from '../world';
import { timeToGround } from './air';
import { riderState, ridersSystem, WOBBLE_TICKS } from './index';
import { input, packHarness, riderHarness, testConfig, type RiderHarness } from './testing';
import {
  HOOD_APEX_M,
  HOOD_LAUNCH_H_M,
  HOOD_VY_SHARE,
  hoodLaunchContact,
  type HoodContact,
  WHEELIE_BRAKE,
  WHEELIE_SWEET,
  WHEELIE_TUNING,
  WHEELIE_WOBBLE_TICKS,
  wheelieMoves,
  wheelieOf,
} from './wheelie';

const G = 9.81;
/** u = 0.6: the sweet band's middle (θ settles at 0.6 rad). */
const SWEET_U = 153 / 255;

const wheelieIn = (throttle: number, brake = 0): SimInput => ({
  ...input(throttle, brake),
  flags: InputFlag.wheelie,
});

/** The wheelie's state for a rider, as the riders system keeps it. */
function wheelieState(world: World, id: number) {
  const st = riderState(world);
  return { theta: st.wheelie[id] ?? 0, rate: st.wheelieRate[id] ?? 0 };
}

/** Puts a rider in a wheelie at θ, at rest, as if it had been up a second. */
function putUp(h: RiderHarness, theta: number): void {
  const st = riderState(h.world);
  const id = h.rider.id;
  st.wheelie[id] = theta;
  st.wheelieRate[id] = 0;
  st.wheelieUp[id] = 60;
  st.wheelieSweet[id] = 0;
  st.wheelieTick[id] = h.world.tick - 1;
}

describe('the wheelie: pop and balance (moves §3.2)', () => {
  it('declares its switch and gain, on by default, and reuses the riders wobble length', () => {
    expect(WHEELIE_TUNING.map((d) => [d.id, d.default])).toEqual([
      ['riders.wheelie', 1],
      ['riders.wheelieGain', 1],
    ]);
    expect(WHEELIE_TUNING.every((d) => d.affectsSim)).toBe(true);
    expect(WHEELIE_WOBBLE_TICKS).toBe(WOBBLE_TICKS);
  });

  it('pops at 2.5 rad/s on the rising edge and settles at 0.6 rad on a 0.6 throttle', () => {
    const h = riderHarness(testConfig(), { s: 100, d: 1.7, speed: 20 });
    h.step(wheelieIn(SWEET_U));
    expect(wheelieState(h.world, h.rider.id).rate).toBeCloseTo(2.5, 9);
    for (let t = 1; t < 120; t++) h.step(wheelieIn(SWEET_U));
    const { theta } = wheelieState(h.world, h.rider.id);
    console.log(`[examined] θ after 120 ticks at u 0.6: ${theta.toFixed(3)} rad`);
    expect(Math.abs(theta - 0.6)).toBeLessThan(0.05);
    // The snapshot's pitch is the bike's real pitch: the ground's plus the front's angle.
    expect(riderState(h.world).pitch[h.rider.id]).toBeCloseTo(theta, 9);
    expect(wheelieOf(h.world, h.rider)).toBeCloseTo(theta, 9);
    expect(wheelieMoves(h.world, h.rider.id)).toEqual({ wheelieS: 2, wheelieBand: 'sweet' });
  });

  it('full throttle from the pop loops out: a crash with cause wheelie between tick 30 and 45', () => {
    const h = riderHarness(testConfig(), { s: 100, d: 1.7, speed: 20 });
    let crashAt = -1;
    const events: SimEvent[] = [];
    for (let t = 0; t < 90 && crashAt < 0; t++) {
      const out = h.step(wheelieIn(1));
      events.push(...out);
      if (out.some((e) => e.type === 'crash')) crashAt = t;
    }
    console.log(`[examined] loop-out at tick ${crashAt}`);
    expect(crashAt).toBeGreaterThanOrEqual(30);
    expect(crashAt).toBeLessThanOrEqual(45);
    const crash = events.find((e) => e.type === 'crash');
    expect(crash?.data).toMatchObject({ cause: 'wheelie', loopOut: true, upMps: 3, sideMps: 0 });
    const end = events.find((e) => e.type === 'wheelieEnd');
    expect(end?.data).toMatchObject({ loopOut: true, clean: false });
    expect(wheelieState(h.world, h.rider.id).theta).toBe(0);
  });

  it('thumb off after 90 ticks at 0.6: the front comes down cleanly within 70 ticks, no wobble', () => {
    const h = riderHarness(testConfig(), { s: 100, d: 1.7, speed: 20 });
    for (let t = 0; t < 90; t++) h.step(wheelieIn(SWEET_U));
    const events: SimEvent[] = [];
    let endAt = -1;
    for (let t = 0; t < 70 && endAt < 0; t++) {
      const out = h.step(input(0));
      events.push(...out);
      if (out.some((e) => e.type === 'wheelieEnd')) endAt = t;
    }
    console.log(`[examined] front down ${endAt + 1} ticks after the thumb lifted`);
    expect(endAt).toBeGreaterThanOrEqual(0);
    const end = events.find((e) => e.type === 'wheelieEnd');
    expect(end?.data).toMatchObject({ clean: true, loopOut: false });
    expect(Number(end?.data['seconds'])).toBeCloseTo((90 + endAt + 1) / 60, 9);
    expect(events.filter((e) => e.type === 'wobble' || e.type === 'crash')).toEqual([]);
    expect(wheelieState(h.world, h.rider.id).theta).toBe(0);
    expect(wheelieMoves(h.world, h.rider.id)).toEqual({ wheelieS: 0, wheelieBand: null });
  });

  it('slammed down (falling faster than 2.5 rad/s) is a wobble with cause wheelie, and no cash', () => {
    const h = riderHarness(testConfig(), { s: 100, d: 1.7, speed: 20 });
    putUp(h, 0.3);
    riderState(h.world).wheelieRate[h.rider.id] = -4;
    const events: SimEvent[] = [];
    for (let t = 0; t < 30 && !events.some((e) => e.type === 'wheelieEnd'); t++)
      events.push(...h.step(input(0)));
    const end = events.find((e) => e.type === 'wheelieEnd');
    expect(end?.data).toMatchObject({ clean: false, loopOut: false });
    expect(events.find((e) => e.type === 'wobble')?.data).toMatchObject({ cause: 'wheelie' });
    expect(riderState(h.world).wobble[h.rider.id]).toBeGreaterThan(0);
  });

  it('never pops at 5 m/s, under 0.3 throttle, in the air, for an AI rider, or with the switch off', () => {
    const popped = (h: RiderHarness, throttle = SWEET_U) => {
      for (let t = 0; t < 10; t++) h.step(wheelieIn(throttle));
      return wheelieState(h.world, h.rider.id).theta > 0;
    };
    expect(popped(riderHarness(testConfig(), { s: 100, d: 1.7, speed: 20 }))).toBe(true);
    expect(popped(riderHarness(testConfig(), { s: 100, d: 1.7, speed: 5 }))).toBe(false);
    expect(popped(riderHarness(testConfig(), { s: 100, d: 1.7, speed: 20 }), 0.25)).toBe(false);
    const air = riderHarness(testConfig(), { s: 100, d: 1.7, speed: 20 });
    air.rider.mode = 'Airborne';
    air.rider.h = 3;
    riderState(air.world).yAbs[air.rider.id] = 3;
    air.step(wheelieIn(SWEET_U));
    expect(wheelieState(air.world, air.rider.id).theta).toBe(0);
    for (const off of [{ 'riders.wheelie': 0 }, null]) {
      const base = testConfig();
      const tuning = { ...base.tuning, ...(off ?? {}) };
      if (!off) delete tuning['riders.wheelie'];
      expect(popped(riderHarness({ ...base, tuning }, { s: 100, d: 1.7, speed: 20 }))).toBe(false);
    }
    // Rider 0 of a one-rival config is the AI rival; rider 1 the player. Both get the flag.
    const pack = packHarness(testConfig({ rivals: 1 }), [
      { s: 100, d: -1.7, speed: 20 },
      { s: 100, d: 1.7, speed: 20 },
    ]);
    for (let t = 0; t < 10; t++) pack.step([wheelieIn(SWEET_U), wheelieIn(SWEET_U)]);
    const [ai, player] = pack.riders;
    if (!ai || !player) throw new Error('no riders');
    expect(wheelieState(pack.world, ai.id).theta).toBe(0);
    expect(wheelieState(pack.world, player.id).theta).toBeGreaterThan(0);
  });

  it('the flag only pops: holding it on after the front is down does not pop again', () => {
    const h = riderHarness(testConfig(), { s: 100, d: 1.7, speed: 20 });
    h.step(wheelieIn(SWEET_U));
    let ended = false;
    for (let t = 0; t < 200; t++) {
      // Flag held, throttle off: the front comes down, and it stays down while the flag stays held.
      const out = h.step({ ...input(0), flags: InputFlag.wheelie });
      if (out.some((e) => e.type === 'wheelieEnd')) ended = true;
      if (ended) expect(wheelieState(h.world, h.rider.id).theta).toBe(0);
    }
    expect(ended).toBe(true);
  });

  it('a full brake for 10 ticks at θ 0.8 brings the front under 0.5 (the rear brake)', () => {
    const h = riderHarness(testConfig(), { s: 100, d: 1.7, speed: 20 });
    putUp(h, 0.8);
    for (let t = 0; t < 10; t++) h.step(input(SWEET_U, 1));
    const { theta } = wheelieState(h.world, h.rider.id);
    console.log(
      `[examined] θ after 10 ticks of full brake from 0.8: ${theta.toFixed(3)} (B ${WHEELIE_BRAKE})`,
    );
    expect(theta).toBeLessThan(0.5);
  });

  it('steering has 0.6 of its reach while the front is up', () => {
    const yawAfter = (up: boolean) => {
      const h = riderHarness(testConfig(), { s: 100, d: 1.7, speed: 20 });
      if (up) putUp(h, 0.6);
      for (let t = 0; t < 30; t++) h.step({ ...input(SWEET_U, 0, 1), flags: 0 });
      return h.rider.yaw;
    };
    const ratio = yawAfter(true) / yawAfter(false);
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(0.7);
  });

  it('ends cleanly when the bike slows under 3 m/s, and dirty when a wobble lands on it', () => {
    const slow = riderHarness(testConfig(), { s: 100, d: 1.7, speed: 2.9 });
    putUp(slow, 0.5);
    const out = slow.step(input(SWEET_U));
    expect(out.find((e) => e.type === 'wheelieEnd')?.data).toMatchObject({ clean: true });
    const hit = riderHarness(testConfig(), { s: 100, d: 1.7, speed: 20 });
    putUp(hit, 0.5);
    riderState(hit.world).wobble[hit.rider.id] = 20;
    const out2 = hit.step(input(SWEET_U));
    expect(out2.find((e) => e.type === 'wheelieEnd')?.data).toMatchObject({ clean: false });
    expect(wheelieState(hit.world, hit.rider.id).theta).toBe(0);
  });

  it('a rider taken off the bike mid-wheelie (a crash) comes back with the front down', () => {
    const h = riderHarness(testConfig(), { s: 100, d: 1.7, speed: 20 });
    putUp(h, 0.5);
    h.rider.mode = 'Tumble';
    for (let t = 0; t < 30; t++) h.step(input(0));
    expect(wheelieOf(h.world, h.rider)).toBe(0);
    expect(wheelieMoves(h.world, h.rider.id).wheelieBand).toBeNull();
    h.rider.mode = 'Road';
    const out = h.step(input(SWEET_U));
    expect(out.find((e) => e.type === 'wheelieEnd')?.data).toMatchObject({ clean: false });
    expect(wheelieState(h.world, h.rider.id).theta).toBe(0);
  });

  it('the band reads low, sweet or high for the HUD gauge', () => {
    const h = riderHarness(testConfig(), { s: 100, d: 1.7, speed: 20 });
    for (const [theta, band] of [
      [0.2, 'low'],
      [WHEELIE_SWEET.lo, 'sweet'],
      [0.6, 'sweet'],
      [WHEELIE_SWEET.hi, 'sweet'],
      [1.0, 'high'],
    ] as const) {
      putUp(h, theta);
      expect(wheelieMoves(h.world, h.rider.id).wheelieBand).toBe(band);
    }
  });
});

// ---- the hood launch: riders and traffic together -------------------------------------------

const SEDAN: SimTrafficTypeDef = {
  contentId: 'base:sedan-rental',
  category: 'car',
  lengthM: 4.6,
  widthM: 1.8,
  cruiseMps: 24.6,
  hazard: 'normal',
};
const BOX_TRUCK: SimTrafficTypeDef = {
  ...SEDAN,
  contentId: 'base:box-truck',
  category: 'truck',
  lengthM: 7.5,
  widthM: 2.4,
  hazard: 'big',
};
const CRUISER: SimTrafficTypeDef = {
  ...SEDAN,
  contentId: 'base:beach-cruiser',
  lengthM: 1.8,
  widthM: 0.7,
  cruiseMps: 5,
  behaviour: { kerb: true },
};
const STYLE: SimStyleRewards = {
  perNearMissCash: 25,
  perAirtimeCash: 40,
  perOncomingSecondCash: 10,
  perTakedownCash: 200,
  takedownComboScale: 0.5,
  perStealCash: 60,
  perWheelieSecondCash: 20,
  perDriftSecondCash: 30,
};
const PLAYER: SimRiderDef = {
  contentId: 'base:player',
  name: 'You',
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

function roadConfig(types: readonly SimTrafficTypeDef[], features: readonly BakedFeature[] = []): SimConfig {
  const b = fixtureNetwork([{ id: 'a', lengthM: 3000, kappa: 0 }]);
  const road0 = b.roads[0];
  if (!road0) throw new Error('no road');
  const road = createRoadNetwork({ ...b, roads: [{ ...road0, features: [...features] }] });
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 20, dir: 1 },
    finish: { road: 'a', s: 2980 },
    mainPath: ['a'],
    allowedRoads: ['a'],
    closed: false,
  });
  return {
    seed: 99,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 31,
      byPlaceCash: [100, 50],
      raceEndTimeoutTicks: 60 * 120,
      style: STYLE,
    },
    riders: [PLAYER],
    weapons: [],
    trafficTypes: [...types],
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

const SYSTEMS: SimSystem[] = [ridersSystem, trafficSystem, raceSystem];

/** The player on the road at (s, d), riding at `speed`, with one hand-placed vehicle, or none. */
function scene(
  config: SimConfig,
  rider: { s: number; d: number; speed: number },
  vehicle?: { type: number; u: number; dir: 1 | -1; speed: number },
) {
  const world = createWorld(config);
  const m = addMover(world, 'rider', gridPosition(config, 0), 0);
  for (const s of SYSTEMS) s.init(world, config);
  m.pos = { edge: 0, s: rider.s, d: rider.d, dir: 1 };
  m.speed = rider.speed;
  riderState(world).yAbs[m.id] = config.road.surfaceHeight(0, rider.s, rider.d);
  const slot = vehicle
    ? placeVehicle(world, config, { ...vehicle, v0: vehicle.speed, speed: vehicle.speed })
    : -1;
  const vid = slot >= 0 ? (trafficState(world).id[slot] ?? -1) : -1;
  const events: SimEvent[] = [];
  return {
    world,
    config,
    rider: m,
    vid,
    events,
    step(cmd: SimInput): SimEvent[] {
      const out = stepWorld(world, config, SYSTEMS, [cmd]);
      events.push(...out);
      return out;
    },
  };
}

/** Pops a wheelie and holds u 0.6 (θ about 0.6) until something launches, lands or crashes. */
function rideIn(
  sc: ReturnType<typeof scene>,
  ticks: number,
  cmd: (t: number) => SimInput = () => wheelieIn(SWEET_U),
) {
  for (let t = 0; t < ticks; t++) {
    const out = sc.step(cmd(t));
    if (out.some((e) => e.type === 'land' || e.type === 'crash')) return;
  }
}

const find = (events: readonly SimEvent[], type: SimEvent['type']) => events.find((e) => e.type === type);

describe('the hood launch (moves §3.3)', () => {
  it('a wheelie into an oncoming sedan at 50 m/s closing: launched, two backflips, a clean landing', () => {
    const config = roadConfig([SEDAN]);
    const sc = scene(config, { s: 100, d: -1.7, speed: 26 }, { type: 0, u: 300, dir: -1, speed: 24.6 });
    rideIn(sc, 60 * 8);
    const launch = find(sc.events, 'hoodLaunch');
    expect(launch, 'a hood launch').toBeDefined();
    expect(sc.events.filter((e) => e.type === 'crash')).toEqual([]);
    const closing = Number(launch?.data['closingMps']);
    console.log(`[examined] closing ${closing.toFixed(1)} m/s, launch data ${JSON.stringify(launch?.data)}`);
    expect(closing).toBeGreaterThan(48);
    expect(launch?.data['part']).toBe('hood');
    expect(launch?.target).toBe(sc.vid);
    // vy: 0.45 × closing, capped so the apex stays at HOOD_APEX_M (a flat landing under 14 m/s down).
    const vy = Math.min(HOOD_VY_SHARE * closing, Math.sqrt(2 * G * (HOOD_APEX_M - HOOD_LAUNCH_H_M)));
    expect(Number(launch?.data['vyMps'])).toBeCloseTo(vy, 9);
    expect(launch?.data['flips']).toBe(2);
    const jump = find(sc.events, 'jump');
    expect(jump?.data).toMatchObject({ hood: true });
    expect(jump?.tick).toBe(launch?.tick);
    // It lands at the forecast tick ± 3, with the backflips, clean, marked as a hood landing.
    const land = find(sc.events, 'land');
    const forecast = timeToGround(HOOD_LAUNCH_H_M, vy, G) * 60;
    const airTicks = (land?.tick ?? 0) - (launch?.tick ?? 0);
    console.log(
      `[examined] in the air ${airTicks} ticks, forecast ${forecast.toFixed(1)}; land ${JSON.stringify(land?.data)}`,
    );
    expect(Math.abs(airTicks - forecast)).toBeLessThanOrEqual(3);
    expect(land?.data).toMatchObject({ trick: 'backflip', flips: 2, quality: 'clean', hood: true });
    const trick = sc.events.find((e) => e.type === 'style' && e.data['kind'] === 'trick');
    expect(trick?.data['points']).toBe(STYLE.perAirtimeCash * 2 * 2 * 1.5);
    // The wheelie itself ended cleanly at the launch, and the car braked to 0.6 of its speed.
    const end = find(sc.events, 'wheelieEnd');
    expect(end?.data).toMatchObject({ clean: true, loopOut: false });
    expect(end?.tick).toBe(launch?.tick);
  });

  it('a same-direction sedan at 12 m/s closing: a trunk launch, one flip, down ahead of the car', () => {
    const config = roadConfig([SEDAN]);
    const sc = scene(config, { s: 100, d: 1.7, speed: 24 }, { type: 0, u: 140, dir: 1, speed: 12 });
    // Hold the wheelie at u 0.6; speed holds near 24 m/s, so it closes at about 12 m/s.
    rideIn(sc, 60 * 8);
    const launch = find(sc.events, 'hoodLaunch');
    expect(launch?.data['part']).toBe('trunk');
    expect(launch?.data['flips']).toBe(1);
    expect(Number(launch?.data['closingMps'])).toBeGreaterThan(8);
    const land = find(sc.events, 'land');
    expect(land?.data).toMatchObject({ trick: 'backflip', flips: 1, hood: true });
    expect(land?.data['quality']).not.toBe('crash');
    // Down ahead of the car, and no second contact with it afterwards.
    const st = trafficState(sc.world);
    const car = sc.world.movers[sc.vid];
    expect(car && sc.rider.pos.s).toBeGreaterThan((car?.pos.s ?? 0) + SEDAN.lengthM / 2);
    for (let t = 0; t < 120; t++) sc.step(input(SWEET_U));
    expect(sc.events.filter((e) => e.type === 'crash' || e.type === 'wobble')).toEqual([]);
    expect(st.id.length).toBe(1);
  });

  it('the car brakes to 0.6 of its speed at the launch', () => {
    const config = roadConfig([SEDAN]);
    const sc = scene(config, { s: 100, d: -1.7, speed: 26 }, { type: 0, u: 300, dir: -1, speed: 24.6 });
    let before = 0;
    for (let t = 0; t < 60 * 8; t++) {
      before = sc.world.movers[sc.vid]?.speed ?? 0;
      const out = sc.step(wheelieIn(SWEET_U));
      if (out.some((e) => e.type === 'hoodLaunch')) break;
    }
    expect(sc.world.movers[sc.vid]?.speed).toBeCloseTo(before * 0.6, 1);
  });

  it('too low a front (θ 0.2) or a big truck: the contact is today’s crash', () => {
    for (const c of [
      { what: 'θ 0.2', types: [SEDAN], u: 0.475 },
      { what: 'big truck', types: [BOX_TRUCK], u: SWEET_U },
    ]) {
      const sc = scene(
        roadConfig(c.types),
        { s: 100, d: -1.7, speed: 26 },
        { type: 0, u: 300, dir: -1, speed: 20 },
      );
      rideIn(sc, 60 * 8, () => wheelieIn(c.u));
      expect(find(sc.events, 'hoodLaunch'), c.what).toBeUndefined();
      const crash = find(sc.events, 'crash');
      expect(crash?.data, c.what).toMatchObject({ cause: 'traffic', hit: 'frontal' });
    }
  });

  it('the rule: only a car-sized, normal car or oddity, met end on at 8 m/s or more, in a real wheelie', () => {
    const sc = scene(roadConfig([SEDAN]), { s: 100, d: 1.7, speed: 20 });
    const st = riderState(sc.world);
    const id = sc.rider.id;
    const contact = (o: Partial<HoodContact> = {}): HoodContact => ({
      rider: id,
      vehicle: 99,
      type: SEDAN,
      endOn: true,
      graze: false,
      front: true,
      oncoming: true,
      closingMps: 30,
      ...o,
    });
    const up = (theta: number) => {
      st.wheelie[id] = theta;
      st.wheelieRate[id] = 0;
      st.wheelieTick[id] = sc.world.tick; // stepped this tick, as riders does before traffic
      sc.rider.mode = 'Road';
    };
    // Each case is checked before any launch (a launch would put the rider in the air).
    const no = [
      contact({ type: CRUISER }),
      contact({ type: BOX_TRUCK }),
      contact({ type: { ...SEDAN, category: 'rv' } }),
      contact({ type: { ...SEDAN, lengthM: 3.4 } }),
      contact({ endOn: false }),
      contact({ graze: true }),
      contact({ front: false }),
      contact({ closingMps: 7.9 }),
    ];
    for (const c of no) {
      up(0.6);
      expect(hoodLaunchContact(sc.world, sc.config, c), JSON.stringify(c)).toBe(false);
    }
    up(0.34);
    expect(hoodLaunchContact(sc.world, sc.config, contact())).toBe(false);
    up(0.6);
    expect(hoodLaunchContact(sc.world, sc.config, contact({ type: { ...SEDAN, category: 'oddity' } }))).toBe(
      true,
    );
    expect(sc.rider.mode).toBe('Airborne');
  });

  it('kick held through the whole flight: still no crash, and no more flips than the launch spun', () => {
    const config = roadConfig([SEDAN]);
    const sc = scene(config, { s: 100, d: -1.7, speed: 26 }, { type: 0, u: 300, dir: -1, speed: 24.6 });
    let launched = false;
    rideIn(sc, 60 * 10, () => {
      if (find(sc.events, 'hoodLaunch')) launched = true;
      return launched ? { ...input(SWEET_U), flags: InputFlag.kick } : wheelieIn(SWEET_U);
    });
    expect(launched).toBe(true);
    const land = find(sc.events, 'land');
    expect(land?.data['quality']).not.toBe('crash');
    expect(Number(land?.data['flips'])).toBeLessThanOrEqual(2);
    expect(sc.events.filter((e) => e.type === 'crash')).toEqual([]);
  });

  it('with no wheelie, the same sedan is today’s head-on crash', () => {
    const config = roadConfig([SEDAN]);
    const sc = scene(config, { s: 100, d: -1.7, speed: 26 }, { type: 0, u: 300, dir: -1, speed: 24.6 });
    rideIn(sc, 60 * 8, () => input(SWEET_U));
    expect(find(sc.events, 'hoodLaunch')).toBeUndefined();
    expect(find(sc.events, 'crash')?.data).toMatchObject({ cause: 'traffic', hit: 'frontal' });
  });
});

describe('a parked car launches too (the critic’s S2: "a car is a car")', () => {
  const PICKUP: BakedFeature = {
    kind: 'hazard',
    id: 'deck-pickup-1',
    s0: 600,
    s1: 605.4,
    d0: 2.4,
    d1: 4.5,
    params: { solid: true, object: 'pickup', heightM: 1.9 },
  };

  it('a wheelie into a parked pickup head on launches over it and lands past it', () => {
    const config = roadConfig([], [PICKUP]);
    const sc = scene(config, { s: 560, d: 3.4, speed: 20 });
    rideIn(sc, 60 * 8, () => wheelieIn(0.55));
    const launch = find(sc.events, 'hoodLaunch');
    console.log(`[examined] parked pickup launch: ${JSON.stringify(launch?.data)}`);
    expect(launch?.data).toMatchObject({ part: 'hood', feature: 'deck-pickup-1', object: 'pickup' });
    expect(launch?.target).toBeUndefined();
    expect(sc.events.filter((e) => e.type === 'crash')).toEqual([]);
    const land = find(sc.events, 'land');
    expect(land?.data).toMatchObject({ trick: 'backflip', hood: true });
    expect(land?.data['quality']).not.toBe('crash');
    expect(sc.rider.pos.s).toBeGreaterThan(PICKUP.s1);
  });

  it('a stump is not a car: a wheelie into it is today’s crash', () => {
    const stump: BakedFeature = {
      ...PICKUP,
      id: 'stump-1',
      params: { solid: true, object: 'stump', heightM: 0.8 },
    };
    const sc = scene(roadConfig([], [stump]), { s: 560, d: 3.4, speed: 20 });
    rideIn(sc, 60 * 8, () => wheelieIn(0.55));
    expect(find(sc.events, 'hoodLaunch')).toBeUndefined();
    expect(find(sc.events, 'crash')?.data).toMatchObject({ object: 'stump' });
  });
});

describe('wheelie cash', () => {
  it('three seconds and more in the sweet band pay perWheelieSecondCash a second, the rest half', () => {
    const sc = scene(roadConfig([]), { s: 100, d: 1.7, speed: 20 });
    for (let t = 0; t < 60 * 4; t++) sc.step(wheelieIn(SWEET_U));
    for (let t = 0; t < 90; t++) sc.step(input(0));
    const end = find(sc.events, 'wheelieEnd');
    const seconds = Number(end?.data['seconds']);
    const sweetS = Number(end?.data['sweetS']);
    const style = sc.events.find((e) => e.type === 'style' && e.data['kind'] === 'wheelie');
    console.log(
      `[examined] wheelie ${seconds.toFixed(3)} s, ${sweetS.toFixed(3)} s sweet, paid ${String(style?.data['points'])}`,
    );
    expect(sweetS).toBeGreaterThanOrEqual(3);
    const perS = STYLE.perWheelieSecondCash ?? 0;
    // sim/race pays whole cash: the rounded sum.
    expect(style?.data['points']).toBe(Math.round(perS * (sweetS + 0.5 * (seconds - sweetS))));
    expect(Number(style?.data['points'])).toBeGreaterThanOrEqual(perS * 3 - perS / 60);
  });
});
