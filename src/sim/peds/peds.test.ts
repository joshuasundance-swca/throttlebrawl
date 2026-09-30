// traffic-2 acceptance, scripted half (docs/milestones/M1.md, "traffic-2 · Pedestrians"):
//   - pedestrians spawn from roadsideZone features, and cross or loiter;
//   - a threat range that grows with the rider's speed triggers a dive (a short scripted arc to
//     the side) and a `pedDive` event;
//   - riders and pedestrians never make contact, and every threatened pedestrian dives;
//   - hitting something big crashes you;
//   - a scripted run gives the same hash every run.
// The 50-race half lives in tests/sim/peds-batch.test.ts.
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
import { placeVehicle, trafficSystem } from '../traffic';
import { ridersSystem } from '../riders';
import type { SimConfig, SimEvent, SimInput, SimRiderDef, SimTrafficTypeDef } from '../types';
import { addMover, createWorld, stepWorld, type SimSystem, type World } from '../world';
import { PED_PHASE, PEDS, pedsState, pedsSystem, pedThreatRangeM, placePed } from './index';

// ---- fixtures ----------------------------------------------------------------------------

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
  lengthM: 0.35,
  widthM: 0.3,
  cruiseMps: 2.2,
  hazard: 'normal',
};
const GATOR: SimTrafficTypeDef = {
  contentId: 'base:gator',
  category: 'animal',
  lengthM: 2.4,
  widthM: 0.6,
  cruiseMps: 0.8,
  hazard: 'big',
};
const CAR: SimTrafficTypeDef = {
  contentId: 'base:car',
  category: 'car',
  lengthM: 4.6,
  widthM: 1.8,
  cruiseMps: 24.6,
  hazard: 'normal',
};

const ZONE: BakedFeature = {
  kind: 'roadsideZone',
  id: 'boardwalk',
  s0: 300,
  s1: 400,
  d0: 5,
  d1: 12,
  params: { spawns: 'pedestrians' },
};
const LEFT_ZONE: BakedFeature = {
  kind: 'roadsideZone',
  id: 'beach',
  s0: 600,
  s1: 660,
  d0: -14,
  d1: -5,
  params: { spawns: 'pedestrians' },
};

const EDGES: readonly FixtureEdgeSpec[] = [
  { id: 'a', lengthM: 600, kappa: 0 },
  { id: 'b', lengthM: 800, kappa: 1 / 300 },
];

interface Opts {
  features?: Record<string, readonly BakedFeature[]>;
  railsOn?: readonly string[];
  types?: readonly SimTrafficTypeDef[];
  riders?: readonly SimRiderDef[];
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

function makeConfig(o: Opts = {}): SimConfig {
  const b = fixtureNetwork(EDGES);
  const features = o.features ?? { a: [ZONE], b: [LEFT_ZONE] };
  const bundle = {
    network: b.network,
    roads: b.roads.map((r) => ({
      ...r,
      features: features[r.id] ?? [],
      barriers: (o.railsOn ?? []).includes(r.id)
        ? [{ s0: 0, s1: r.lengthM, side: 'both' as const, kind: 'rail' as const, heightM: 1 }]
        : [],
    })),
  };
  const road = createRoadNetwork(bundle);
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
    riders: o.riders ?? [rider('rival', 0), rider('rival', 1), rider('player', 2)],
    weapons: [],
    trafficTypes: o.types ?? [CAR, TOURIST, CHICKEN],
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

/** Only riders and pedestrians, for scripted scenarios with hand-placed movers. */
const SCENARIO: SimSystem[] = [ridersSystem, pedsSystem];

interface Placed {
  edge?: number;
  s: number;
  d: number;
  speed: number;
  dir?: 1 | -1;
}

function scenario(config: SimConfig, riders: readonly Placed[]): World {
  const world = createWorld(config);
  riders.forEach((r, i) => {
    const m = addMover(world, 'rider', { edge: r.edge ?? 0, s: r.s, d: r.d, dir: r.dir ?? 1 }, i);
    m.speed = r.speed;
  });
  for (const s of SCENARIO) s.init(world, config);
  return world;
}

const SOLO = [rider('player', 0)];
const PACK = [rider('player', 0), rider('player', 1), rider('player', 2)];
const cruise: SimInput = { steer: 0, throttle: 255, brake: 0, flags: 0 };
const coast: SimInput = { steer: 0, throttle: 0, brake: 0, flags: 0 };

/** Rider → pedestrian along-road gap, box to box, and side offset (same edge only). */
function gap(world: World, riderId: number, pedId: number): { along: number; side: number } {
  const r = world.movers[riderId];
  const p = world.movers[pedId];
  if (!r || !p) throw new Error('missing mover');
  return { along: (p.pos.s - r.pos.s) * r.pos.dir, side: p.pos.d - r.pos.d };
}

function overlaps(world: World, config: SimConfig, riderId: number, pedId: number): boolean {
  const st = pedsState(world);
  const k = st.id.indexOf(pedId);
  const t = config.trafficTypes[st.type[k] ?? -1];
  if (!t) throw new Error('ped has no type');
  const g = gap(world, riderId, pedId);
  return (
    Math.abs(g.along) < (PEDS.riderLengthM + t.lengthM) / 2 &&
    Math.abs(g.side) < (PEDS.riderWidthM + t.widthM) / 2
  );
}

// ---- tests -------------------------------------------------------------------------------

describe('peds: spawning from roadside zones', () => {
  it('spawns pedestrians inside each roadsideZone, off the drivable road, and nowhere else', () => {
    const config = makeConfig();
    const world = scenario(config, [{ s: 20, d: 1.7, speed: 0 }]);
    const st = pedsState(world);
    // 100 m zone → 4, 60 m zone → 2 (one per PEDS.perZoneM, capped at PEDS.maxPerZone).
    expect(st.id.length).toBe(6);
    const zones = [
      { edge: 0, f: ZONE },
      { edge: 1, f: LEFT_ZONE },
    ];
    for (const id of st.id) {
      const m = world.movers[id];
      expect(m?.kind).toBe('ped');
      const z = zones.find((q) => q.edge === m?.pos.edge);
      expect(z).toBeDefined();
      if (!m || !z) continue;
      expect(m.pos.s).toBeGreaterThanOrEqual(z.f.s0);
      expect(m.pos.s).toBeLessThanOrEqual(z.f.s1);
      // The fixture's drivable road ends at |d| = 4.9; a waiting pedestrian stands clear of it.
      expect(Math.abs(m.pos.d)).toBeGreaterThanOrEqual(4.9 + 0.25);
      expect(Math.sign(m.pos.d)).toBe(Math.sign(z.f.d0 + z.f.d1));
      expect(m.mode).toBe('Road');
    }
  });

  it('spawns only on roads the race route allows (a longer network carries zones past the finish)', () => {
    const base = makeConfig();
    const route = createRouteProgress(base.road, {
      id: 'short',
      network: 'fixture',
      start: { road: 'a', s: 20, dir: 1 },
      finish: { road: 'a', s: 580 },
      mainPath: ['a'],
      allowedRoads: ['a'],
      closed: false,
    });
    const config: SimConfig = { ...base, route };
    const world = scenario(config, [{ s: 20, d: 1.7, speed: 0 }]);
    const st = pedsState(world);
    // Edge a's 100 m zone gives 4; edge b's zone is past the finish, off the route: none there.
    expect(st.id.length).toBe(4);
    for (const id of st.id) expect(world.movers[id]?.pos.edge).toBe(0);
  });

  it('spawns nothing without roadside zones or without pedestrian and animal types', () => {
    const noZones = scenario(makeConfig({ features: {} }), [{ s: 20, d: 1.7, speed: 0 }]);
    expect(pedsState(noZones).id).toHaveLength(0);
    const noTypes = scenario(makeConfig({ types: [CAR] }), [{ s: 20, d: 1.7, speed: 0 }]);
    expect(pedsState(noTypes).id).toHaveLength(0);
  });

  it('picks kinds by the region weights (M2 traffic-3): weight 0 never spawns, heavier comes more', () => {
    const kinds = (types: readonly SimTrafficTypeDef[]) => {
      const counts = new Map<string, number>();
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const config = makeConfig({ seed, types, features: { a: [{ ...ZONE, params: {} }] } });
        const st = pedsState(scenario(config, [{ s: 20, d: 1.7, speed: 0 }]));
        for (const t of st.type) {
          const id = config.trafficTypes[t]?.contentId ?? '?';
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }
      return counts;
    };
    const noTourists = kinds([CAR, { ...TOURIST, weight: 0 }, { ...CHICKEN, weight: 1 }]);
    const even = kinds([CAR, TOURIST, CHICKEN]);
    const touristHeavy = kinds([CAR, { ...TOURIST, weight: 9 }, { ...CHICKEN, weight: 1 }]);
    const fmt = (m: Map<string, number>) => [...m].map(([k, v]) => `${k} ${v}`).join(', ');
    console.log(
      `peds by region weight: no tourists {${fmt(noTourists)}}; unweighted {${fmt(even)}}; tourist-heavy {${fmt(touristHeavy)}}`,
    );
    expect(noTourists.get(TOURIST.contentId) ?? 0).toBe(0);
    expect(noTourists.get(CHICKEN.contentId) ?? 0).toBeGreaterThan(0);
    expect(even.get(TOURIST.contentId) ?? 0).toBeGreaterThan(0);
    expect(even.get(CHICKEN.contentId) ?? 0).toBeGreaterThan(0);
    expect(touristHeavy.get(TOURIST.contentId) ?? 0).toBeGreaterThan(
      3 * (touristHeavy.get(CHICKEN.contentId) ?? 0),
    );
  });

  it('lets some pedestrians cross the road and back, and none cross where rails line the road', () => {
    const open = makeConfig({ seed: 3, features: { a: [{ ...ZONE, s1: 500 }] } });
    const world = scenario(open, [{ s: 20, d: 1.7, speed: 0 }]);
    const st = pedsState(world);
    const crossers = st.id.filter((_id, k) => st.crosses[k] === 1);
    expect(crossers.length).toBeGreaterThan(0);
    // Run 40 s with the rider parked far away: a crosser reaches the far side.
    let reachedFar = 0;
    const startSide = crossers.map((id) => Math.sign(world.movers[id]?.pos.d ?? 0));
    for (let t = 0; t < 60 * 40; t++) {
      stepWorld(world, open, SCENARIO, [coast]);
      crossers.forEach((id, i) => {
        const d = world.movers[id]?.pos.d ?? 0;
        if (Math.sign(d) === -(startSide[i] ?? 0) && Math.abs(d) > 4.9) reachedFar |= 1 << i;
      });
    }
    expect(reachedFar).toBeGreaterThan(0);

    const railed = makeConfig({ seed: 3, features: { a: [{ ...ZONE, s1: 500 }] }, railsOn: ['a'] });
    const st2 = pedsState(scenario(railed, [{ s: 20, d: 1.7, speed: 0 }]));
    expect(st2.id.length).toBeGreaterThan(0);
    expect(st2.crosses.every((c) => c === 0)).toBe(true);
  });
});

describe('peds: the threat range and the dive', () => {
  it('grows the threat range with the rider speed', () => {
    expect(pedThreatRangeM(0)).toBeGreaterThan(0);
    expect(pedThreatRangeM(20)).toBeGreaterThan(pedThreatRangeM(10));
    expect(pedThreatRangeM(38)).toBeGreaterThan(pedThreatRangeM(20));
    // At the M1 top speed the pedestrian gets over a second of warning.
    expect(pedThreatRangeM(38) / 38).toBeGreaterThan(1);
  });

  for (const speed of [12, 38]) {
    it(`dives when a rider at ${speed} m/s comes inside the range, and not before`, () => {
      const config = makeConfig({ features: {}, riders: SOLO });
      const world = scenario(config, [{ s: 240, d: 1.7, speed }]);
      const pedId = placePed(world, config, { type: 1, edge: 0, s: 300, d: 1.7 });
      let diveTick = -1;
      let alongAtDive = NaN;
      let rangeAtDive = NaN;
      let contact = false;
      for (let t = 0; t < 60 * 30 && diveTick < 0; t++) {
        const v = world.movers[0]?.speed ?? 0;
        // The gap the rider will have after this tick's move (riders step before peds).
        const next = gap(world, 0, pedId).along - v / 60;
        const range = pedThreatRangeM(v);
        const events = stepWorld(world, config, SCENARIO, [speed > 30 ? cruise : coast]);
        const dive = events.find((e) => e.type === 'pedDive' && e.actor === pedId);
        if (dive) {
          diveTick = world.tick;
          alongAtDive = next;
          rangeAtDive = range;
          expect(dive.target).toBe(0);
          expect(typeof dive.data['side']).toBe('number');
        } else {
          // No dive yet, so the rider was not yet inside the range (a little speed-change slack).
          expect(next).toBeGreaterThan(range - 0.3);
        }
        contact ||= overlaps(world, config, 0, pedId);
      }
      expect(diveTick).toBeGreaterThan(0);
      expect(alongAtDive).toBeLessThanOrEqual(rangeAtDive + 0.3);
      expect(alongAtDive).toBeGreaterThan(rangeAtDive - speed / 60 - 0.3);
      // The rest of the pass: an arc (off the ground mid-dive), then down, and never touched.
      let peakH = 0;
      for (let t = 0; t < 60 * 5; t++) {
        stepWorld(world, config, SCENARIO, [speed > 30 ? cruise : coast]);
        peakH = Math.max(peakH, world.movers[pedId]?.h ?? 0);
        contact ||= overlaps(world, config, 0, pedId);
      }
      expect(peakH).toBeGreaterThan(0.3);
      expect(contact).toBe(false);
      expect(pedsState(world).contacts).toBe(0);
    });
  }

  it('dives away from the rider, off the road when that is the clear side', () => {
    const config = makeConfig({ features: {}, riders: SOLO });
    const world = scenario(config, [{ s: 200, d: 1.2, speed: 38 }]);
    const pedId = placePed(world, config, { type: 1, edge: 0, s: 300, d: 2.2 });
    for (let t = 0; t < 60 * 10; t++) stepWorld(world, config, SCENARIO, [cruise]);
    expect(world.movers[pedId]?.pos.d ?? 0).toBeGreaterThan(4.9);
  });

  it('never touches a rider who passes at full speed through a crowd crossing the road', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const config = makeConfig({ features: {}, seed, riders: PACK });
      const riders: Placed[] = [
        { s: 30, d: 1.2, speed: 38 },
        { s: 22, d: 2.4, speed: 34 },
        { s: 40, d: -1.7, speed: 20, edge: 0, dir: 1 },
      ];
      const world = scenario(config, riders);
      const peds: number[] = [];
      for (let i = 0; i < 8; i++) {
        peds.push(
          placePed(world, config, {
            type: i % 3 === 0 ? 2 : 1,
            edge: 0,
            s: 250 + i * 9,
            d: -4 + i * 1.1,
            crosses: true,
            homeD: -5.5,
            farD: 5.5,
            // Half stand in the road until the riders arrive; half set off just before.
            timer: i % 2 === 0 ? 30 : 4.5,
          }),
        );
      }
      // The threat predicate, re-derived in the test from the public numbers and the positions:
      // a rider at speed within pedThreatRangeM(speed) ahead (or just past) and inside the side
      // band. Whoever it holds for must be diving: a pedDive this tick or within one dive's length.
      const diveTicks = Math.ceil(PEDS.diveS * 60) + 1;
      const lastDive = new Map<number, number>();
      const threatened = new Set<number>();
      let checks = 0;
      for (let t = 0; t < 60 * 20; t++) {
        const events = stepWorld(world, config, SCENARIO, [cruise]);
        for (const e of events) if (e.type === 'pedDive') lastDive.set(e.actor, world.tick);
        for (const [rid] of riders.entries()) {
          const r = world.movers[rid];
          for (const pid of peds) {
            checks++;
            expect(overlaps(world, config, rid, pid), `seed ${seed} rider ${rid} ped ${pid}`).toBe(false);
            if (!r || r.speed < PEDS.threatMinMps) continue;
            const g = gap(world, rid, pid);
            const kind = config.trafficTypes[pedsState(world).type[peds.indexOf(pid)] ?? -1];
            const band = (PEDS.riderWidthM + (kind?.widthM ?? 0)) / 2 + PEDS.lateralM;
            const inRange = g.along >= -PEDS.threatBehindM && g.along <= pedThreatRangeM(r.speed);
            if (!inRange || Math.abs(g.side) >= band) continue;
            threatened.add(pid);
            const since = world.tick - (lastDive.get(pid) ?? -1e9);
            expect(
              since,
              `seed ${seed} tick ${world.tick} ped ${pid}: threatened, no dive`,
            ).toBeLessThanOrEqual(diveTicks);
          }
        }
      }
      expect(checks).toBeGreaterThan(0);
      expect(threatened.size).toBeGreaterThan(2);
      expect(pedsState(world).contacts).toBe(0);
    }
  });

  it('a waiting crosser may step out at the worst moment, and still dives clear untouched', () => {
    const config = makeConfig({ features: {}, riders: SOLO });
    const world = scenario(config, [{ s: 100, d: 3.2, speed: 38 }]);
    // Waiting off the road on the right for another 30 s, unless a rider comes (the lure).
    const pedId = placePed(world, config, {
      type: 1,
      edge: 0,
      s: 400,
      d: 5.6,
      crosses: true,
      homeD: 5.6,
      farD: -5.6,
      timer: 30,
      lure: true,
    });
    let stepOutAhead = NaN;
    let dove = false;
    let touched = false;
    for (let t = 0; t < 60 * 12; t++) {
      const events = stepWorld(world, config, SCENARIO, [cruise]);
      const d = world.movers[pedId]?.pos.d ?? 0;
      if (Number.isNaN(stepOutAhead) && d < 5.6) stepOutAhead = gap(world, 0, pedId).along;
      dove ||= events.some((e) => e.type === 'pedDive' && e.actor === pedId && e.data['bumped'] === false);
      touched ||= overlaps(world, config, 0, pedId);
    }
    // Stepped out while the rider was still beyond its threat range, then dove.
    expect(stepOutAhead).toBeGreaterThan(pedThreatRangeM(38) + PEDS.lureLeadMinM - 1);
    expect(stepOutAhead).toBeLessThanOrEqual(pedThreatRangeM(38) + PEDS.lureLeadMaxM + 1);
    expect(dove).toBe(true);
    expect(touched).toBe(false);
  });
});

describe('peds: traffic cars', () => {
  it('a pedestrian in the road dives from an oncoming car too, and the car never touches them', () => {
    const config = makeConfig({
      features: {},
      riders: SOLO,
      tuning: { 'traffic.densitySame': 0, 'traffic.densityOncoming': 0 },
    });
    const systems: SimSystem[] = [ridersSystem, trafficSystem, pedsSystem];
    const world = createWorld(config);
    addMover(world, 'rider', { edge: 0, s: 20, d: 1.7, dir: 1 }, 0);
    for (const s of systems) s.init(world, config);
    // A car coming the other way in the oncoming lane (d −1.7), a pedestrian standing in it.
    const carSlot = placeVehicle(world, config, { type: 0, u: 520, dir: -1, speed: 24.6 });
    expect(carSlot).toBe(0);
    const pedId = placePed(world, config, { type: 1, edge: 0, s: 300, d: -1.7 });
    const carId = world.movers.findIndex((m) => m.kind === 'vehicle');
    let dove: SimEvent | undefined;
    let touched = false;
    for (let t = 0; t < 60 * 15; t++) {
      const events = stepWorld(world, config, systems, [coast]);
      dove ??= events.find((e) => e.type === 'pedDive' && e.actor === pedId);
      const car = world.movers[carId];
      const p = world.movers[pedId];
      if (car && p && car.pos.edge === p.pos.edge) {
        touched ||=
          Math.abs(car.pos.s - p.pos.s) < (4.6 + 0.6) / 2 && Math.abs(car.pos.d - p.pos.d) < (1.8 + 0.6) / 2;
      }
    }
    expect(dove?.target).toBe(carId);
    expect(touched).toBe(false);
    expect(pedsState(world).vehicleContacts).toBe(0);
  });
});

describe('peds: contact rules', () => {
  it('a normal pedestrian bumped at point blank is knocked into a dive, and the rider rides on', () => {
    const config = makeConfig({ features: {}, riders: SOLO });
    const world = scenario(config, [{ s: 300, d: 1.7, speed: 30 }]);
    const pedId = placePed(world, config, { type: 1, edge: 0, s: 300.5, d: 1.7 });
    const events: SimEvent[] = [];
    for (let t = 0; t < 30; t++) events.push(...stepWorld(world, config, SCENARIO, [cruise]));
    expect(pedsState(world).contacts).toBe(1);
    const dive = events.find((e) => e.type === 'pedDive' && e.actor === pedId);
    expect(dive?.data['bumped']).toBe(true);
    expect(events.some((e) => e.type === 'crash')).toBe(false);
  });

  it('hitting something big crashes you', () => {
    const config = makeConfig({ features: {}, types: [CAR, TOURIST, CHICKEN, GATOR], riders: SOLO });
    const world = scenario(config, [{ s: 300, d: 1.7, speed: 30 }]);
    const pedId = placePed(world, config, { type: 3, edge: 0, s: 301, d: 1.7 });
    const events: SimEvent[] = [];
    for (let t = 0; t < 5; t++) events.push(...stepWorld(world, config, SCENARIO, [cruise]));
    const crash = events.find((e) => e.type === 'crash');
    expect(crash?.actor).toBe(0);
    expect(crash?.target).toBe(pedId);
    expect(crash?.data['cause']).toBe('ped');
  });
});

describe('peds: determinism', () => {
  it('a scripted run gives the same hash every run, and the peds are part of the hash', () => {
    const run = (seed: number) => {
      const sim = createSim(makeConfig({ seed }));
      const hashes: number[] = [];
      let phases = 0;
      for (let t = 0; t < 60 * 45; t++) {
        sim.step([{ steer: Math.round(Math.sin(t / 90) * 20), throttle: 255, brake: 0, flags: 0 }]);
        if (t % 60 === 0) hashes.push(sim.hash());
        phases += sim.events().filter((e) => e.type === 'pedDive').length;
      }
      return { hashes, peds: sim.snapshot().entities.filter((e) => e.kind === 'ped').length, phases };
    };
    const a = run(11);
    const b = run(11);
    expect(a.peds).toBeGreaterThan(0);
    expect(b.hashes).toEqual(a.hashes);
    expect(run(12).hashes).not.toEqual(a.hashes);
  });

  it('exposes the phase names the state uses', () => {
    expect(PED_PHASE).toEqual({ loiter: 0, walk: 1, dive: 2, down: 3 });
  });
});
