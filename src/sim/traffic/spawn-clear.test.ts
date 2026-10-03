// Run W-R: traffic never spawns into a rider. A cop waiting on the shoulder (the bait-shop lot, a
// patrol spot) is no anchor, so the fairness rule never kept spawns off him, and a kerb rider (a
// beach cruiser, a golf cart) could appear on top of him on the shoulder and shove him along it
// (CI's batch: seed 16, the lot cop moved from s 12 to 10.8 before his siren). Now a vehicle
// spawns only where its box keeps clear of every rider in its path.
import { describe, expect, it } from 'vitest';
import { tuningDefaults } from '../../core';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type FixtureEdgeSpec } from '../../road';
import { SIM_TUNING } from '../create';
import { ridersSystem } from '../riders';
import type { SimConfig, SimInput, SimRiderDef, SimTrafficTypeDef } from '../types';
import { addMover, createWorld, stepWorld, type SimSystem } from '../world';
import { TRAFFIC, trafficState, trafficSystem } from './index';
import { toCorridor } from './corridor';

const CRUISER: SimTrafficTypeDef = {
  contentId: 'base:beach-cruiser',
  category: 'car',
  lengthM: 1.8,
  widthM: 0.6,
  cruiseMps: 5.5,
  hazard: 'normal',
  weight: 1,
  behaviour: { kerb: true },
};
const EDGES: readonly FixtureEdgeSpec[] = [
  { id: 'a', lengthM: 900, kappa: 0 },
  { id: 'b', lengthM: 900, kappa: 0 },
];
const bike = {
  contentId: 'base:bike',
  topSpeedMps: 38,
  accelMps2: 4.2,
  brakeMps2: 9,
  steerRateMps: 5.5,
  massKg: 180,
};
const rider = (role: SimRiderDef['role'], i: number): SimRiderDef => ({
  contentId: `base:${role}-${i}`,
  name: `${role} ${i}`,
  role,
  faction: role === 'cop' ? 'law' : 'rider',
  controller: role === 'player' ? { kind: 'player', slot: 0 } : { kind: 'cop' },
  bike,
  massKg: 85,
  healthMax: 100,
});

function config(): SimConfig {
  const road = createRoadNetwork(fixtureNetwork(EDGES));
  return {
    seed: 3,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 31,
      byPlaceCash: [100],
      raceEndTimeoutTicks: 1800,
    },
    riders: [rider('player', 0), ...[1, 2, 3, 4, 5, 6].map((i) => rider('cop', i))],
    weapons: [],
    trafficTypes: [CRUISER],
    road,
    route: createRouteProgress(road, {
      id: 'r',
      network: 'fixture',
      start: { road: 'a', s: 20, dir: 1 },
      finish: { road: 'b', s: 880 },
      mainPath: ['a', 'b'],
      allowedRoads: ['a', 'b'],
      closed: false,
    }),
    modifiers: [],
    grudges: {},
    tuning: { ...tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)), 'traffic.density': 3 },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

const SYSTEMS: SimSystem[] = [ridersSystem, trafficSystem];
const hold: SimInput = { steer: 0, throttle: 0, brake: 0, flags: 0 };

describe('traffic never spawns into a rider (W-R)', () => {
  it('keeps every spawn clear of cops parked on the shoulder, and never shoves one', () => {
    const c = config();
    const world = createWorld(c);
    // The player waits at s 700; six cops wait on the right shoulder (d 4.15) from s 400 to s 500,
    // inside the spawn window and past the reaction range.
    addMover(world, 'rider', { edge: 0, s: 700, d: -1.7, dir: 1 }, 0);
    const cops = [400, 420, 440, 460, 480, 500].map((s, i) =>
      addMover(world, 'rider', { edge: 0, s, d: 4.15, dir: 1 }, i + 1),
    );
    for (const s of SYSTEMS) s.init(world, c);
    const st = trafficState(world);
    const startS = cops.map((m) => m.pos.s);
    let spawnedOnto = 0;
    const seen: number[] = [];
    // Every vehicle where it (re)spawns: its box at least 1 m clear of every cop's, end to end.
    const check = () => {
      for (let k = 0; k < st.id.length; k++) {
        if (seen[k] === st.spawnTick[k]) continue;
        seen[k] = st.spawnTick[k] ?? -1;
        for (const m of cops) {
          const p = toCorridor(st.corridor, m.pos);
          if (!p) continue;
          const du = Math.abs(p.u - (st.u[k] ?? 0));
          const dd = Math.abs(p.cd - (st.cd[k] ?? 0));
          const touch = (CRUISER.lengthM + TRAFFIC.riderLengthM) / 2 + 1;
          if (du < touch && dd < (CRUISER.widthM + TRAFFIC.riderWidthM) / 2) spawnedOnto++;
        }
      }
    };
    check();
    for (let t = 0; t < 60 * 60; t++) {
      stepWorld(world, c, SYSTEMS, [hold]);
      check();
    }
    expect(st.spawns).toBeGreaterThan(20);
    expect(spawnedOnto).toBe(0);
    expect(cops.map((m) => m.pos.s)).toEqual(startS);
  });
});
