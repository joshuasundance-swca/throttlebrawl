// Hairpin yield (playtest 4, the maintainer on the Gorge: "the first couple turns are very very prone
// to crashing"; the field, carried wide round the Crown Point loop, met an oncoming car in it head
// on): a vehicle waits short of a bend of 75 m radius or tighter while a rider is in it or within
// `traffic.hairpinYieldM` (250 m) beyond it, riding toward the vehicle, and no vehicle appears where
// it could not stop in time. 0 is the old behaviour.
import { describe, expect, it } from 'vitest';
import { tuningDefaults } from '../../core';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type FixtureEdgeSpec } from '../../road';
import { SIM_TUNING } from '../create';
import { ridersSystem } from '../riders';
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
/** A straight, a 60 m radius bend (1/60 is tighter than 1/75), a straight. The bend is u 500..800. */
const EDGES: readonly FixtureEdgeSpec[] = [
  { id: 'a', lengthM: 500, kappa: 0 },
  { id: 'b', lengthM: 300, kappa: 1 / 60 },
  { id: 'c', lengthM: 700, kappa: 0 },
];
const player: SimRiderDef = {
  contentId: 'base:player',
  name: 'player',
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
    tuning: { ...tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)), ...tuning },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

const SYSTEMS: SimSystem[] = [ridersSystem, trafficSystem];
const hold: SimInput = { steer: 0, throttle: 0, brake: 0, flags: 0 };
/** A rider coming round the bend: held in place each tick, at a riding pace, m/s. */
const COMING_MPS = 12;

/**
 * One vehicle's u after `seconds`, with the rider held at `riderS` (riding +s) at `riderMps`: coming
 * round at a riding pace by default, or standing still at 0 (a cop waiting on the shoulder).
 */
function vehicleAfter(
  tuning: Record<string, number>,
  riderS: number,
  car: { u: number; dir: 1 | -1 },
  seconds: number,
  riderMps = COMING_MPS,
): number {
  const c = config({ 'traffic.density': 0, ...tuning });
  const world = createWorld(c);
  const rider = addMover(world, 'rider', { edge: 0, s: riderS, d: 1.7, dir: 1 }, 0);
  rider.speed = riderMps;
  for (const s of SYSTEMS) s.init(world, c);
  const st = trafficState(world);
  const k = placeVehicle(world, c, {
    type: 0,
    u: car.u,
    dir: car.dir,
    v0: CAR.cruiseMps,
    speed: CAR.cruiseMps,
  });
  for (let t = 0; t < seconds * 60; t++) {
    Object.assign(rider, { mode: 'Road', h: 0, yaw: 0, speed: riderMps });
    Object.assign(rider.pos, { s: riderS, d: 1.7 });
    stepWorld(world, c, SYSTEMS, [hold]);
  }
  return st.u[k] ?? 0;
}

describe('hairpin yield: traffic waits short of a tight bend while riders come round it (playtest 4)', () => {
  it('an oncoming car stops 60 m short of the bend, and drives in with the key at 0', () => {
    // The car comes down c toward the bend (u 800 is its mouth), the rider rides on a at s 350.
    const waits = vehicleAfter({}, 350, { u: 1000, dir: -1 }, 20);
    const off = vehicleAfter({ 'traffic.hairpinYieldM': 0 }, 350, { u: 1000, dir: -1 }, 20);
    console.log(
      `[examined] the oncoming car's u after 20 s: ${waits.toFixed(1)} with the yield, ${off.toFixed(1)} without`,
    );
    expect(off).toBeLessThan(800); // the check is shown able to see it drive into the bend
    expect(waits).toBeGreaterThan(800 + 60); // its nose stops short of the wait line
    expect(waits).toBeLessThan(800 + 60 + CAR.lengthM); // ... at the line, not miles back
  });

  it("a rider more than the reach past the bend, or one going the car's way, does not hold it", () => {
    // 500 - 250 = 250: a rider waiting at s 100 is beyond the reach behind the bend's far end.
    expect(vehicleAfter({}, 100, { u: 1000, dir: -1 }, 20)).toBeLessThan(800);
    // A car going the rider's way, ahead of it, drives through the bend.
    expect(vehicleAfter({}, 350, { u: 420, dir: 1 }, 30)).toBeGreaterThan(800);
  });

  it('a rider standing still past the bend (a cop waiting on the shoulder) does not hold it for good', () => {
    // Bridge City (polish H's punch item 5): a deputy parked on the shoulder inside the reach held
    // two oncoming cars at their wait line for the rest of the race, and the riders who came up the
    // road stopped nose to nose with them. Standing still, nobody is coming round the bend.
    const standing = vehicleAfter({}, 350, { u: 1000, dir: -1 }, 20, 0);
    const coming = vehicleAfter({}, 350, { u: 1000, dir: -1 }, 20);
    console.log(
      `[examined] the oncoming car's u after 20 s: ${standing.toFixed(1)} with the rider standing, ` +
        `${coming.toFixed(1)} with it coming round`,
    );
    expect(coming).toBeGreaterThan(800 + 60); // the same spot holds it while the rider comes
    expect(standing).toBeLessThan(800); // into the bend: a standing rider is not coming round it
  });

  it('nothing oncoming appears where it could not stop for the riders in time', () => {
    /** Every u an oncoming vehicle spawned at in a minute, the rider waiting in the bend at s 520. */
    const spawnUs = (tuning: Record<string, number>): number[] => {
      const c = config({ 'traffic.density': 3, ...tuning });
      const world = createWorld(c);
      addMover(world, 'rider', { edge: 1, s: 20, d: 1.7, dir: 1 }, 0);
      for (const s of SYSTEMS) s.init(world, c);
      const st = trafficState(world);
      const seen: number[] = [];
      const us: number[] = [];
      for (let t = 0; t < 60 * 60; t++) {
        stepWorld(world, c, SYSTEMS, [hold]);
        for (let k = 0; k < st.id.length; k++) {
          if (seen[k] === st.spawnTick[k]) continue;
          seen[k] = st.spawnTick[k] ?? -1;
          if (st.dir[k] === -1) us.push(st.spawnU[k] ?? 0);
        }
      }
      return us;
    };
    // Its wait line is 60 m past the mouth (u 860); stopping from 15 m/s at 3 m/s² takes 37.5 m more.
    const tooClose = (u: number) => u > 800 && u < 800 + 60 + (15 * 15) / 6;
    const on = spawnUs({});
    const off = spawnUs({ 'traffic.hairpinYieldM': 0, 'traffic.driftBendClearM': 0 });
    const offClear = spawnUs({ 'traffic.hairpinYieldM': 0 });
    console.log(
      `[examined] oncoming spawns in a minute: ${on.length} with the yield (${on.filter(tooClose).length} in u 800..897), ` +
        `${off.length} with it and drift room's clearance off (${off.filter(tooClose).length}), ` +
        `${offClear.length} with only the yield off (${offClear.filter(tooClose).length})`,
    );
    expect(off.filter(tooClose).length).toBeGreaterThan(0); // the check is shown able to find one
    expect(on.length).toBeGreaterThan(0);
    expect(on.filter(tooClose)).toEqual([]);
  });
});
