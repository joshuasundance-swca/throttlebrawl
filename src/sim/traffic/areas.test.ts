// Run W-R, each key its own traffic (interview, 2026-10-02: "KEYS FIRST = DISTINCT KEYS"): where a
// road tag that is a traffic area covers a spawn slot, the area's own mix picks the type.
//   - an area-only type spawns only inside its area, and the region's mix holds outside every area;
//   - the type roll is one roll, as before: with no area on the road the spawns are the same as a
//     race whose types carry no area weights at all;
//   - seeded: the same seed spawns the same vehicles in the same places.
import { describe, expect, it } from 'vitest';
import { tuningDefaults } from '../../core';
import {
  createRoadNetwork,
  createRouteProgress,
  fixtureNetwork,
  type BakedNetworkBundle,
  type BakedTag,
  type FixtureEdgeSpec,
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
import { trafficAreaAt, trafficState, trafficSystem } from './index';

const CAR: SimTrafficTypeDef = {
  contentId: 'base:sedan',
  category: 'car',
  lengthM: 4.6,
  widthM: 1.8,
  cruiseMps: 24.6,
  hazard: 'normal',
  weight: 5,
  areaWeights: { 'key-fishing': 2, 'key-party': 2 },
};
const SHRIMP: SimTrafficTypeDef = {
  contentId: 'base:shrimp-truck',
  category: 'truck',
  lengthM: 7,
  widthM: 2.3,
  cruiseMps: 21,
  hazard: 'big',
  weight: 0,
  areaWeights: { 'key-fishing': 6 },
};
const VAN: SimTrafficTypeDef = {
  contentId: 'base:party-van',
  category: 'car',
  lengthM: 5.2,
  widthM: 2,
  cruiseMps: 20,
  hazard: 'normal',
  weight: 0,
  areaWeights: { 'key-party': 6 },
};
/** In the region's mix only: never in an area. */
const PICKUP: SimTrafficTypeDef = { ...CAR, contentId: 'base:pickup', weight: 3, areaWeights: {} };
const TYPES = [CAR, SHRIMP, VAN, PICKUP];

const EDGES: readonly FixtureEdgeSpec[] = [
  { id: 'a', lengthM: 900, kappa: 0 },
  { id: 'b', lengthM: 900, kappa: 1 / 400 },
  { id: 'c', lengthM: 900, kappa: 0 },
];
/** Road a is the fishing village; c is the party key from s 100; b is in no area. */
const TAGS: Readonly<Record<string, readonly BakedTag[]>> = {
  a: [
    { s0: 0, s1: 900, side: 'right', tag: 'marina' },
    { s0: 0, s1: 900, side: 'both', tag: 'key-fishing' },
  ],
  b: [{ s0: 0, s1: 900, side: 'both', tag: 'mangrove' }],
  c: [{ s0: 100, s1: 900, side: 'both', tag: 'key-party' }],
};

function bundle(tagged: boolean): BakedNetworkBundle {
  const b = fixtureNetwork(EDGES);
  return { network: b.network, roads: b.roads.map((r) => (tagged ? { ...r, tags: TAGS[r.id] ?? [] } : r)) };
}

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
  o: { tagged?: boolean; types?: readonly SimTrafficTypeDef[]; seed?: number } = {},
): SimConfig {
  const road = createRoadNetwork(bundle(o.tagged ?? true));
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 20, dir: 1 },
    finish: { road: 'c', s: 880 },
    mainPath: ['a', 'b', 'c'],
    allowedRoads: ['a', 'b', 'c'],
    closed: false,
  });
  return {
    seed: o.seed ?? 11,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 31,
      byPlaceCash: [100, 50],
      raceEndTimeoutTicks: 1800,
    },
    riders: [rider('rival', 0), rider('rival', 1), rider('player', 2)],
    weapons: [],
    trafficTypes: o.types ?? TYPES,
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: { ...tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)), 'traffic.density': 2 },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

const SYSTEMS: SimSystem[] = orderSystems([
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
const ride: SimInput = { steer: 0, throttle: 255, brake: 0, flags: 0 };

interface Spawn {
  tick: number;
  type: string;
  u: number;
  area: string | null;
}

/** Rides the race for `seconds` and lists every vehicle as it (re)spawns, with its area. */
function spawns(config: SimConfig, seconds: number): Spawn[] {
  const world: World = createWorld(config);
  config.riders.forEach((_d, i) => addMover(world, 'rider', gridPosition(config, i), i));
  for (const s of SYSTEMS) s.init(world, config);
  const st = trafficState(world);
  const out: Spawn[] = [];
  const seen: number[] = [];
  const log = () => {
    for (let k = 0; k < st.id.length; k++) {
      if (seen[k] === st.spawnTick[k]) continue;
      seen[k] = st.spawnTick[k] ?? -1;
      const u = st.spawnU[k] ?? 0;
      out.push({
        tick: world.tick,
        type: config.trafficTypes[st.type[k] ?? -1]?.contentId ?? '?',
        u,
        area: trafficAreaAt(config, st.corridor, u),
      });
    }
  };
  log();
  for (let t = 0; t < seconds * 60; t++) {
    stepWorld(world, config, SYSTEMS, [ride]);
    log();
  }
  return out;
}

describe('traffic areas (W-R: each key its own traffic)', () => {
  it('reads the area under a corridor point from the road tags, and none outside them', () => {
    const config = makeConfig();
    const world = createWorld(config);
    config.riders.forEach((_d, i) => addMover(world, 'rider', gridPosition(config, i), i));
    for (const s of SYSTEMS) s.init(world, config);
    const c = trafficState(world).corridor;
    expect(trafficAreaAt(config, c, c.lo + 300)).toBe('key-fishing');
    expect(trafficAreaAt(config, c, c.lo + 1300)).toBeNull();
    expect(trafficAreaAt(config, c, c.lo + 1850)).toBeNull();
    expect(trafficAreaAt(config, c, c.lo + 2300)).toBe('key-party');
    // No area weights on any type: no areas at all.
    const plain = makeConfig({ types: TYPES.map(({ areaWeights: _a, ...t }) => t) });
    expect(trafficAreaAt(plain, c, c.lo + 300)).toBeNull();
  });

  it("spawns each area's own vehicles only in that area, and the region's mix outside", () => {
    const list = spawns(makeConfig(), 75);
    const byArea = (area: string | null) => new Set(list.filter((s) => s.area === area).map((s) => s.type));
    expect(list.length).toBeGreaterThan(40);
    // The fishing village: sedans and shrimp trucks, never the party van or the pickup.
    expect([...byArea('key-fishing')].sort()).toEqual(['base:sedan', 'base:shrimp-truck']);
    // The party key: sedans and party vans.
    expect([...byArea('key-party')].sort()).toEqual(['base:party-van', 'base:sedan']);
    // Between the keys, the region's mix: no area-only type.
    const between = byArea(null);
    expect(between.has('base:shrimp-truck') || between.has('base:party-van')).toBe(false);
    expect(between.has('base:pickup')).toBe(true);
  });

  it('keeps the old rolls where no area applies, and replays the same spawns by seed', () => {
    const untagged = spawns(makeConfig({ tagged: false }), 30);
    const noAreas = spawns(
      makeConfig({ tagged: false, types: TYPES.map(({ areaWeights: _a, ...t }) => t) }),
      30,
    );
    expect(untagged.length).toBeGreaterThan(10);
    expect(untagged).toEqual(noAreas);
    expect(spawns(makeConfig({ seed: 4 }), 30)).toEqual(spawns(makeConfig({ seed: 4 }), 30));
  });

  it('replays to the same hash through the public sim', () => {
    const run = () => {
      const sim = createSim(makeConfig({ seed: 9 }));
      for (let t = 0; t < 60 * 20; t++) sim.step([ride]);
      return sim.hash();
    };
    expect(run()).toBe(run());
  });
});
