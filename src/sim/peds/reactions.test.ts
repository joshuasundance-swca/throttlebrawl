// W-P "fill the world" (maintainer, 2026-10-01b: "pedestrians, cyclists, joggers, dogs, life that
// reacts to the player"):
//   - a stroller (jogger, hiker, dog walker) walks the verge back and forth inside its zone, off
//     the road, and never crosses;
//   - a fast rider passing close makes a person hop back from the kerb (`pedReact` jumpBack);
//     further out, some shake a fist or film; someone scared into a dive does that once up;
//   - a kerb rider on the shoulder makes people on the verge hop back, never dive;
//   - a dog chases a passing rider a short way along the verge, never onto the road, and trots back;
//   - nobody is touched, and the same seed replays to the same hashes.
import { describe, expect, it } from 'vitest';
import { tuningDefaults } from '../../core';
import {
  createRoadNetwork,
  createRouteProgress,
  fixtureNetwork,
  type BakedFeature,
  type FixtureEdgeSpec,
} from '../../road';
import { createSim, SIM_TUNING } from '../create';
import { ridersSystem } from '../riders';
import { placeVehicle, trafficState, trafficSystem } from '../traffic';
import type { SimConfig, SimEvent, SimInput, SimRiderDef, SimTrafficTypeDef } from '../types';
import { addMover, createWorld, stepWorld, type SimSystem, type World } from '../world';
import { PED_PHASE, PEDS, pedsState, pedsSystem, placePed } from './index';

// ---- fixtures ----------------------------------------------------------------------------

const TOURIST: SimTrafficTypeDef = {
  contentId: 'base:tourist',
  category: 'pedestrian',
  lengthM: 0.5,
  widthM: 0.5,
  cruiseMps: 1.4,
  hazard: 'normal',
};
const JOGGER: SimTrafficTypeDef = {
  contentId: 'base:jogger',
  category: 'pedestrian',
  lengthM: 0.5,
  widthM: 0.5,
  cruiseMps: 3,
  hazard: 'normal',
  behaviour: { strolls: true },
};
const DOG: SimTrafficTypeDef = {
  contentId: 'base:dog',
  category: 'animal',
  lengthM: 0.9,
  widthM: 0.35,
  cruiseMps: 6.5,
  hazard: 'normal',
  behaviour: { chases: true },
};
const CAR: SimTrafficTypeDef = {
  contentId: 'base:car',
  category: 'car',
  lengthM: 4.6,
  widthM: 1.8,
  cruiseMps: 24.6,
  hazard: 'normal',
};
const EBIKE: SimTrafficTypeDef = {
  contentId: 'sf:e-bike',
  category: 'car',
  lengthM: 1.8,
  widthM: 0.7,
  cruiseMps: 8,
  hazard: 'normal',
  behaviour: { kerb: true },
};
// Types by index: 0 car, 1 tourist, 2 jogger, 3 dog, 4 e-bike.
const TYPES = [CAR, TOURIST, JOGGER, DOG, EBIKE];

const ZONE: BakedFeature = {
  kind: 'roadsideZone',
  id: 'boardwalk',
  s0: 300,
  s1: 400,
  d0: 5,
  d1: 12,
  params: { spawns: 'pedestrians' },
};
const EDGES: readonly FixtureEdgeSpec[] = [
  { id: 'a', lengthM: 600, kappa: 0 },
  { id: 'b', lengthM: 800, kappa: 1 / 300 },
];
/** The fixture road's outer edge: the 1.5 m shoulder outside the 3.4 m lane ends at d 4.9. */
const ROAD_EDGE_D = 4.9;

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
    faction: role === 'cop' ? 'law' : 'rider',
    controller:
      role === 'player'
        ? { kind: 'player', slot: 0 }
        : role === 'cop'
          ? { kind: 'cop' }
          : { kind: 'ai', style: 'racer' },
    bike,
    massKg: 85,
    healthMax: 100,
  };
}
const SOLO = [rider('player', 0)];

function makeConfig(
  o: { features?: Record<string, readonly BakedFeature[]>; seed?: number; types?: SimTrafficTypeDef[] } = {},
): SimConfig {
  const b = fixtureNetwork(EDGES);
  const features = o.features ?? { a: [ZONE] };
  const road = createRoadNetwork({
    network: b.network,
    roads: b.roads.map((r) => ({ ...r, features: features[r.id] ?? [] })),
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
    seed: o.seed ?? 7,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 31,
      byPlaceCash: [100, 50],
      raceEndTimeoutTicks: 1800,
    },
    riders: SOLO,
    weapons: [],
    trafficTypes: o.types ?? TYPES,
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

const PEDS_ONLY: SimSystem[] = [ridersSystem, pedsSystem];
const WITH_TRAFFIC: SimSystem[] = [ridersSystem, trafficSystem, pedsSystem];

function scenario(
  config: SimConfig,
  r: { s: number; d: number; speed: number },
  systems: SimSystem[] = PEDS_ONLY,
): World {
  const world = createWorld(config);
  const m = addMover(world, 'rider', { edge: 0, s: r.s, d: r.d, dir: 1 }, 0);
  m.speed = r.speed;
  for (const s of systems) s.init(world, config);
  return world;
}
const cruise: SimInput = { steer: 0, throttle: 255, brake: 0, flags: 0 };
const still: SimInput = { steer: 0, throttle: 0, brake: 255, flags: 0 };

function touches(world: World, config: SimConfig, pedId: number): boolean {
  const st = pedsState(world);
  const t = config.trafficTypes[st.type[st.id.indexOf(pedId)] ?? -1];
  const r = world.movers[0];
  const p = world.movers[pedId];
  if (!t || !r || !p || r.pos.edge !== p.pos.edge) return false;
  return (
    Math.abs(p.pos.s - r.pos.s) < (PEDS.riderLengthM + t.lengthM) / 2 &&
    Math.abs(p.pos.d - r.pos.d) < (PEDS.riderWidthM + t.widthM) / 2
  );
}

/** Rides the lone rider past one pedestrian of `type` standing on the verge at s 300. */
function pass(type: number, riderD: number, seed = 7, speed = 35) {
  const config = makeConfig({ features: {}, seed });
  const world = scenario(config, { s: 200, d: riderD, speed });
  const pedId = placePed(world, config, { type, edge: 0, s: 300, d: 5.75, s0: 280, s1: 320 });
  const startD = world.movers[pedId]?.pos.d ?? 0;
  const events: SimEvent[] = [];
  let touched = false;
  let peakH = 0;
  const path: { s: number; d: number }[] = [];
  for (let t = 0; t < 60 * 10; t++) {
    events.push(...stepWorld(world, config, PEDS_ONLY, [t < 60 * 5 ? cruise : still]));
    touched ||= touches(world, config, pedId);
    const p = world.movers[pedId];
    peakH = Math.max(peakH, p?.h ?? 0);
    if (p) path.push({ s: p.pos.s, d: p.pos.d });
  }
  const mine = events.filter((e) => e.actor === pedId);
  return { world, config, pedId, startD, mine, touched, peakH, path };
}

// ---- tests -------------------------------------------------------------------------------

describe('W-P strollers', () => {
  it('a jogger runs the verge back and forth inside its zone, off the road, and never crosses', () => {
    const config = makeConfig({ types: [CAR, JOGGER] });
    const world = scenario(config, { s: 30, d: -1.7, speed: 0 });
    const st = pedsState(world);
    expect(st.id.length).toBeGreaterThan(0);
    let minS = Infinity;
    let maxS = -Infinity;
    let minD = Infinity;
    let turns = 0;
    const lastWay = new Map<number, number>();
    for (let t = 0; t < 60 * 90; t++) {
      const before = st.id.map((id) => world.movers[id]?.pos.s ?? 0);
      stepWorld(world, config, PEDS_ONLY, [still]);
      st.id.forEach((id, k) => {
        const p = world.movers[id];
        if (!p) return;
        minS = Math.min(minS, p.pos.s);
        maxS = Math.max(maxS, p.pos.s);
        minD = Math.min(minD, p.pos.d);
        const way = Math.sign(p.pos.s - (before[k] ?? 0));
        if (way !== 0) {
          if ((lastWay.get(id) ?? way) !== way) turns++;
          lastWay.set(id, way);
        }
        expect(st.phase[k] === PED_PHASE.walk, 'a stroller never crosses').toBe(false);
      });
    }
    console.log(
      `strollers: ${st.id.length}, s ${minS.toFixed(1)} to ${maxS.toFixed(1)}, nearest d ${minD.toFixed(2)}, ${turns} turns`,
    );
    expect(minS).toBeGreaterThanOrEqual(ZONE.s0);
    expect(maxS).toBeLessThanOrEqual(ZONE.s1);
    expect(maxS - minS).toBeGreaterThan(60);
    expect(minD).toBeGreaterThan(ROAD_EDGE_D + PEDS.offRoadMarginM);
    expect(turns).toBeGreaterThan(0);
  });
});

describe('W-P reactions to a passing rider', () => {
  it('a rider passing close outside the dive band makes a person hop back from the kerb', () => {
    // The person stands at d 5.75; a rider at d 3.0 passes 2.75 m to the side: outside the dive
    // band (2.25 m) and inside the hop band (2.25 + 1.5 m).
    const r = pass(1, 3.0);
    const hop = r.mine.find((e) => e.type === 'pedReact' && e.data['kind'] === 'jumpBack');
    expect(hop?.target).toBe(0);
    expect(r.mine.some((e) => e.type === 'pedDive')).toBe(false);
    expect(r.touched).toBe(false);
    expect(r.peakH).toBeGreaterThan(0.1);
    // It landed further from the road than it stood.
    expect(Math.max(...r.path.map((q) => q.d))).toBeGreaterThanOrEqual(r.startD + PEDS.hopDistM - 1e-9);
  });

  it('further out, some shake a fist and some film; nobody dives or is touched', () => {
    const kinds: string[] = [];
    for (let seed = 1; seed <= 24; seed++) {
      // 4.05 m to the side: outside the hop band, inside the reaction band.
      const r = pass(1, 1.7, seed);
      expect(r.mine.some((e) => e.type === 'pedDive')).toBe(false);
      expect(r.touched).toBe(false);
      for (const e of r.mine) if (e.type === 'pedReact') kinds.push(String(e.data['kind']));
    }
    console.log(
      `24 passes at 4 m: ${kinds.filter((k) => k === 'fist').length} fists, ${kinds.filter((k) => k === 'film').length} phones`,
    );
    expect(kinds).toContain('fist');
    expect(kinds).toContain('film');
    expect(kinds.every((k) => k === 'fist' || k === 'film')).toBe(true);
  });

  it('someone a rider scared into a dive gets up and shakes a fist or films at that rider', () => {
    let reacted = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const config = makeConfig({ features: {}, seed });
      const world = scenario(config, { s: 200, d: 1.7, speed: 38 });
      const pedId = placePed(world, config, { type: 1, edge: 0, s: 300, d: 1.7 });
      const events: SimEvent[] = [];
      for (let t = 0; t < 60 * 8; t++) events.push(...stepWorld(world, config, PEDS_ONLY, [cruise]));
      const dive = events.findIndex((e) => e.type === 'pedDive' && e.actor === pedId);
      const gesture = events.findIndex(
        (e) =>
          e.type === 'pedReact' && e.actor === pedId && ['fist', 'film'].includes(String(e.data['kind'])),
      );
      expect(dive).toBeGreaterThanOrEqual(0);
      if (gesture >= 0) {
        expect(gesture).toBeGreaterThan(dive);
        expect(events[gesture]?.target).toBe(0);
        reacted++;
      }
      expect(pedsState(world).contacts).toBe(0);
    }
    console.log(`scared into a dive: ${reacted} of 12 reacted once up`);
    expect(reacted).toBeGreaterThan(3);
    expect(reacted).toBeLessThan(12);
  });

  it('a kerb rider on the shoulder makes people on the verge hop back, never dive', () => {
    const config = makeConfig({ features: {} });
    const world = scenario(config, { s: 30, d: -1.7, speed: 0 }, WITH_TRAFFIC);
    const pedId = placePed(world, config, { type: 1, edge: 0, s: 300, d: 5.75 });
    const slot = placeVehicle(world, config, { type: 4, u: 240, dir: 1 });
    const bikeId = trafficState(world).id[slot] ?? -1;
    const events: SimEvent[] = [];
    for (let t = 0; t < 60 * 14; t++) events.push(...stepWorld(world, config, WITH_TRAFFIC, [still]));
    const mine = events.filter((e) => e.actor === pedId);
    expect(world.movers[bikeId]?.pos.s ?? 0).toBeGreaterThan(310);
    expect(mine.some((e) => e.type === 'pedDive')).toBe(false);
    const hop = mine.find((e) => e.type === 'pedReact' && e.data['kind'] === 'jumpBack');
    expect(hop?.target).toBe(bikeId);
    expect(pedsState(world).vehicleContacts).toBe(0);
  });

  it('a dog chases a passing rider along the verge, never onto the road, then trots back', () => {
    const r = pass(3, 1.7, 7, 30);
    const chase = r.mine.find((e) => e.type === 'pedReact' && e.data['kind'] === 'chase');
    expect(chase?.target).toBe(0);
    const ss = r.path.map((q) => q.s);
    const furthest = Math.max(...ss);
    console.log(
      `dog: chased to s ${furthest.toFixed(1)} from 300, ended at s ${ss[ss.length - 1]?.toFixed(1)}, ` +
        `nearest d ${Math.min(...r.path.map((q) => q.d)).toFixed(2)}`,
    );
    // It ran the rider's way (growing s) about chaseS at its pace, inside its zone (280 to 320).
    expect(furthest).toBeGreaterThan(300 + 0.5 * DOG.cruiseMps * PEDS.chaseS);
    expect(furthest).toBeLessThanOrEqual(320);
    // Back home, and never on the road.
    expect(Math.abs((ss[ss.length - 1] ?? 0) - 300)).toBeLessThan(0.5);
    expect(Math.min(...r.path.map((q) => q.d))).toBeGreaterThan(ROAD_EDGE_D);
    expect(r.touched).toBe(false);
  });
});

describe('W-P determinism', () => {
  it('the same seed replays to the same hashes with strollers, dogs and reactions', () => {
    const run = (seed: number) => {
      const sim = createSim(makeConfig({ seed, types: [CAR, TOURIST, JOGGER, DOG] }));
      const hashes: number[] = [];
      let reacts = 0;
      for (let t = 0; t < 60 * 40; t++) {
        sim.step([{ steer: Math.round(Math.sin(t / 90) * 30), throttle: 255, brake: 0, flags: 0 }]);
        if (t % 60 === 0) hashes.push(sim.hash());
        reacts += sim.events().filter((e) => e.type === 'pedReact').length;
      }
      return { hashes, reacts };
    };
    const a = run(3);
    const b = run(3);
    expect(b.hashes).toEqual(a.hashes);
    expect(b.reacts).toBe(a.reacts);
    expect(run(4).hashes).not.toEqual(a.hashes);
  });
});
