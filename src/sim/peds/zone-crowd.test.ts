// Playtest 4 (P4-16, "Duval St should be a party street"): a `roadsideZone` may carry `params.everyM`
// (metres of kerb per person) and `params.maxPeds`, so a street's party zone is a crowd (a person
// every 8 m, up to ten) where an ordinary zone is a few people (one per 25 m, at most four). The
// rule: a crowd zone spawns more people, inside its own stretch and off the road; a bad number is
// ignored and an ordinary zone is exactly what it was.
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
import { PEDS, pedsState, pedsSystem } from './index';

const person = (contentId: string): SimTrafficTypeDef => ({
  contentId,
  category: 'pedestrian',
  lengthM: 0.5,
  widthM: 0.5,
  cruiseMps: 1.2,
  hazard: 'normal',
  weight: 0,
});
const TYPES: readonly SimTrafficTypeDef[] = [person('base:bar-hopper'), person('base:birthday-party')];

const zone = (id: string, s0: number, s1: number, params: Record<string, unknown>): BakedFeature => ({
  kind: 'roadsideZone',
  id,
  s0,
  s1,
  d0: 5.6,
  d1: 11,
  params,
});

const EDGES: readonly FixtureEdgeSpec[] = [
  { id: 'a', lengthM: 600, kappa: 0 },
  { id: 'b', lengthM: 800, kappa: 0 },
];

const PLAYER: SimRiderDef = {
  contentId: 'base:player-0',
  name: 'player 0',
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

function makeConfig(features: Record<string, readonly BakedFeature[]>, seed = 7): SimConfig {
  const b = fixtureNetwork(EDGES);
  const road = createRoadNetwork({
    network: b.network,
    roads: b.roads.map((r) => ({ ...r, features: features[r.id] ?? [], barriers: [] })),
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
    trafficTypes: TYPES,
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

/** Each pedestrian on edge 0, as [s, d]. */
function people(world: World): [number, number][] {
  const st = pedsState(world);
  return st.id.flatMap((id) => {
    const m = world.movers[id];
    return m?.pos.edge === 0 ? [[m.pos.s, m.pos.d] as [number, number]] : [];
  });
}

describe('peds: a crowd zone (everyM, maxPeds)', () => {
  it('spawns a person every everyM metres, up to maxPeds, inside the zone and off the road', () => {
    for (const seed of [1, 2, 3]) {
      const config = makeConfig(
        { a: [zone('party', 200, 300, { kinds: ['bar-hopper'], everyM: 8, maxPeds: 10 })] },
        seed,
      );
      const list = people(spawn(config));
      expect(list.length).toBe(10);
      for (const [s, d] of list) {
        expect(s).toBeGreaterThanOrEqual(200);
        expect(s).toBeLessThanOrEqual(300);
        // Off the drivable road (the fixture's lanes end well inside 4 m), on the zone's side.
        expect(d).toBeGreaterThan(4);
      }
    }
  });

  it('a shorter zone holds fewer: the count follows the length, not only the cap', () => {
    const config = makeConfig({
      a: [zone('short', 200, 240, { kinds: ['bar-hopper'], everyM: 8, maxPeds: 10 })],
    });
    expect(people(spawn(config)).length).toBe(5);
  });

  it('an ordinary zone is as it was: one per perZoneM, at most four', () => {
    const config = makeConfig({ a: [zone('plain', 200, 400, { kinds: ['bar-hopper'] })] });
    expect(people(spawn(config)).length).toBe(Math.min(PEDS.maxPerZone, Math.floor(200 / PEDS.perZoneM)));
  });

  it('a bad everyM or maxPeds is ignored, and a crowd stays inside a hard ceiling', () => {
    const plain = people(spawn(makeConfig({ a: [zone('p', 200, 300, { kinds: ['bar-hopper'] })] }))).length;
    for (const params of [
      { everyM: 'often', maxPeds: 'many' },
      { everyM: -3, maxPeds: -1 },
      { everyM: Number.NaN, maxPeds: Number.NaN },
    ]) {
      const config = makeConfig({ a: [zone('p', 200, 300, { kinds: ['bar-hopper'], ...params })] });
      expect(people(spawn(config)).length, JSON.stringify(params)).toBe(plain);
    }
    // A tiny everyM and a huge cap cannot flood a road.
    const flood = makeConfig({
      a: [zone('flood', 0, 600, { kinds: ['bar-hopper'], everyM: 0.1, maxPeds: 100000 })],
    });
    const n = people(spawn(flood)).length;
    expect(n).toBeGreaterThan(PEDS.maxPerZone);
    expect(n).toBeLessThanOrEqual(PEDS.maxCrowd);
  });

  it('moves no other zone: the next edge spawns the same with or without the crowd', () => {
    const other = zone('beach', 40, 100, { kinds: ['birthday-party'] });
    for (const seed of [1, 2, 3]) {
      const withCrowd = makeConfig(
        { a: [zone('party', 200, 300, { kinds: ['bar-hopper'], everyM: 8, maxPeds: 10 })], b: [other] },
        seed,
      );
      const without = makeConfig({ a: [], b: [other] }, seed);
      const onB = (world: World) => {
        const st = pedsState(world);
        return st.id.flatMap((id) => {
          const m = world.movers[id];
          return m?.pos.edge === 1 ? [[m.pos.s, m.pos.d]] : [];
        });
      };
      const a = onB(spawn(withCrowd));
      expect(a.length).toBeGreaterThan(0);
      expect(a).toEqual(onB(spawn(without)));
    }
  });
});
