// The height rule for meeting a vehicle (playtest 4's hitbox audit, the maintainer, 2026-10-05: "I'd
// like all hitboxes on everything to make sense"; the contract is docs/content-packs.md, "Heights and
// hitboxes"). A rider in the air clears a vehicle only when it is above the vehicle's height (the
// type's `heightM`, else its category's default); below it, the contact is decided like any other by
// ./contact-rule.ts: its closing speed along the contact's normal, against `traffic.solidHitMps`.
// Landing on the roof, the normal is up: under the old rule (`riders.supports` off) a glancing
// touch-down wobbles and rides off the roof, a square drop crashes; with supports (the maintainer,
// 2026-10-06; sim/riders/supports.ts) a roof that holds the bike is ground the rider lands on. Into its
// side or end in the air, the normal is the road's, as on the ground.
// A wheelie's hood or trunk launch still launches clear of the car it left. A rider whose file or
// bike gives a hitbox (the lawnmower, the parking trike) meets traffic with that box. Fixture road,
// only the riders and traffic stepping, counted in sim ticks.
import { describe, expect, it } from 'vitest';
import { tuningDefaults } from '../../core';
import { createRoadNetwork, createRouteProgress, fixtureNetwork } from '../../road';
import { SIM_TUNING } from '../create';
import { riderState, ridersSystem } from '../riders';
import {
  InputFlag,
  type SimConfig,
  type SimEvent,
  type SimInput,
  type SimRiderDef,
  type SimTrafficTypeDef,
} from '../types';
import { addMover, createWorld, stepWorld, type Mover, type SimSystem, type World } from '../world';
import { TRAFFIC_HIT_DEFAULT_MPS } from './contact-rule';
import { placeVehicle, trafficState, trafficSystem } from './index';

/** A sedan drawn 1.5 m tall, and a box truck drawn 3.3 m tall: both stand where they are put. */
const SEDAN: SimTrafficTypeDef = {
  contentId: 'base:sedan',
  category: 'car',
  lengthM: 4.6,
  widthM: 1.8,
  heightM: 1.5,
  cruiseMps: 0,
  hazard: 'normal',
};
const TRUCK: SimTrafficTypeDef = {
  ...SEDAN,
  contentId: 'base:box-truck',
  category: 'truck',
  lengthM: 7.5,
  widthM: 2.4,
  heightM: 3.3,
  hazard: 'big',
};
/** A sedan at cruise speed, for the trunk launch (its height left to the category's default). */
const CRUISING: SimTrafficTypeDef = {
  contentId: 'base:sedan-rental',
  category: 'car',
  lengthM: 4.6,
  widthM: 1.8,
  cruiseMps: 24.6,
  hazard: 'normal',
};
/**
 * A light kerb rider (the e-scooter rider's file: `dodges`, a kerb rider, drawn 1.65 m tall), standing
 * still where it is put. Light kerb riders are never a crash, from any direction or height
 * (docs/content-packs.md, "Contact outcomes: one rule", rule 3).
 */
const SCOOTER_RIDER: SimTrafficTypeDef = {
  contentId: 'test:e-scooter-rider',
  category: 'car',
  lengthM: 1.1,
  widthM: 0.55,
  heightM: 1.65,
  cruiseMps: 0,
  hazard: 'normal',
  behaviour: { roadside: 'dodges', kerb: true },
};
const TYPES = [SEDAN, TRUCK, CRUISING, SCOOTER_RIDER];
const T_SEDAN = 0;
const T_TRUCK = 1;
const T_CRUISING = 2;
const T_SCOOTER_RIDER = 3;

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
/** The lawnmower's box (packs: its bike file's `hitbox`). */
const MOWER = { lengthM: 1.65, widthM: 1.15 };

function makeConfig(rider: SimRiderDef = PLAYER, tuning: Record<string, number> = {}): SimConfig {
  const road = createRoadNetwork(fixtureNetwork([{ id: 'a', lengthM: 2000, kappa: 0 }]));
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
    riders: [rider],
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
      ...tuning,
    },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

const SCENARIO: SimSystem[] = [ridersSystem, trafficSystem];
const coast: SimInput = { steer: 0, throttle: 0, brake: 0, flags: 0 };
const isTraffic = (e: SimEvent) =>
  (e.type === 'crash' || e.type === 'wobble') && e.data['cause'] === 'traffic';

interface Scene {
  world: World;
  config: SimConfig;
  rider: Mover;
  vid: number;
  events: SimEvent[];
  step(n?: number, input?: SimInput): SimEvent[];
}

/**
 * One vehicle of type `type` put at u (= s on this road) in its lane, going +s at `speed`; and the
 * player at s, `dOff` across from the vehicle's centre line, riding at `speed` with heading `yaw`
 * (+yaw turns toward +d riding +s); in the air at `air.h` above the road rising at `air.vy` (m/s,
 * negative falling) when `air` is given.
 */
function scene(
  rider: { s: number; dOff: number; speed: number; yaw?: number; air?: { h: number; vy: number } },
  vehicle: { type: number; u: number; speed?: number },
  config = makeConfig(),
): Scene {
  const world = createWorld(config);
  const m = addMover(world, 'rider', { edge: 0, s: rider.s, d: 0, dir: 1 }, 0);
  for (const s of SCENARIO) s.init(world, config);
  const speed = vehicle.speed ?? 0;
  const slot = placeVehicle(world, config, { type: vehicle.type, u: vehicle.u, dir: 1, v0: speed, speed });
  const st = trafficState(world);
  const vid = st.id[slot] ?? -1;
  m.pos.d = (st.cd[slot] ?? 0) + rider.dOff;
  m.speed = rider.speed;
  m.yaw = rider.yaw ?? 0;
  const rs = riderState(world);
  const surface = config.road.surfaceHeight(0, rider.s, m.pos.d);
  rs.yAbs[m.id] = surface;
  if (rider.air) {
    m.mode = 'Airborne';
    m.h = rider.air.h;
    rs.yAbs[m.id] = surface + rider.air.h;
    rs.vy[m.id] = rider.air.vy;
    rs.airTicks[m.id] = 0;
  }
  const events: SimEvent[] = [];
  return {
    world,
    config,
    rider: m,
    vid,
    events,
    step(n = 1, input = coast) {
      const out: SimEvent[] = [];
      for (let t = 0; t < n; t++) out.push(...stepWorld(world, config, SCENARIO, [input]));
      events.push(...out);
      return out;
    },
  };
}

/** Steps until the rider lands or crashes, or `max` ticks; returns the events. */
function untilDown(sc: Scene, max = 240): SimEvent[] {
  for (let t = 0; t < max; t++) {
    const out = sc.step();
    if (out.some((e) => e.type === 'land' || e.type === 'crash')) break;
  }
  return sc.events;
}

const LINE = TRAFFIC_HIT_DEFAULT_MPS;
/** The old roof rule: supports off (sim/riders/supports.ts). */
const OLD_ROOF = { 'riders.supports': 0 };

describe('a rider in the air clears a vehicle only above its height', () => {
  // The same jump at each: 1.5 m behind the vehicle's box, 2.0 m up and rising at 5 m/s, at 25 m/s.
  // Over the next 0.4 s it stays between 2.0 and 3.3 m, so it clears a sedan's roof and meets a box
  // truck's tail.
  const jumpAt = (type: number, lengthM: number, h = 2.0) =>
    scene({ s: 300 - (lengthM + 2) / 2 - 1.5, dOff: 0, speed: 25, air: { h, vy: 5 } }, { type, u: 300 });

  it('a jump over a sedan (1.5 m) clears it: no contact, and the rider lands past it', () => {
    const sc = jumpAt(T_SEDAN, SEDAN.lengthM);
    const events = untilDown(sc);
    const land = events.find((e) => e.type === 'land');
    console.log(
      `[examined] over the sedan: ${events.filter(isTraffic).length} traffic contacts, landed at s ${sc.rider.pos.s.toFixed(1)} (car ends at ${(300 + SEDAN.lengthM / 2).toFixed(1)})`,
    );
    expect(events.filter(isTraffic)).toEqual([]);
    expect(land, 'a landing').toBeDefined();
    expect(sc.rider.pos.s).toBeGreaterThan(300 + SEDAN.lengthM / 2);
  });

  it('the same jump at a box truck (3.3 m) meets its tail below the top: closing at 25 m/s, a crash', () => {
    const sc = jumpAt(T_TRUCK, TRUCK.lengthM);
    const events = untilDown(sc);
    const hit = events.find(isTraffic);
    console.log(`[examined] at the truck: ${JSON.stringify(hit?.data)} at h ${sc.rider.h.toFixed(2)}`);
    expect(hit?.type).toBe('crash');
    expect(hit?.target).toBe(sc.vid);
    expect(hit?.data).toMatchObject({ hit: 'frontal', air: true, contact: 'crash' });
    expect(Number(hit?.data['impactMps'])).toBeGreaterThan(24);
  });

  it('the same jump from above the truck’s top (3.6 m up) clears it too', () => {
    const sc = jumpAt(T_TRUCK, TRUCK.lengthM, 3.6);
    const events = untilDown(sc);
    expect(events.filter(isTraffic)).toEqual([]);
    expect(sc.rider.pos.s).toBeGreaterThan(300 + TRUCK.lengthM / 2);
  });

  it('a jump too low for the sedan (1.2 m, falling) meets it: the old 1.2 m line no longer lets it through', () => {
    const sc = scene(
      { s: 300 - (SEDAN.lengthM + 2) / 2 - 1.5, dOff: 0, speed: 25, air: { h: 1.3, vy: 0 } },
      { type: T_SEDAN, u: 300 },
    );
    const hit = untilDown(sc).find(isTraffic);
    expect(hit?.type).toBe('crash');
    expect(hit?.data).toMatchObject({ hit: 'frontal', air: true });
  });
});

describe('landing on a roof, and an air hit into a side: the closing-speed rule', () => {
  // Over the sedan's middle, at 8 m/s along the road, just above the roof (1.5 m).
  const onRoof = (vy: number, tuning: Record<string, number> = OLD_ROOF) =>
    scene(
      { s: 299, dOff: 0, speed: 8, air: { h: 1.6, vy } },
      { type: T_SEDAN, u: 300 },
      makeConfig(PLAYER, tuning),
    );

  it('old rule: a glancing touch-down (3 m/s down) wobbles, rides the roof, then drops off past the car', () => {
    const sc = onRoof(-3);
    const lowest: number[] = [];
    for (let t = 0; t < 240; t++) {
      const out = sc.step();
      if (Math.abs(sc.rider.pos.s - 300) < (SEDAN.lengthM + 2) / 2 - 0.05 && sc.rider.mode === 'Airborne')
        lowest.push(sc.rider.h);
      if (out.some((e) => e.type === 'land' || e.type === 'crash')) break;
    }
    const contacts = sc.events.filter(isTraffic);
    console.log(
      `[examined] roof: ${JSON.stringify(contacts.map((e) => e.data))}; lowest over the roof ${Math.min(...lowest).toFixed(3)} m in ${lowest.length} ticks; landed at s ${sc.rider.pos.s.toFixed(1)}`,
    );
    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.type).toBe('wobble');
    expect(contacts[0]?.data).toMatchObject({ hit: 'top', air: true, contact: 'wobble' });
    expect(Number(contacts[0]?.data['impactMps'])).toBeGreaterThan(2.5);
    expect(Number(contacts[0]?.data['impactMps'])).toBeLessThan(LINE);
    // Held on the roof while over it, never sunk into the car.
    expect(Math.min(...lowest)).toBeGreaterThanOrEqual(SEDAN.heightM ?? 0);
    expect(sc.events.some((e) => e.type === 'crash')).toBe(false);
    expect(sc.events.find((e) => e.type === 'land')).toBeDefined();
    expect(sc.rider.pos.s).toBeGreaterThan(300 + SEDAN.lengthM / 2);
  });

  it('with supports, the same touch-downs land on the roof (a 12 m/s drop clean, under the 14 m/s wobble)', () => {
    for (const vy of [-3, -12]) {
      const sc = onRoof(vy, {});
      const down = untilDown(sc).find((e) => e.type === 'land' || e.type === 'crash');
      expect(down?.type).toBe('land');
      expect(down?.data).toMatchObject({ quality: 'clean', on: 'vehicle' });
      expect(sc.events.filter(isTraffic)).toEqual([]);
      expect(sc.rider.h).toBeCloseTo(SEDAN.heightM ?? 0, 6);
    }
  });

  it('old rule: a square drop onto the roof (12 m/s down) crashes, the body starting on the roof', () => {
    const sc = onRoof(-12);
    const hit = untilDown(sc).find(isTraffic);
    console.log(`[examined] square drop: ${JSON.stringify(hit?.data)}, h ${sc.rider.h.toFixed(2)}`);
    expect(hit?.type).toBe('crash');
    expect(hit?.data).toMatchObject({ hit: 'top', air: true, contact: 'crash' });
    expect(Number(hit?.data['impactMps'])).toBeGreaterThanOrEqual(LINE);
    expect(sc.rider.h).toBeCloseTo(SEDAN.heightM ?? 0, 6);
  });

  // Alongside a sedan, on its -d side 0.05 m from it, 0.8 m up (under its roof), drifting toward it
  // at `across` m/s.
  const intoSide = (across: number, h = 0.8) => {
    const yaw = Math.asin(across / 20);
    const dOff = -((SEDAN.widthM + 0.8) / 2 + 0.05);
    return scene({ s: 300, dOff, speed: 20, yaw, air: { h, vy: 2 } }, { type: T_SEDAN, u: 300 });
  };

  it('an air brush into its side at 3 m/s across wobbles; at 12 m/s across it crashes', () => {
    const slow = untilDown(intoSide(3)).find(isTraffic);
    const fast = untilDown(intoSide(12)).find(isTraffic);
    console.log(`[examined] side: slow ${JSON.stringify(slow?.data)}; fast ${JSON.stringify(fast?.data)}`);
    expect(slow?.type).toBe('wobble');
    expect(slow?.data).toMatchObject({ hit: 'side', air: true });
    expect(fast?.type).toBe('crash');
    expect(fast?.data).toMatchObject({ hit: 'side', air: true });
  });

  it('the same drift across, above the sedan’s roof (2.0 m up), touches nothing', () => {
    const sc = intoSide(12, 2.0);
    sc.step(20);
    expect(sc.events.filter(isTraffic)).toEqual([]);
  });
});

describe('a light kerb rider is never a crash, from above either (the live check of #619, mustFix 1)', () => {
  // The live check's repro: coming down from the air onto an e-scooter rider, at 8 m/s along the road,
  // just above its top. It was met as a car's roof: a crash from 10 m/s falling, and a slower drop left
  // the bike riding on top of the scooter rider.
  const dropOnto = (type: number, top: number, vy: number, tuning: Record<string, number> = {}) =>
    scene(
      { s: 299.6, dOff: 0, speed: 8, air: { h: top + 0.1, vy } },
      { type, u: 300 },
      makeConfig(PLAYER, tuning),
    );

  for (const vy of [-12, -3]) {
    it(`a drop at ${-vy} m/s onto the scooter rider: never a crash, never held on its top; the bike lands`, () => {
      const sc = dropOnto(T_SCOOTER_RIDER, SCOOTER_RIDER.heightM ?? 0, vy);
      let heldOnTop = 0;
      for (let t = 0; t < 240; t++) {
        const out = sc.step();
        const over = Math.abs(sc.rider.pos.s - 300) < (SCOOTER_RIDER.lengthM + 2) / 2;
        if (
          over &&
          sc.rider.mode === 'Airborne' &&
          Math.abs(sc.rider.h - (SCOOTER_RIDER.heightM ?? 0)) < 1e-6
        )
          heldOnTop++;
        if (out.some((e) => e.type === 'land' || e.type === 'crash')) break;
      }
      const contacts = sc.events.filter(isTraffic);
      console.log(
        `[examined] drop ${-vy} m/s onto the scooter rider: ${JSON.stringify(contacts.map((e) => [e.type, e.data]))}; ticks held on its top ${heldOnTop}; ends ${sc.rider.mode} h ${sc.rider.h.toFixed(2)}`,
      );
      expect(sc.events.filter((e) => e.type === 'crash')).toEqual([]);
      for (const e of contacts) expect(e.data).toMatchObject({ kerb: true });
      expect(heldOnTop).toBe(0);
      expect(sc.events.find((e) => e.type === 'land')).toBeDefined();
    });
  }

  // A sedan does have a roof: under the old rule the same drop is a crash on it, and with supports
  // (sim/riders/supports.ts) the bike lands on it, where it is never held over the scooter rider.
  it('control: the same 12 m/s drop onto a sedan meets its roof (old rule: a crash on it; supports: a landing on it)', () => {
    const old = dropOnto(T_SEDAN, SEDAN.heightM ?? 0, -12, OLD_ROOF);
    const hit = untilDown(old).find(isTraffic);
    expect(hit?.type).toBe('crash');
    expect(hit?.data).toMatchObject({ hit: 'top', air: true });
    const held = dropOnto(T_SEDAN, SEDAN.heightM ?? 0, -12);
    const down = untilDown(held).find((e) => e.type === 'land' || e.type === 'crash');
    expect(down?.type).toBe('land');
    expect(down?.data).toMatchObject({ on: 'vehicle' });
    expect(held.rider.h).toBeCloseTo(SEDAN.heightM ?? 0, 6);
  });
});

describe('a wheelie’s trunk launch still launches clear of its car', () => {
  /** Rides the wheelie by the gauge (holds the button while the front is under 0.5, lets go over 0.7). */
  function balancer(world: World, id: number): () => SimInput {
    let held = true;
    return () => {
      const theta = riderState(world).wheelie[id] ?? 0;
      if (theta > 0.7) held = false;
      else if (theta < 0.5) held = true;
      return { steer: 0, throttle: 153, brake: 0, flags: held ? InputFlag.wheelie : 0 };
    };
  }

  it('into the back of a car at 12 m/s: a trunk launch from 1 m (under its 1.8 m roof), no contact with it after', () => {
    const sc = scene({ s: 100, dOff: 0, speed: 24 }, { type: T_CRUISING, u: 140, speed: 12 });
    const ride = balancer(sc.world, sc.rider.id);
    for (let t = 0; t < 60 * 8; t++) {
      const out = sc.step(1, ride());
      if (out.some((e) => e.type === 'land' || e.type === 'crash')) break;
    }
    const launch = sc.events.find((e) => e.type === 'hoodLaunch');
    const land = sc.events.find((e) => e.type === 'land');
    console.log(`[examined] launch ${JSON.stringify(launch?.data)}; land ${JSON.stringify(land?.data)}`);
    expect(launch?.data['part']).toBe('trunk');
    expect(land?.data['quality']).not.toBe('crash');
    expect(sc.events.filter(isTraffic)).toEqual([]);
    const car = sc.world.movers[sc.vid];
    expect(sc.rider.pos.s).toBeGreaterThan((car?.pos.s ?? 0) + CRUISING.lengthM / 2);
  });

  it('control: the same ride with no wheelie rear-ends the car (closing 12 m/s, a crash)', () => {
    const sc = scene({ s: 100, dOff: 0, speed: 24 }, { type: T_CRUISING, u: 140, speed: 12 });
    for (let t = 0; t < 60 * 8; t++) {
      const out = sc.step(1, { steer: 0, throttle: 153, brake: 0, flags: 0 });
      if (out.some(isTraffic)) break;
    }
    expect(sc.events.find((e) => e.type === 'hoodLaunch')).toBeUndefined();
    expect(sc.events.find(isTraffic)?.type).toBe('crash');
  });
});

describe('a rider’s own hitbox (the lawnmower, the parking trike)', () => {
  // Riding past a stopped sedan, 0.1 m clear of its -d side with the default 0.8 m wide box.
  const past = (config: SimConfig) => {
    const dOff = -((SEDAN.widthM + 0.8) / 2 + 0.1);
    const sc = scene({ s: 280, dOff, speed: 15 }, { type: T_SEDAN, u: 300 }, config);
    sc.step(150);
    return sc.events.filter(isTraffic);
  };

  it('the default box passes 0.1 m clear; the lawnmower’s 1.15 m wide box clips the car', () => {
    const plain = past(makeConfig());
    const mower = past(makeConfig({ ...PLAYER, hitbox: MOWER }));
    console.log(
      `[examined] default box: ${plain.length} contacts; mower box: ${JSON.stringify(mower.map((e) => e.data))}`,
    );
    expect(plain).toEqual([]);
    expect(mower).toHaveLength(1);
    expect(mower[0]?.type).toBe('wobble');
    expect(mower[0]?.data['hit']).toBe('graze');
  });
});
