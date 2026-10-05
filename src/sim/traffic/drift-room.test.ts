// Drift room (playtest 4, the maintainer: "in areas that encourage drifting I think maybe we should
// give more room on the sides or something to give more room for error in heavy traffic"): traffic
// spawns clear of tight bends (`traffic.driftBendClearM`), and a vehicle near a drifting rider edges
// toward its kerb (`traffic.driftRoomM`). Both default on; 0 is the old behaviour.
import { describe, expect, it } from 'vitest';
import { tuningDefaults } from '../../core';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type FixtureEdgeSpec } from '../../road';
import { SIM_TUNING } from '../create';
import { ridersSystem, riderState } from '../riders';
import type { SimConfig, SimInput, SimRiderDef, SimTrafficTypeDef } from '../types';
import { addMover, createWorld, stepWorld, type SimSystem } from '../world';
import { placeVehicle, trafficState, trafficSystem } from './index';

const CAR: SimTrafficTypeDef = {
  contentId: 'base:sedan-rental',
  category: 'car',
  lengthM: 4.5,
  widthM: 1.8,
  cruiseMps: 15,
  hazard: 'normal',
  weight: 1,
};
/** A straight, a 60 m radius bend (a tight one: 1/60 > 1/75), a straight. The bend is s 500..800. */
const EDGES: readonly FixtureEdgeSpec[] = [
  { id: 'a', lengthM: 500, kappa: 0 },
  { id: 'b', lengthM: 300, kappa: 1 / 60 },
  { id: 'c', lengthM: 700, kappa: 0 },
];
const bike = {
  contentId: 'base:bike',
  topSpeedMps: 38,
  accelMps2: 4.2,
  brakeMps2: 9,
  steerRateMps: 5.5,
  massKg: 180,
};
const player: SimRiderDef = {
  contentId: 'base:player',
  name: 'player',
  role: 'player',
  faction: 'rider',
  controller: { kind: 'player', slot: 0 },
  bike,
  massKg: 85,
  healthMax: 100,
};

function config(tuning: Record<string, number>): SimConfig {
  const road = createRoadNetwork(fixtureNetwork(EDGES));
  return {
    seed: 5,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 31,
      byPlaceCash: [100],
      raceEndTimeoutTicks: 1800,
    },
    riders: [player],
    weapons: [],
    trafficTypes: [CAR],
    road,
    route: createRouteProgress(road, {
      id: 'r',
      network: 'fixture',
      start: { road: 'a', s: 20, dir: 1 },
      finish: { road: 'c', s: 650 },
      mainPath: ['a', 'b', 'c'],
      allowedRoads: ['a', 'b', 'c'],
      closed: false,
    }),
    modifiers: [],
    grudges: {},
    tuning: { ...tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)), 'traffic.density': 3, ...tuning },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

const SYSTEMS: SimSystem[] = [ridersSystem, trafficSystem];
const hold: SimInput = { steer: 0, throttle: 0, brake: 0, flags: 0 };

describe('drift room: no new traffic in a drift bend', () => {
  /** Every u a vehicle spawned or respawned at in a minute with the player waiting at s 350. */
  function spawnUs(tuning: Record<string, number>): number[] {
    const c = config(tuning);
    const world = createWorld(c);
    addMover(world, 'rider', { edge: 0, s: 350, d: -1.7, dir: 1 }, 0);
    for (const s of SYSTEMS) s.init(world, c);
    const st = trafficState(world);
    const seen: number[] = [];
    const us: number[] = [];
    for (let t = 0; t < 60 * 60; t++) {
      stepWorld(world, c, SYSTEMS, [hold]);
      for (let k = 0; k < st.id.length; k++) {
        if (seen[k] === st.spawnTick[k]) continue;
        seen[k] = st.spawnTick[k] ?? -1;
        us.push(st.spawnU[k] ?? 0);
      }
    }
    return us;
  }

  it('nothing spawns within 40 m of the bend (u 500..800); with the key at 0 vehicles do', () => {
    const inBend = (u: number) => u > 460 && u < 840;
    const on = spawnUs({});
    const off = spawnUs({ 'traffic.driftBendClearM': 0 });
    console.log(
      `[examined] spawns ${on.length} with the key on, ${off.length} off; in the bend's 460..840 m: ${on.filter(inBend).length} on, ${off.filter(inBend).length} off`,
    );
    expect(on.length).toBeGreaterThan(5);
    expect(off.filter(inBend).length).toBeGreaterThan(0); // the check is shown able to find them
    expect(on.filter(inBend)).toEqual([]);
  });
});

describe('drift room: a vehicle near a drifting rider edges toward its kerb', () => {
  /** The vehicle's lateral offset after 4 s with a rider 20 m behind it, drifting or not. */
  function offsetAfter(tuning: Record<string, number>, drifting: boolean): { start: number; end: number } {
    const c = config(tuning);
    const world = createWorld(c);
    const rider = addMover(world, 'rider', { edge: 0, s: 120, d: -1.7, dir: 1 }, 0);
    for (const s of SYSTEMS) s.init(world, c);
    const st = trafficState(world);
    const k = placeVehicle(world, c, { type: 0, u: 140, dir: 1, rank: 0, v0: 0.01, speed: 0.01 });
    const start = Math.abs(st.cd[k] ?? 0);
    for (let t = 0; t < 4 * 60; t++) {
      if (drifting) riderState(world).driftBeta[rider.id] = 0.3;
      rider.speed = 0;
      stepWorld(world, c, SYSTEMS, [hold]);
    }
    return { start, end: Math.abs(st.cd[k] ?? 0) };
  }

  it('moves out by about the key (1 m), only while a rider drifts, and not with the key at 0', () => {
    const drifting = offsetAfter({ 'traffic.density': 0.1 }, true);
    const calm = offsetAfter({ 'traffic.density': 0.1 }, false);
    const off = offsetAfter({ 'traffic.density': 0.1, 'traffic.driftRoomM': 0 }, true);
    console.log(
      `[examined] lane offset start/end: drifting ${drifting.start.toFixed(2)}/${drifting.end.toFixed(2)}, ` +
        `calm ${calm.start.toFixed(2)}/${calm.end.toFixed(2)}, key 0 ${off.start.toFixed(2)}/${off.end.toFixed(2)}`,
    );
    expect(calm.end).toBeCloseTo(calm.start, 1);
    expect(off.end).toBeCloseTo(off.start, 1);
    expect(drifting.end).toBeGreaterThan(drifting.start + 0.2);
    expect(drifting.end).toBeLessThanOrEqual(drifting.start + 1.0 + 1e-6);
  });
});
