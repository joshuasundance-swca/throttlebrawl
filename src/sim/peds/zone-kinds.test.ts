// Real-world C0.4 (T4.2): a `roadsideZone` may carry `params.kinds`, a list of traffic-type ids
// (people or animals). The zone then spawns only those, equally likely, whatever the region's
// weights say (a "zones only" kind has weight 0 everywhere else), from the zone's own seeded stream
// so no other zone's spawns move. This gives Mallory Square its performers and Lombard its selfie
// tourists.
import { describe, expect, it } from 'vitest';
import { tuningDefaults } from '../../core';
import {
  createRoadNetwork,
  createRouteProgress,
  fixtureNetwork,
  type BakedFeature,
  type FixtureEdgeSpec,
} from '../../road';
import { SIM_TUNING } from '../create';
import { ridersSystem } from '../riders';
import type { SimConfig, SimRiderDef, SimTrafficTypeDef } from '../types';
import { addMover, createWorld, type SimSystem, type World } from '../world';
import { pedsState, pedsSystem } from './index';

// ---- fixtures ----------------------------------------------------------------------------

const person = (contentId: string, extra: Partial<SimTrafficTypeDef> = {}): SimTrafficTypeDef => ({
  contentId,
  category: 'pedestrian',
  lengthM: 0.5,
  widthM: 0.5,
  cruiseMps: 1.2,
  hazard: 'normal',
  ...extra,
});
const CAR: SimTrafficTypeDef = {
  contentId: 'base:car',
  category: 'car',
  lengthM: 4.6,
  widthM: 1.8,
  cruiseMps: 24.6,
  hazard: 'normal',
};
const CHICKEN: SimTrafficTypeDef = {
  contentId: 'base:chicken',
  category: 'animal',
  lengthM: 0.35,
  widthM: 0.3,
  cruiseMps: 2.2,
  hazard: 'normal',
};
// The region lists the tourist and the chicken; the performer and the diner are "zones only".
const TYPES: readonly SimTrafficTypeDef[] = [
  CAR,
  person('base:tourist'),
  CHICKEN,
  person('base:street-performer', { weight: 0 }),
  person('region-pnw:pod-diner', { weight: 0 }),
];
// Weights as the app gives them: a region that lists some types gives every other type 0.
const WEIGHTED: readonly SimTrafficTypeDef[] = TYPES.map((t) =>
  t.weight === undefined ? { ...t, weight: 1 } : t,
);
const idOf = (config: SimConfig, type: number) => config.trafficTypes[type]?.contentId ?? '?';

const zone = (id: string, s0: number, s1: number, params: Record<string, unknown>): BakedFeature => ({
  kind: 'roadsideZone',
  id,
  s0,
  s1,
  d0: 5,
  d1: 12,
  params,
});

const EDGES: readonly FixtureEdgeSpec[] = [
  { id: 'a', lengthM: 600, kappa: 0 },
  { id: 'b', lengthM: 800, kappa: 0 },
];

const bike = {
  contentId: 'base:bike',
  topSpeedMps: 38,
  accelMps2: 4.2,
  brakeMps2: 9,
  steerRateMps: 5.5,
  massKg: 180,
};
const PLAYER: SimRiderDef = {
  contentId: 'base:player-0',
  name: 'player 0',
  role: 'player',
  faction: 'rider',
  controller: { kind: 'player', slot: 0 },
  bike,
  massKg: 85,
  healthMax: 100,
};

function makeConfig(
  features: Record<string, readonly BakedFeature[]>,
  seed = 7,
  railsOn: readonly string[] = [],
): SimConfig {
  const b = fixtureNetwork(EDGES);
  const road = createRoadNetwork({
    network: b.network,
    roads: b.roads.map((r) => ({
      ...r,
      features: features[r.id] ?? [],
      barriers: railsOn.includes(r.id)
        ? [{ s0: 0, s1: r.lengthM, side: 'both' as const, kind: 'rail' as const, heightM: 1 }]
        : [],
    })),
  });
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 20, dir: 1 },
    finish: { road: 'b', s: 780 },
    mainPath: ['a', 'b'],
    allowedRoads: ['a', 'b'],
    closed: false,
  });
  return {
    seed,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 31,
      byPlaceCash: [100, 50],
      raceEndTimeoutTicks: 1800,
    },
    riders: [PLAYER],
    weapons: [],
    trafficTypes: WEIGHTED,
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)),
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

function spawn(config: SimConfig): World {
  const world = createWorld(config);
  addMover(world, 'rider', { edge: 0, s: 20, d: 1.7, dir: 1 }, 0);
  const systems: SimSystem[] = [ridersSystem, pedsSystem];
  for (const s of systems) s.init(world, config);
  return world;
}

/** Each pedestrian on an edge, as (type id, s, d, first wait), in spawn order. */
function onEdge(world: World, config: SimConfig, edge: number) {
  const st = pedsState(world);
  return st.id.flatMap((id, k) => {
    const m = world.movers[id];
    return m?.pos.edge === edge
      ? [[idOf(config, st.type[k] ?? -1), m.pos.s, m.pos.d, st.timer[k], st.crosses[k]]]
      : [];
  });
}

// ---- tests -------------------------------------------------------------------------------

describe('peds: zone-local kinds', () => {
  it('a zone with kinds spawns only those, even a kind the region gives weight 0', () => {
    for (const seed of [1, 2, 3]) {
      const config = makeConfig(
        { a: [zone('mallory', 300, 400, { spawns: 'pedestrians', kinds: ['street-performer'] })] },
        seed,
      );
      const world = spawn(config);
      const peds = onEdge(world, config, 0);
      expect(peds.length).toBe(4);
      expect(new Set(peds.map((p) => p[0]))).toEqual(new Set(['base:street-performer']));
    }
  });

  it('the control: the same zone without kinds never spawns the weight-0 kinds', () => {
    const seen = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const config = makeConfig({ a: [zone('mallory', 300, 400, { spawns: 'pedestrians' })] }, seed);
      for (const p of onEdge(spawn(config), config, 0)) seen.add(String(p[0]));
    }
    expect(seen.has('base:street-performer')).toBe(false);
    expect(seen.has('region-pnw:pod-diner')).toBe(false);
    expect(seen.has('base:tourist')).toBe(true);
  });

  it('ids match with or without the pack, kinds are equally likely, and an animal can be named', () => {
    const counts = new Map<string, number>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const config = makeConfig(
        {
          a: [zone('cart-pod', 300, 400, { kinds: ['region-pnw:pod-diner', 'chicken', 'street-performer'] })],
        },
        seed,
      );
      for (const p of onEdge(spawn(config), config, 0))
        counts.set(String(p[0]), (counts.get(String(p[0])) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([
      'base:chicken',
      'base:street-performer',
      'region-pnw:pod-diner',
    ]);
    // 32 spawns over 3 kinds, equally likely: each well above 4 and none more than 20.
    for (const n of counts.values()) {
      expect(n).toBeGreaterThan(4);
      expect(n).toBeLessThan(20);
    }
  });

  it('a zone with kinds moves no other zone: the next edge spawns the same as without it', () => {
    const other = zone('beach', 40, 100, { spawns: 'pedestrians' });
    for (const seed of [1, 2, 3]) {
      const withKinds = makeConfig(
        { a: [zone('mallory', 300, 400, { kinds: ['street-performer', 'pod-diner'] })], b: [other] },
        seed,
      );
      const without = makeConfig({ a: [], b: [other] }, seed);
      const a = onEdge(spawn(withKinds), withKinds, 1);
      const b = onEdge(spawn(without), without, 1);
      expect(a.length).toBeGreaterThan(0);
      expect(a).toEqual(b);
    }
  });

  it('is the same every run for a seed, and a different seed picks differently', () => {
    const features = {
      a: [zone('mallory', 300, 400, { kinds: ['street-performer', 'pod-diner', 'tourist'] })],
    };
    const run = (seed: number) => {
      const config = makeConfig(features, seed);
      return onEdge(spawn(config), config, 0);
    };
    expect(run(5)).toEqual(run(5));
    expect(run(6)).not.toEqual(run(5));
  });

  it('a zone naming no traffic type that exists spawns as any other zone does', () => {
    const config = makeConfig({
      a: [zone('typo', 300, 400, { spawns: 'pedestrians', kinds: ['no-such-kind', 7] })],
    });
    const world = spawn(config);
    const peds = onEdge(world, config, 0);
    expect(peds.length).toBe(4);
    for (const p of peds) expect(['base:tourist', 'base:chicken']).toContain(p[0]);
  });

  it('a car named in kinds is not a pedestrian: it is ignored', () => {
    const config = makeConfig({ a: [zone('odd', 300, 400, { kinds: ['car', 'street-performer'] })] });
    const peds = onEdge(spawn(config), config, 0);
    expect(new Set(peds.map((p) => p[0]))).toEqual(new Set(['base:street-performer']));
  });

  it('on a railed stretch (a bridge walkway) an animal in kinds is left out: people only', () => {
    for (const seed of [1, 2, 3, 4]) {
      const config = makeConfig({ a: [zone('pier', 300, 400, { kinds: ['chicken', 'pod-diner'] })] }, seed, [
        'a',
      ]);
      const peds = onEdge(spawn(config), config, 0);
      expect(peds.length).toBeGreaterThan(0);
      expect(new Set(peds.map((p) => p[0]))).toEqual(new Set(['region-pnw:pod-diner']));
    }
  });
});
