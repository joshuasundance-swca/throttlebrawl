// Playtest 4 (the maintainer, 2026-10-05): "I've respawned behind stuck traffic and crashed
// repeatedly ... maybe clip through if that happens", and "low speeds should wobble not crash,
// accounting for biker speed and traffic speed". Two rules, tested here on a fixture road with only
// the riders and traffic stepping:
// - ONE rule for every contact with a vehicle (./contact-rule.ts): the closing speed along the
//   contact's normal, from both bodies' velocities, against `traffic.solidHitMps`, for every geometry;
// - back on the bike (a remount or a splash respawn), the rider is a ghost to traffic: it and traffic
//   pass through each other for `traffic.respawnGhostS`, on while still overlapping a vehicle, never
//   past TRAFFIC.ghostCapS.
import { describe, expect, it } from 'vitest';
import { tuningDefaults } from '../../core';
import { createRoadNetwork, createRouteProgress, fixtureNetwork } from '../../road';
import { createSimWithWorld, SIM_TUNING } from '../create';
import { ridersSystem } from '../riders';
import type { SimConfig, SimEvent, SimInput, SimRiderDef, SimTrafficTypeDef } from '../types';
import { addMover, createWorld, stepWorld, worldHash, type SimSystem, type World } from '../world';
import { closingOnAxis, TRAFFIC_HIT_DEFAULT_MPS, trafficHitMps } from './contact-rule';
import { placeVehicle, startTrafficGhost, TRAFFIC, trafficGhost, trafficState, trafficSystem } from './index';

const CAR: SimTrafficTypeDef = {
  contentId: 'base:car',
  category: 'car',
  lengthM: 4.6,
  widthM: 1.8,
  cruiseMps: 24.6,
  hazard: 'normal',
};
const TRUCK: SimTrafficTypeDef = {
  ...CAR,
  contentId: 'base:truck',
  category: 'truck',
  lengthM: 7.5,
  widthM: 2.4,
  hazard: 'big',
};
/** A car that stays where it is put: no cruise speed. */
const STOPPED = 2;
const TYPES = [CAR, TRUCK, { ...CAR, contentId: 'base:stalled', cruiseMps: 0 }];

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

function makeConfig(tuning: Record<string, number> = {}): SimConfig {
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
      ...tuning,
    },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

const SCENARIO: SimSystem[] = [ridersSystem, trafficSystem];

/** The player on the right-hand lane (d 1.7 on this straight road, corridor u = s). */
function scene(config: SimConfig, rider: { s: number; d?: number; speed: number; yaw?: number }): World {
  const world = createWorld(config);
  const m = addMover(world, 'rider', { edge: 0, s: rider.s, d: rider.d ?? 1.7, dir: 1 }, 0);
  m.speed = rider.speed;
  m.yaw = rider.yaw ?? 0;
  for (const s of SCENARIO) s.init(world, config);
  return world;
}

const coast: SimInput = { steer: 0, throttle: 0, brake: 0, flags: 0 };
const traffic = (e: SimEvent) => (e.type === 'crash' || e.type === 'wobble') && e.data['cause'] === 'traffic';

/** Steps until the rider first touches a vehicle (or `max` ticks); the events on the way. */
function untilContact(world: World, config: SimConfig, input: SimInput = coast, max = 600): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 0; t < max && !events.some(traffic); t++)
    events.push(...stepWorld(world, config, SCENARIO, [input]));
  return events;
}

const LINE = TRAFFIC_HIT_DEFAULT_MPS;

describe('one rule for meeting a vehicle: the closing speed (playtest 4)', () => {
  it('measures the closing speed the same way for every geometry', () => {
    // Along the road (end on): rear-ending a stopped car, a car rear-ending a slow rider, a head-on.
    expect(closingOnAxis(25, 0, +3)).toBe(25);
    expect(closingOnAxis(3, 20, -3)).toBe(17);
    expect(closingOnAxis(30, -24.6, +3)).toBeCloseTo(54.6, 9);
    // Across it (a side brush, a graze): the rider's sideways speed against the car's swerve.
    expect(closingOnAxis(2, 0, +1)).toBe(2);
    expect(closingOnAxis(0, -2.2, +1)).toBeCloseTo(2.2, 9);
    // Pulling apart, or level, is no closing at all.
    expect(closingOnAxis(10, 20, +3)).toBe(0);
    expect(closingOnAxis(10, 10, +3)).toBe(0);
    // One key, one line: the default unless the tuning says otherwise.
    expect(trafficHitMps({})).toBe(LINE);
    expect(trafficHitMps({ 'traffic.solidHitMps': 14 })).toBe(14);
    expect(makeConfig().tuning['traffic.solidHitMps']).toBe(LINE);
  });

  it('a rider rolling at 5 m/s into a stopped car only wobbles', () => {
    const config = makeConfig();
    const world = scene(config, { s: 100, speed: 5 });
    placeVehicle(world, config, { type: STOPPED, u: 106, dir: 1, speed: 0 });
    const events = untilContact(world, config);
    const hit = events.find(traffic);
    console.log(
      `[examined] 5 m/s into a stopped car: ${hit?.type} at ${Number(hit?.data['impactMps']).toFixed(2)} m/s`,
    );
    expect(hit?.type).toBe('wobble');
    expect(hit?.data['hit']).toBe('frontal');
    expect(Number(hit?.data['impactMps'])).toBeGreaterThan(4);
    expect(Number(hit?.data['impactMps'])).toBeLessThan(LINE);
  });

  it('a stopped car met just under the line wobbles, just over it crashes', () => {
    for (const [speed, outcome] of [
      [LINE - 1, 'wobble'],
      [LINE + 1, 'crash'],
    ] as const) {
      const config = makeConfig();
      const world = scene(config, { s: 100, speed });
      placeVehicle(world, config, { type: STOPPED, u: 105, dir: 1, speed: 0 });
      const hit = untilContact(world, config).find(traffic);
      expect(hit?.type, `${speed} m/s`).toBe(outcome);
    }
  });

  it('rear-ending a moving car at 25 m/s closing crashes', () => {
    const config = makeConfig();
    const world = scene(config, { s: 100, speed: 35 });
    placeVehicle(world, config, { type: 0, u: 130, dir: 1, v0: 10, speed: 10 });
    const hit = untilContact(world, config, { steer: 0, throttle: 255, brake: 0, flags: 0 }).find(traffic);
    expect(hit?.type).toBe('crash');
    expect(hit?.data['hit']).toBe('frontal');
    expect(Number(hit?.data['impactMps'])).toBeGreaterThan(24);
  });

  it('side by side, a slow brush wobbles and a hard swerve into the door crashes, a truck no different', () => {
    for (const type of [0, 1]) {
      const t = TYPES[type] ?? CAR;
      for (const [yaw, outcome] of [
        [0.05, 'wobble'],
        [0.6, 'crash'],
      ] as const) {
        const config = makeConfig();
        // The car rides the lane's middle; the rider is just clear of its left side, as fast.
        const d = 1.7 - (t.widthM + TRAFFIC.riderWidthM) / 2 - 0.05;
        const world = scene(config, { s: 200, d, speed: 25, yaw });
        placeVehicle(world, config, { type, u: 200, dir: 1, v0: 25, speed: 25 });
        const hit = untilContact(world, config, { steer: 127, throttle: 150, brake: 0, flags: 0 }, 60).find(
          traffic,
        );
        const what = `${t.contentId} at yaw ${yaw}: ${hit?.type} at ${Number(hit?.data['impactMps']).toFixed(2)} m/s`;
        console.log(`[examined] ${what}`);
        expect(hit?.data['hit'], what).toBe('side');
        expect(hit?.type, what).toBe(outcome);
      }
    }
  });

  it("a kick's shove still sliding the rider sideways counts in the closing speed", () => {
    const config = makeConfig();
    const d = 1.7 - (CAR.widthM + TRAFFIC.riderWidthM) / 2 - 0.05;
    const world = scene(config, { s: 200, d, speed: 25 });
    placeVehicle(world, config, { type: 0, u: 200, dir: 1, v0: 25, speed: 25 });
    stepWorld(world, config, SCENARIO, [coast]); // side by side, not touching
    // sim/combat's shove curve, 14 m/s toward +d (the car) at its start, and the slide it made.
    world.systems['combat'] = { knockPeak: [14], knockT: [0], knockTicks: [24] };
    const m = world.movers[0];
    if (m) m.pos.d += 0.15;
    const hit = stepWorld(world, config, SCENARIO, [coast]).find(traffic);
    expect(hit?.data['hit']).toBe('side');
    expect(hit?.type).toBe('crash');
    expect(Number(hit?.data['impactMps'])).toBeGreaterThan(13);
  });
});

describe('back on the bike: a ghost to traffic (playtest 4)', () => {
  it('rides straight through a stopped car untouched, then meets the next one solid again', () => {
    const config = makeConfig();
    const world = scene(config, { s: 104, speed: 8 });
    const first = placeVehicle(world, config, { type: STOPPED, u: 110, dir: 1, speed: 0 });
    placeVehicle(world, config, { type: STOPPED, u: 220, dir: 1, speed: 0 });
    startTrafficGhost(world, 0);
    const st = trafficState(world);
    const events: SimEvent[] = [];
    let ghostTicks = 0;
    let overlapped = false;
    const m = world.movers[0];
    if (!m) throw new Error('no rider');
    const full: SimInput = { steer: 0, throttle: 255, brake: 0, flags: 0 };
    while (trafficGhost(world, 0) && world.tick < 600) {
      events.push(...stepWorld(world, config, SCENARIO, [full]));
      if (trafficGhost(world, 0)) ghostTicks++;
      if (Math.abs((st.u[first] ?? 0) - m.pos.s) < (CAR.lengthM + TRAFFIC.riderLengthM) / 2)
        overlapped = true;
      expect(m.pos.d).toBe(1.7); // never pushed
    }
    expect(overlapped).toBe(true);
    expect(events.filter(traffic)).toEqual([]);
    expect(events.filter((e) => e.type === 'nearMiss')).toEqual([]);
    // Clear of the car well before the minimum ran out, so the ghost lasted exactly the minimum.
    expect(ghostTicks).toBe(89); // 90 ticks counted from the remount's own tick
    expect(world.movers[st.id[first] ?? -1]?.speed).toBe(0);
    // Solid again: the next stopped car, met at speed, is a crash.
    const next = untilContact(world, config, full).find(traffic);
    console.log(
      `[examined] after the ghost: ${next?.type} into the next stopped car at ${Number(next?.data['impactMps']).toFixed(1)} m/s`,
    );
    expect(next?.type).toBe('crash');
  });

  it('lasts on while the rider still overlaps a car, and never past the cap', () => {
    const config = makeConfig();
    // Put back on the bike stopped inside a stalled car, and held there by the brake.
    const world = scene(config, { s: 110, speed: 0 });
    placeVehicle(world, config, { type: STOPPED, u: 110.5, dir: 1, speed: 0 });
    startTrafficGhost(world, 0);
    const events: SimEvent[] = [];
    let ghostTicks = 0;
    const brake: SimInput = { steer: 0, throttle: 0, brake: 255, flags: 0 };
    for (let t = 0; t < 400; t++) {
      events.push(...stepWorld(world, config, SCENARIO, [brake]));
      if (trafficGhost(world, 0)) ghostTicks++;
    }
    expect(ghostTicks).toBe(TRAFFIC.ghostCapS * 60 - 1);
    // At the cap the overlap is met by the one rule: closing at nothing, a wobble that pushes clear.
    expect(events.filter((e) => e.type === 'crash')).toEqual([]);
    expect(events.filter((e) => e.type === 'wobble')).toHaveLength(1);
  });

  it('shows in the snapshot, for the rider only; at 0 s it is off', () => {
    const config = makeConfig();
    const { sim, world } = createSimWithWorld(config);
    const id = config.riders.findIndex((r) => r.controller.kind === 'player');
    expect(sim.snapshot().entities[id]?.ghost).toBe(false);
    startTrafficGhost(world, id);
    expect(sim.snapshot().entities[id]?.ghost).toBe(true);
    const off = createSimWithWorld(makeConfig({ 'traffic.respawnGhostS': 0 }));
    startTrafficGhost(off.world, id);
    expect(off.sim.snapshot().entities[id]?.ghost).toBe(false);
  });

  it('is plain state: the same run hashes the same twice', () => {
    const run = () => {
      const config = makeConfig();
      const world = scene(config, { s: 104, speed: 8 });
      placeVehicle(world, config, { type: STOPPED, u: 110, dir: 1, speed: 0 });
      startTrafficGhost(world, 0);
      for (let t = 0; t < 200; t++)
        stepWorld(world, config, SCENARIO, [{ steer: 0, throttle: 255, brake: 0, flags: 0 }]);
      return worldHash(world);
    };
    expect(run()).toBe(run());
  });
});
