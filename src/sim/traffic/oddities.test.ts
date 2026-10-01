// M3 traffic-4 (head start), the oddity half (docs/milestones/M3.md, "traffic-4 · Animals and
// wasteland oddities"): oddities are ordinary traffic entries with category `oddity`.
//   - a PARKED oddity (cruiseMps 0, the boat in the fast lane) stands still in the innermost lane,
//     nudged toward the shoulder, and is never shoved by other vehicles;
//   - traffic gets past it: a lane change where the direction has two lanes, an inward edge round
//     it where it has one, never touching it and never jamming behind it;
//   - every oddity spawns beyond reaction range of every anchor (the fairness rule), and a rolling
//     one (the mobile home) only comes the other way, so nobody is stuck behind it;
//   - the `traffic.oddities` slider scales how often they come, 0 turning them off;
//   - riding into one crashes you (they are `big`).
import { describe, expect, it } from 'vitest';
import { tuningDefaults, type LaneInfo } from '../../core';
import {
  createRoadNetwork,
  createRouteProgress,
  fixtureNetwork,
  type BakedNetworkBundle,
  type FixtureEdgeSpec,
  type RoadPos,
} from '../../road';
import { aiSystem } from '../ai';
import { combatSystem } from '../combat';
import { copsSystem } from '../cops';
import { SIM_TUNING } from '../create';
import { modifiersSystem } from '../modifiers';
import { pedsSystem } from '../peds';
import { gridPosition, raceSystem } from '../race';
import { ridersSystem } from '../riders';
import { tumbleSystem } from '../tumble';
import type { SimConfig, SimEvent, SimInput, SimRiderDef, SimTrafficTypeDef } from '../types';
import { addMover, createWorld, orderSystems, stepWorld, type SimSystem, type World } from '../world';
import { toCorridor } from './corridor';
import { isParked, placeVehicle, TRAFFIC, trafficState, trafficSystem } from './index';

// ---- fixtures ----------------------------------------------------------------------------

const CAR: SimTrafficTypeDef = {
  contentId: 'base:car',
  category: 'car',
  lengthM: 4.6,
  widthM: 1.8,
  cruiseMps: 24.6,
  hazard: 'normal',
};
const TRUCK: SimTrafficTypeDef = {
  contentId: 'base:truck',
  category: 'truck',
  lengthM: 7.5,
  widthM: 2.4,
  cruiseMps: 22,
  hazard: 'big',
};
const BOAT: SimTrafficTypeDef = {
  contentId: 'base:parked-boat',
  category: 'oddity',
  lengthM: 7,
  widthM: 2.4,
  cruiseMps: 0,
  hazard: 'big',
};
const HOME: SimTrafficTypeDef = {
  contentId: 'base:runaway-mobile-home',
  category: 'oddity',
  lengthM: 7.5,
  widthM: 2.4,
  cruiseMps: 9,
  hazard: 'big',
};
const BIKE_TOP = 38;

const TWO_LANES: readonly LaneInfo[] = [
  { id: 'L0', dCenterM: -7.6, widthM: 1.5, direction: -1, kind: 'shoulder' },
  { id: 'L2', dCenterM: -5.1, widthM: 3.4, direction: -1, kind: 'drive' },
  { id: 'L1', dCenterM: -1.7, widthM: 3.4, direction: -1, kind: 'drive' },
  { id: 'R1', dCenterM: 1.7, widthM: 3.4, direction: 1, kind: 'drive' },
  { id: 'R2', dCenterM: 5.1, widthM: 3.4, direction: 1, kind: 'drive' },
  { id: 'R0', dCenterM: 7.6, widthM: 1.5, direction: 1, kind: 'shoulder' },
];
const EDGES: readonly FixtureEdgeSpec[] = [
  { id: 'a', lengthM: 600, kappa: 0 },
  { id: 'b', lengthM: 800, kappa: 1 / 300, grade: 0.02 },
  { id: 'c', lengthM: 600, kappa: -1 / 400 },
];

function bundle(lanes: readonly LaneInfo[] | null): BakedNetworkBundle {
  const b = fixtureNetwork(EDGES);
  return {
    network: b.network,
    roads: b.roads.map((r) => (lanes ? { ...r, laneSections: [{ s0: 0, lanes }] } : r)),
  };
}

const bike = {
  contentId: 'base:bike',
  topSpeedMps: BIKE_TOP,
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
const FIELD = [rider('rival', 0), rider('rival', 1), rider('rival', 2), rider('cop', 3), rider('player', 4)];
const SOLO = [rider('player', 0)];

interface Opts {
  lanes?: readonly LaneInfo[] | null;
  riders?: readonly SimRiderDef[];
  types?: readonly SimTrafficTypeDef[];
  tuning?: Record<string, number>;
  seed?: number;
}

function makeConfig(o: Opts = {}): SimConfig {
  const road = createRoadNetwork(bundle(o.lanes ?? null));
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 20, dir: 1 },
    finish: { road: 'c', s: 580 },
    mainPath: ['a', 'b', 'c'],
    allowedRoads: ['a', 'b', 'c'],
    closed: false,
  });
  return {
    seed: o.seed ?? 5,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 31,
      byPlaceCash: [100, 50],
      raceEndTimeoutTicks: 1800,
    },
    riders: o.riders ?? FIELD,
    weapons: [],
    trafficTypes: o.types ?? [CAR, TRUCK, BOAT, HOME],
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

const ALL: SimSystem[] = orderSystems([
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

function raceWorld(config: SimConfig): World {
  const world = createWorld(config);
  config.riders.forEach((_d, i) => addMover(world, 'rider', gridPosition(config, i), i));
  for (const s of ALL) s.init(world, config);
  return world;
}

const SCENARIO: SimSystem[] = [ridersSystem, trafficSystem];
function scenarioWorld(config: SimConfig, riders: { pos: RoadPos; speed: number }[]): World {
  const world = createWorld(config);
  riders.forEach((r, i) => {
    const m = addMover(world, 'rider', { ...r.pos }, i);
    m.speed = r.speed;
  });
  for (const s of SCENARIO) s.init(world, config);
  return world;
}
const hold = (throttle: number): SimInput => ({ steer: 0, throttle, brake: 0, flags: 0 });
const scripted = (tick: number): SimInput => ({
  steer: Math.round(Math.sin(tick / 90) * 20),
  throttle: 255,
  brake: 0,
  flags: 0,
});
const NO_TRAFFIC = { 'traffic.densitySame': 0, 'traffic.densityOncoming': 0 };

/** Vehicle boxes (u along the corridor, cd across) that overlap, both ways. */
function boxesOverlap(config: SimConfig, world: World, a: number, b: number): boolean {
  const st = trafficState(world);
  const ta = config.trafficTypes[st.type[a] ?? -1];
  const tb = config.trafficTypes[st.type[b] ?? -1];
  if (!ta || !tb || st.dir[a] !== st.dir[b]) return false;
  const du = Math.abs((st.u[a] ?? 0) - (st.u[b] ?? 0));
  const dd = Math.abs((st.cd[a] ?? 0) - (st.cd[b] ?? 0));
  return du < (ta.lengthM + tb.lengthM) / 2 && dd < (ta.widthM + tb.widthM) / 2;
}

/** A parked boat at u 700 heading +1, a car coming up behind it at u 300; 40 s of traffic. */
function passScenario(lanes: readonly LaneInfo[] | null) {
  const config = makeConfig({ riders: SOLO, types: [CAR, BOAT], tuning: NO_TRAFFIC, lanes });
  // The rider waits far behind, out of everyone's way.
  const world = scenarioWorld(config, [{ pos: { edge: 0, s: 30, d: -1.7, dir: 1 }, speed: 0 }]);
  const boat = placeVehicle(world, config, { type: 1, u: 700, dir: 1 });
  const car = placeVehicle(world, config, { type: 0, u: 300, dir: 1 });
  const st = trafficState(world);
  const boatU = st.u[boat] ?? 0;
  const boatCd = st.cd[boat] ?? 0;
  let touched = 0;
  let boatMoved = 0;
  let minSpeed = Infinity;
  let maxSideStep = 0;
  for (let t = 0; t < 60 * 40; t++) {
    const cd0 = st.cd[car] ?? 0;
    stepWorld(world, config, SCENARIO, [hold(0)]);
    if (boxesOverlap(config, world, boat, car)) touched++;
    boatMoved = Math.max(
      boatMoved,
      Math.abs((st.u[boat] ?? 0) - boatU),
      Math.abs((st.cd[boat] ?? 0) - boatCd),
    );
    if ((st.u[car] ?? 0) < boatU + 30)
      minSpeed = Math.min(minSpeed, world.movers[st.id[car] ?? -1]?.speed ?? 0);
    maxSideStep = Math.max(maxSideStep, Math.abs((st.cd[car] ?? 0) - cd0) * 60);
  }
  return { config, world, st, boat, car, boatU, boatCd, touched, boatMoved, minSpeed, maxSideStep };
}

// ---- tests -------------------------------------------------------------------------------

describe('traffic-4: parked oddities', () => {
  it('isParked: only an oddity with no cruise speed', () => {
    expect(isParked(BOAT)).toBe(true);
    expect(isParked(HOME)).toBe(false);
    expect(isParked({ ...CAR, cruiseMps: 0 })).toBe(false); // a broken-down car is not an oddity
    expect(isParked(undefined)).toBe(false);
  });

  it('a parked boat stands in the innermost lane, nudged toward the shoulder, and never moves', () => {
    const r = passScenario(null);
    // The fixture's only lane this way is centred at d 1.7: the boat stands at 1.7 + parkOutM.
    expect(r.boatCd).toBeCloseTo(1.7 + TRAFFIC.parkOutM, 9);
    expect(r.st.rank[r.boat]).toBe(0);
    expect(r.boatMoved).toBe(0);
    expect(r.world.movers[r.st.id[r.boat] ?? -1]?.speed).toBe(0);
  });

  it('one lane: a car edges inward round it, never touches it, and keeps going', () => {
    const r = passScenario(null);
    const carU = r.st.u[r.car] ?? 0;
    console.log(
      `[examined] one-lane pass: car from u 300 to ${carU.toFixed(0)} past a boat at u ${r.boatU}, ` +
        `${r.touched} overlapping ticks, slowest ${r.minSpeed.toFixed(1)} m/s near it, ` +
        `fastest sideways ${r.maxSideStep.toFixed(2)} m/s, ends at d ${(r.st.cd[r.car] ?? 0).toFixed(2)}`,
    );
    expect(r.touched).toBe(0);
    expect(carU).toBeGreaterThan(r.boatU + 100); // passed it, no jam
    expect(r.minSpeed).toBeGreaterThan(5); // edged round it rather than stopping
    expect(r.maxSideStep).toBeLessThanOrEqual(TRAFFIC.swerveMps + 1e-9);
    // Back in its lane once past.
    expect(r.st.cd[r.car]).toBeCloseTo(1.7, 3);
  });

  it('two lanes: a car in the fast lane changes lanes past it, never touching it', () => {
    const r = passScenario(TWO_LANES);
    const carU = r.st.u[r.car] ?? 0;
    console.log(
      `[examined] two-lane pass: boat in rank ${r.st.rank[r.boat]} at d ${r.boatCd.toFixed(2)}, car ended ` +
        `in rank ${r.st.rank[r.car]} at u ${carU.toFixed(0)}, ${r.touched} overlapping ticks`,
    );
    expect(r.st.rank[r.boat]).toBe(0);
    expect(r.boatCd).toBeCloseTo(1.7 + TRAFFIC.parkOutM, 9);
    expect(r.touched).toBe(0);
    expect(carU).toBeGreaterThan(r.boatU + 100);
    expect(r.boatMoved).toBe(0);
  });

  it('riding into a parked boat crashes you', () => {
    const config = makeConfig({ riders: SOLO, types: [CAR, BOAT], tuning: NO_TRAFFIC });
    const world = scenarioWorld(config, [
      { pos: { edge: 0, s: 200, d: 1.7 + TRAFFIC.parkOutM, dir: 1 }, speed: 30 },
    ]);
    placeVehicle(world, config, { type: 1, u: 260, dir: 1 });
    const events: SimEvent[] = [];
    for (let t = 0; t < 60 * 4; t++) events.push(...stepWorld(world, config, SCENARIO, [hold(255)]));
    const crash = events.find((e) => e.type === 'crash' && e.data['vehicle'] === BOAT.contentId);
    expect(crash).toBeDefined();
    expect(crash?.data['hazard']).toBe('big');
  });
});

describe('traffic-4: oddities in seeded races', () => {
  /** Races with heavy oddity weights; returns per-seed oddity spawns and their anchor distances. */
  function oddityRaces(seeds: readonly number[], tuning: Record<string, number>, ticks = 60 * 60) {
    let spawns = 0;
    let checked = 0;
    let minDist = Infinity;
    let contactsBetween = 0;
    let rolling = 0;
    const tooClose: string[] = [];
    const rollingSameWay: string[] = [];
    let reactionM = 0;
    for (const seed of seeds) {
      const config = makeConfig({
        seed,
        types: [
          { ...CAR, weight: 5 },
          { ...TRUCK, weight: 2 },
          { ...BOAT, weight: 2 },
          { ...HOME, weight: 2 },
        ],
        tuning,
      });
      const world = raceWorld(config);
      const st = trafficState(world);
      reactionM = st.reactionM;
      const check = (tick: number) => {
        const anchors: number[] = [];
        for (const m of world.movers) {
          const role = config.riders[m.riderIndex]?.role;
          if (m.kind !== 'rider' || (role !== 'player' && role !== 'rival')) continue;
          const p = toCorridor(st.corridor, m.pos);
          if (p) anchors.push(p.u);
        }
        for (let k = 0; k < st.id.length; k++) {
          checked++;
          const t = config.trafficTypes[st.type[k] ?? -1];
          if (st.spawnTick[k] !== tick || t?.category !== 'oddity') continue;
          spawns++;
          if (!isParked(t)) {
            rolling++;
            if (st.dir[k] === st.corridor.routeDir)
              rollingSameWay.push(`seed ${seed} tick ${tick} slot ${k}`);
          }
          const d = Math.min(...anchors.map((a) => Math.abs(a - (st.spawnU[k] ?? 0))));
          minDist = Math.min(minDist, d);
          // Contacts after the spawn can shove an anchor up to ~2 m in the same tick.
          if (d < st.reactionM - 2.5) tooClose.push(`seed ${seed} tick ${tick} slot ${k}: ${d.toFixed(1)} m`);
        }
        for (let a = 0; a < st.id.length; a++)
          for (let b = a + 1; b < st.id.length; b++) if (boxesOverlap(config, world, a, b)) contactsBetween++;
      };
      check(0);
      while (world.tick < ticks) {
        const tick = world.tick;
        stepWorld(world, config, ALL, [scripted(tick)]);
        check(tick);
      }
    }
    return { spawns, checked, minDist, tooClose, contactsBetween, reactionM, rolling, rollingSameWay };
  }

  it('every oddity spawns beyond reaction range, and no vehicle ever overlaps another', () => {
    const seeds = [1, 2, 3, 4, 5, 6];
    const r = oddityRaces(seeds, {});
    console.log(
      `[examined] ${seeds.length} seeded 60 s races (oddities weighted 4 in 11): ${r.spawns} oddity spawns, ` +
        `nearest ${r.minDist.toFixed(1)} m from an anchor (rule ${r.reactionM.toFixed(1)} m), ` +
        `${r.checked} slot-ticks checked, ${r.contactsBetween} vehicle overlaps; ${r.rolling} rolling ` +
        `oddities, ${r.rollingSameWay.length} of them heading the riders' way`,
    );
    expect(r.spawns).toBeGreaterThan(10);
    // A rolling oddity (the mobile home) only ever comes the other way: nobody is stuck behind it.
    expect(r.rolling).toBeGreaterThan(0);
    expect(r.rollingSameWay.slice(0, 3)).toEqual([]);
    expect(r.tooClose.slice(0, 3)).toEqual([]);
    expect(r.contactsBetween).toBe(0);
  }, 120_000);

  it('the traffic.oddities slider scales them: 0 turns them off', () => {
    const off = oddityRaces([1, 2], { 'traffic.oddities': 0 }, 60 * 30);
    const lots = oddityRaces([1, 2], { 'traffic.oddities': 4 }, 60 * 30);
    const some = oddityRaces([1, 2], {}, 60 * 30);
    console.log(
      `[examined] oddity spawns over 2 races of 30 s: slider 0 → ${off.spawns}, 1 → ${some.spawns}, 4 → ${lots.spawns}`,
    );
    expect(off.spawns).toBe(0);
    expect(lots.spawns).toBeGreaterThan(some.spawns);
  }, 120_000);
});
