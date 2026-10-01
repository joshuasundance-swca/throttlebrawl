// M3 traffic-4 (head start), the animal half (docs/milestones/M3.md, "traffic-4 · Animals and
// wasteland oddities"):
//   - animals spawn from the race seed: the same seed gives the same animals in the same places,
//     another seed a different set;
//   - no animal stands on a bridge walkway (a rail on either side, or a `bridge` tag): those
//     spawns are people only, so the fisherman stays and the chicken does not;
//   - a kind with no walking speed (the gator on a lawn chair) never crosses;
//   - every threatened animal dives clear, and nobody touches a small one;
//   - a big kind (the gator) is never lured out at the worst moment; with `peds.bigReactScale` at
//     its default it dives like anyone else, and turned down it dives late, gets hit, and the
//     rider crashes;
//   - the `peds.strayAnimalChance` slider sets how many zone spawns are animals.
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
import type { SimConfig, SimEvent, SimInput, SimRiderDef, SimTrafficTypeDef } from '../types';
import { addMover, createWorld, stepWorld, type SimSystem, type World } from '../world';
import {
  kindThreatRangeM,
  onBridgeWalkway,
  pedInfo,
  PEDS,
  pedsState,
  pedsSystem,
  pedThreatRangeM,
  placePed,
} from './index';

const TOURIST: SimTrafficTypeDef = {
  contentId: 'base:tourist',
  category: 'pedestrian',
  lengthM: 0.5,
  widthM: 0.5,
  cruiseMps: 1.4,
  hazard: 'normal',
};
const CHICKEN: SimTrafficTypeDef = {
  contentId: 'base:chicken',
  category: 'animal',
  lengthM: 0.4,
  widthM: 0.3,
  cruiseMps: 2.2,
  hazard: 'normal',
};
const IGUANA: SimTrafficTypeDef = {
  contentId: 'base:iguana',
  category: 'animal',
  lengthM: 0.9,
  widthM: 0.3,
  cruiseMps: 1.2,
  hazard: 'normal',
};
const GATOR: SimTrafficTypeDef = {
  contentId: 'base:gator',
  category: 'animal',
  lengthM: 2.4,
  widthM: 0.6,
  cruiseMps: 0.5,
  hazard: 'big',
};
const LAWN_CHAIR: SimTrafficTypeDef = {
  contentId: 'base:gator-on-lawn-chair',
  category: 'animal',
  lengthM: 1.4,
  widthM: 0.8,
  cruiseMps: 0,
  hazard: 'big',
};

const zone = (id: string, s0: number, s1: number, side: 1 | -1, spawns = 'animals'): BakedFeature => ({
  kind: 'roadsideZone',
  id,
  s0,
  s1,
  d0: side * 5,
  d1: side * 12,
  params: { spawns },
});

const EDGES: readonly FixtureEdgeSpec[] = [
  { id: 'a', lengthM: 600, kappa: 0 },
  { id: 'b', lengthM: 800, kappa: 1 / 300 },
];

interface Opts {
  features?: Record<string, readonly BakedFeature[]>;
  railsOn?: readonly string[];
  bridgeOn?: readonly string[];
  types?: readonly SimTrafficTypeDef[];
  seed?: number;
  tuning?: Record<string, number>;
}

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
  name: 'player',
  role: 'player',
  faction: 'rider',
  controller: { kind: 'player', slot: 0 },
  bike,
  massKg: 85,
  healthMax: 100,
};

function makeConfig(o: Opts = {}): SimConfig {
  const b = fixtureNetwork(EDGES);
  const features = o.features ?? {
    a: [zone('a1', 100, 200, 1), zone('a2', 300, 400, -1, 'pedestrians')],
    b: [zone('b1', 200, 300, -1), zone('b2', 500, 600, 1)],
  };
  const road = createRoadNetwork({
    network: b.network,
    roads: b.roads.map((r) => ({
      ...r,
      features: features[r.id] ?? [],
      barriers: (o.railsOn ?? []).includes(r.id)
        ? [{ s0: 0, s1: r.lengthM, side: 'both' as const, kind: 'rail' as const, heightM: 1 }]
        : [],
      tags: (o.bridgeOn ?? []).includes(r.id)
        ? [{ s0: 0, s1: r.lengthM, side: 'both' as const, tag: 'bridge' }]
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
    seed: o.seed ?? 3,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 31,
      byPlaceCash: [100, 50],
      raceEndTimeoutTicks: 1800,
    },
    riders: [PLAYER],
    weapons: [],
    trafficTypes: o.types ?? [TOURIST, CHICKEN, IGUANA, GATOR, LAWN_CHAIR],
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: { ...tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)), ...(o.tuning ?? {}) },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

const SCENARIO: SimSystem[] = [ridersSystem, pedsSystem];
const cruise: SimInput = { steer: 0, throttle: 255, brake: 0, flags: 0 };
const coast: SimInput = { steer: 0, throttle: 0, brake: 0, flags: 0 };

function scenario(config: SimConfig, r: { s: number; d: number; speed: number; edge?: number }): World {
  const world = createWorld(config);
  const m = addMover(world, 'rider', { edge: r.edge ?? 0, s: r.s, d: r.d, dir: 1 }, 0);
  m.speed = r.speed;
  for (const s of SCENARIO) s.init(world, config);
  return world;
}

/** Every pedestrian's kind, edge, s and d, in spawn order. */
function roster(world: World, config: SimConfig): string[] {
  const st = pedsState(world);
  return st.id.map((id) => {
    const m = world.movers[id];
    const kind = pedInfo(world, config, id)?.contentId ?? '?';
    return `${kind}@${m?.pos.edge}:${m?.pos.s.toFixed(3)}/${m?.pos.d.toFixed(3)}`;
  });
}

function animals(world: World, config: SimConfig): number[] {
  return pedsState(world).id.filter((id) => pedInfo(world, config, id)?.category === 'animal');
}

describe('traffic-4: animals spawn from the race seed', () => {
  it('the same seed gives the same animals in the same places; another seed does not', () => {
    const at = (seed: number) => {
      const config = makeConfig({ seed });
      return roster(scenario(config, { s: 20, d: 1.7, speed: 0 }), config);
    };
    const a = at(3);
    const kinds = new Set(a.map((x) => x.split('@')[0]));
    console.log(`[examined] seed 3: ${a.length} spawns, kinds ${[...kinds].join(', ')}`);
    expect(a.length).toBeGreaterThan(8);
    expect(at(3)).toEqual(a);
    expect(at(4)).not.toEqual(a);
    // The animals zones gave animals of more than one kind.
    expect([...kinds].filter((k) => k !== 'base:tourist').length).toBeGreaterThan(1);
  });

  it('pedInfo names a pedestrian kind, and nothing for other entities', () => {
    const config = makeConfig();
    const world = scenario(config, { s: 20, d: 1.7, speed: 0 });
    const id = pedsState(world).id[0] ?? -1;
    expect(pedInfo(world, config, id)?.contentId).toMatch(/^base:/);
    expect(pedInfo(world, config, 0)).toBeNull(); // the rider
  });
});

describe('traffic-4: no animal on a bridge walkway', () => {
  for (const how of ['rail', 'bridge tag'] as const) {
    it(`a ${how} turns an animal zone's spawns into people, and with no people into nothing`, () => {
      const opts: Opts = how === 'rail' ? { railsOn: ['a'] } : { bridgeOn: ['a'] };
      const config = makeConfig(opts);
      const world = scenario(config, { s: 20, d: 1.7, speed: 0 });
      expect(onBridgeWalkway(config.road, 0, 150)).toBe(true);
      expect(onBridgeWalkway(config.road, 1, 250)).toBe(false);
      const onA = pedsState(world).id.filter((id) => world.movers[id]?.pos.edge === 0);
      const kindsOnA = onA.map((id) => pedInfo(world, config, id)?.category);
      console.log(`[examined] ${how}: ${onA.length} spawns on the walkway edge: ${kindsOnA.join(', ')}`);
      expect(onA.length).toBeGreaterThan(0);
      expect(kindsOnA.every((c) => c === 'pedestrian')).toBe(true);
      // Off the walkway, the animal zones still give animals.
      expect(animals(world, config).length).toBeGreaterThan(0);
      // With no people in the region, the walkway gets nobody at all.
      const bare = makeConfig({ ...opts, types: [CHICKEN, IGUANA, GATOR] });
      const w2 = scenario(bare, { s: 20, d: 1.7, speed: 0 });
      expect(pedsState(w2).id.filter((id) => w2.movers[id]?.pos.edge === 0)).toEqual([]);
    });
  }

  it('across 20 seeds, every animal stands inside a roadside zone and none on a walkway', () => {
    let seen = 0;
    const bad: string[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const config = makeConfig({ seed, railsOn: ['b'] });
      const world = scenario(config, { s: 20, d: 1.7, speed: 0 });
      for (const id of animals(world, config)) {
        seen++;
        const m = world.movers[id];
        if (!m) continue;
        const inZone = config.road
          .featuresOf(m.pos.edge, 'roadsideZone')
          .some((f) => m.pos.s >= f.s0 && m.pos.s <= f.s1 && Math.sign(m.pos.d) === Math.sign(f.d0 + f.d1));
        if (!inZone) bad.push(`seed ${seed} entity ${id}: outside every zone`);
        if (onBridgeWalkway(config.road, m.pos.edge, m.pos.s))
          bad.push(`seed ${seed} entity ${id}: on a walkway`);
      }
    }
    console.log(`[examined] 20 seeds: ${seen} animals checked, ${bad.length} misplaced`);
    expect(seen).toBeGreaterThan(40);
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

describe('traffic-4: how animals behave', () => {
  it('a kind with no walking speed never crosses, and a big kind is never lured', () => {
    let chairs = 0;
    let gators = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const config = makeConfig({ seed });
      const world = scenario(config, { s: 20, d: 1.7, speed: 0 });
      const st = pedsState(world);
      st.id.forEach((id, k) => {
        const kind = pedInfo(world, config, id)?.contentId;
        if (kind === LAWN_CHAIR.contentId) {
          chairs++;
          expect(st.crosses[k]).toBe(0);
        }
        if (kind === GATOR.contentId || kind === LAWN_CHAIR.contentId) {
          gators++;
          expect(st.lure[k]).toBe(0);
        }
      });
      // And the lawn chair stays put through a minute of race time.
      const before = st.id.map((id) => world.movers[id]?.pos.d);
      for (let t = 0; t < 3600; t++) stepWorld(world, config, SCENARIO, [coast]);
      st.id.forEach((id, k) => {
        if (pedInfo(world, config, id)?.contentId === LAWN_CHAIR.contentId)
          expect(world.movers[id]?.pos.d).toBe(before[k]);
      });
    }
    console.log(`[examined] 10 seeds: ${chairs} lawn-chair gators, ${gators} big animals`);
    expect(chairs).toBeGreaterThan(0);
  });

  it('every small animal in a rider’s path dives clear; nobody touches it', () => {
    for (const type of [1, 2]) {
      const config = makeConfig({ features: {} });
      const world = scenario(config, { s: 200, d: 1.7, speed: 35 });
      const pedId = placePed(world, config, { type, edge: 0, s: 320, d: 1.7 });
      const events: SimEvent[] = [];
      for (let t = 0; t < 60 * 6; t++) events.push(...stepWorld(world, config, SCENARIO, [cruise]));
      const dive = events.find((e) => e.type === 'pedDive' && e.actor === pedId);
      expect(dive?.data['bumped']).toBe(false);
      expect(pedsState(world).contacts).toBe(0);
    }
  });

  it('a gator dives like anyone at the default reaction; turned down, it is hit and you crash', () => {
    const run = (scale: number | undefined) => {
      const config = makeConfig({
        features: {},
        tuning: scale === undefined ? {} : { 'peds.bigReactScale': scale },
      });
      const world = scenario(config, { s: 200, d: 1.7, speed: 35 });
      const pedId = placePed(world, config, { type: 3, edge: 0, s: 320, d: 1.7 });
      const events: SimEvent[] = [];
      for (let t = 0; t < 60 * 6; t++) events.push(...stepWorld(world, config, SCENARIO, [cruise]));
      const dive = events.find((e) => e.type === 'pedDive' && e.actor === pedId);
      const crash = events.find((e) => e.type === 'crash' && e.target === pedId);
      return { world, dive, crash, rangeM: Number(dive?.data['rangeM'] ?? NaN) };
    };
    const normal = run(undefined);
    expect(normal.dive?.data['bumped']).toBe(false);
    expect(normal.crash).toBeUndefined();
    const late = run(0.05);
    console.log(
      `[examined] gator at 35 m/s: default dives with no contact; at scale 0.05 ` +
        `${late.crash ? 'crashes the rider' : 'no crash'} (its dive started ${late.dive ? 'late' : 'never'})`,
    );
    expect(late.crash?.data['cause']).toBe('ped');
    expect(late.crash?.data['hazard']).toBe('big');
    // It still dives (late, so the rider clips it): a cartoon lunge, no gore.
    expect(late.dive).toBeDefined();
  });

  it('kindThreatRangeM: small kinds keep the normal range; big kinds scale with the slider', () => {
    const config = makeConfig({ features: {}, tuning: { 'peds.bigReactScale': 0.5 } });
    const world = scenario(config, { s: 20, d: 1.7, speed: 0 });
    expect(kindThreatRangeM(world, CHICKEN, 30)).toBe(pedThreatRangeM(30));
    expect(kindThreatRangeM(world, GATOR, 30)).toBeCloseTo(0.5 * pedThreatRangeM(30), 9);
    const dflt = scenario(makeConfig({ features: {} }), { s: 20, d: 1.7, speed: 0 });
    expect(kindThreatRangeM(dflt, GATOR, 30)).toBe(pedThreatRangeM(30));
    expect(PEDS.bigReactScale).toBe(1);
  });

  it('peds.strayAnimalChance sets the share of animals in a pedestrians zone', () => {
    const count = (chance: number) => {
      let a = 0;
      let all = 0;
      for (let seed = 1; seed <= 10; seed++) {
        const config = makeConfig({
          seed,
          features: {
            a: [zone('p', 100, 200, 1, 'pedestrians')],
            b: [zone('q', 100, 200, -1, 'pedestrians')],
          },
          tuning: { 'peds.strayAnimalChance': chance },
        });
        const world = scenario(config, { s: 20, d: 1.7, speed: 0 });
        a += animals(world, config).length;
        all += pedsState(world).id.length;
      }
      return { a, all };
    };
    const none = count(0);
    const every = count(1);
    console.log(`[examined] stray chance 0: ${none.a}/${none.all} animals; 1: ${every.a}/${every.all}`);
    expect(none.a).toBe(0);
    expect(every.a).toBe(every.all);
    expect(every.all).toBeGreaterThan(0);
  });
});
