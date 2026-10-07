// Structures are solid (the maintainer, 2026-10-06, [decided]: a road race in a physical world with honest
// edges; "I've been high enough to land on buildings but the wall prevented it"). The road's structures plan
// is what a rider meets: a wall up to its roofline by the one contact rule, a roof a support he lands on through
// land() and rides, a pitched roof a slope, a gap between two buildings open, and a building front's wall at
// any height gives way to the building itself. Each rule has its control: with `riders.structures` off (every
// recording made before), the old rules (the front a wall at any height, no roof). A fixture road with a row of
// shopfronts on its right, its plan made here (road/structures.ts `planStructures` with the test's own layer),
// only the riders stepping, counted in sim ticks.
import { describe, expect, it } from 'vitest';
import { FNV_OFFSET, tuningDefaults } from '../../core';
import {
  createRoadNetwork,
  createRouteProgress,
  fixtureNetwork,
  planStructures,
  type RoadNetwork,
  type StructureRoof,
  type StructureSpec,
} from '../../road';
import { SIM_TUNING } from '../create';
import type { SimConfig, SimEvent, SimInput, SimRiderDef } from '../types';
import { tumbleState, tumbleSystem } from '../tumble';
import {
  addMover,
  createWorld,
  hashPlain,
  stepWorld,
  worldHash,
  type Mover,
  type SimSystem,
  type World,
} from '../world';
import { BIKE_HALF_WIDTH_M, floorOf, riderState, ridersSystem, touchdownOf } from './index';
import { STRUCTURE_STATE_KEY, STRUCTURES_KEY } from './structures';
import { supportKeyOf, supportKindOf } from './supports';

const PLAYER: SimRiderDef = {
  contentId: 'base:player',
  name: 'You',
  role: 'player',
  faction: 'rider',
  controller: { kind: 'player', slot: 0 },
  bike: {
    contentId: 'base:bike',
    topSpeedMps: 40,
    accelMps2: 4.2,
    brakeMps2: 9,
    steerRateMps: 5.5,
    massKg: 180,
  },
  massKg: 85,
  healthMax: 100,
};

/** The band's outer edge on the right (the shopfronts' 4 m sidewalk past the fixture's 4.9 m of road). */
const EDGE_D = 8.9;
/** The seed the plans are made for (the race's). */
const SEED = 7;

/** A box beside the road: s0..s1 along it, d0..d1 across it, its underside `base` m up, its roof. */
interface Lot {
  rule: string;
  s0: number;
  s1: number;
  d0: number;
  d1: number;
  base?: number;
  roof: StructureRoof;
}

const flat = (topM: number): StructureRoof => ({ kind: 'flat', topM });

/** The structures of the fixture's street (each test picks its own). */
const ONE_STOREY: Lot = { rule: 'one-storey', s0: 300, s1: 380, d0: EDGE_D, d1: EDGE_D + 12, roof: flat(5) };
/** A row of three roofs along the street, 5 cm apart, 0.1 m up and down, then a taller one. */
const ROW: Lot[] = [
  { rule: 'row-a', s0: 400, s1: 420, d0: EDGE_D, d1: EDGE_D + 12, roof: flat(6) },
  { rule: 'row-b', s0: 420.05, s1: 440, d0: EDGE_D, d1: EDGE_D + 12, roof: flat(6.1) },
  { rule: 'row-c', s0: 440.05, s1: 460, d0: EDGE_D, d1: EDGE_D + 12, roof: flat(6) },
  { rule: 'row-tall', s0: 460.05, s1: 490, d0: EDGE_D, d1: EDGE_D + 12, roof: flat(12) },
];
/** A pitched roof, its ridge across the street (a rider riding along it goes up one slope and down the other). */
const PITCHED: Lot = {
  rule: 'pitched',
  s0: 600,
  s1: 624,
  d0: EDGE_D,
  d1: EDGE_D + 12,
  roof: { kind: 'pitched', eaveM: 5, ridgeM: 8, ridge: 'v' },
};
/** Two roofs with a 4 m gap between them. */
const GAP: Lot[] = [
  { rule: 'gap-a', s0: 700, s1: 720, d0: EDGE_D, d1: EDGE_D + 12, roof: flat(6) },
  { rule: 'gap-b', s0: 724, s1: 744, d0: EDGE_D, d1: EDGE_D + 12, roof: flat(6) },
];
/** A downtown tower, 60 m tall: out of any rider's reach. */
const TOWER: Lot = { rule: 'tower', s0: 900, s1: 930, d0: EDGE_D, d1: EDGE_D + 24, roof: flat(60) };

/** A lot as a structure, on the straight fixture road (its axis u along the road). */
function specOf(road: RoadNetwork, lot: Lot): StructureSpec {
  const s = (lot.s0 + lot.s1) / 2;
  const d = (lot.d0 + lot.d1) / 2;
  const p = road.toWorld(0, s, d, 0);
  const f = road.frameAt(0, s);
  return {
    rule: lot.rule,
    cls: 'building',
    model: null,
    edge: 0,
    s,
    d: lot.d0,
    foot: { x: p.x, z: p.z, ux: f.tx, uz: f.tz, hu: (lot.s1 - lot.s0) / 2, hv: (lot.d1 - lot.d0) / 2 },
    baseY: p.y + (lot.base ?? 0),
    roof: lot.roof,
  };
}

/** The fixture street: a 2000 m straight road with shopfronts on its right, and its plan of `lots`. */
function makeConfig(lots: readonly Lot[], tuning: Record<string, number> = {}): SimConfig {
  const bundle = fixtureNetwork([{ id: 'a', lengthM: 2000, kappa: 0 }]);
  const road0 = bundle.roads[0];
  if (!road0) throw new Error('no road');
  const road = createRoadNetwork({
    ...bundle,
    roads: [{ ...road0, tags: [{ s0: 0, s1: 2000, side: 'right', tag: 'shopfronts' }] }],
  });
  // The plan, kept for this network and the race's seed (what the app's planners would make: here the
  // test's own layer, asked for by the street's tag).
  const layer = { tags: ['shopfronts'], load: () => Promise.reject(new Error('planned here')) };
  planStructures(
    road,
    SEED,
    { fixture: { plan: (r, _seed, out) => lots.forEach((lot) => out.add(specOf(r, lot))) } },
    { fixture: layer },
  );
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 20, dir: 1 },
    finish: { road: 'a', s: 1980 },
    mainPath: ['a'],
    allowedRoads: ['a'],
    closed: false,
  });
  return {
    seed: SEED,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 30,
      byPlaceCash: [100],
      raceEndTimeoutTicks: 1800,
    },
    riders: [PLAYER],
    weapons: [],
    trafficTypes: [],
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: { ...tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)), ...tuning },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

const OLD_RULES = { [STRUCTURES_KEY]: 0 };
const coast: SimInput = { steer: 0, throttle: 0, brake: 0, flags: 0 };
const held = (throttle: number, brake = 0, steer = 0): SimInput => ({
  steer: Math.round(steer * 127),
  throttle: Math.round(throttle * 255),
  brake: Math.round(brake * 255),
  flags: 0,
});

interface Scene {
  world: World;
  config: SimConfig;
  rider: Mover;
  events: SimEvent[];
  step(input?: SimInput): SimEvent[];
}

/** The player at s, d riding +s at `speed`; in the air at `air.h` above the road, rising at `air.vy`. */
function scene(
  config: SimConfig,
  rider: { s: number; d: number; speed: number; yaw?: number; air?: { h: number; vy: number } },
  systems: readonly SimSystem[] = [ridersSystem],
): Scene {
  const world = createWorld(config);
  const m = addMover(world, 'rider', { edge: 0, s: rider.s, d: rider.d, dir: 1 }, 0);
  for (const sys of systems) sys.init(world, config);
  m.speed = rider.speed;
  m.yaw = rider.yaw ?? 0;
  const rs = riderState(world);
  const surface = config.road.surfaceHeight(0, rider.s, rider.d);
  rs.yAbs[m.id] = surface;
  if (rider.air) {
    m.mode = 'Airborne';
    m.h = rider.air.h;
    rs.yAbs[m.id] = surface + rider.air.h;
    rs.vy[m.id] = rider.air.vy;
    rs.airTicks[m.id] = 0;
    rs.pitch[m.id] = 0;
    rs.pitchRate[m.id] = 0;
  }
  const events: SimEvent[] = [];
  return {
    world,
    config,
    rider: m,
    events,
    step(input = coast) {
      const out = stepWorld(world, config, systems, [input]);
      events.push(...out);
      return out;
    },
  };
}

/** Steps until a `land` or a `crash` (or `max` ticks); returns that event. */
function untilDown(sc: Scene, input: SimInput = coast, max = 300): SimEvent | undefined {
  for (let t = 0; t < max; t++) {
    const hit = sc.step(input).find((e) => e.type === 'land' || e.type === 'crash');
    if (hit) return hit;
  }
  return undefined;
}

/** The rider's world height of his feet. */
const feetY = (sc: Scene) => riderState(sc.world).yAbs[sc.rider.id] ?? 0;

/** A structure event's id (`data.structure`), or null. */
const structureOf = (e: SimEvent | undefined) => (e ? (e.data['structure'] ?? null) : null);

describe('the maintainer’s case: high enough to land on a building (2026-10-06)', () => {
  /** In the air 2 m over a one-storey roof's height, beside it, the bars toward it. */
  function flyAtRoof(tuning: Record<string, number> = {}) {
    const sc = scene(makeConfig([ONE_STOREY], tuning), {
      s: 312,
      d: EDGE_D - 1.2,
      speed: 18,
      yaw: 0.3,
      air: { h: 7, vy: 0 },
    });
    return sc;
  }

  it('flying over the sidewalk above a one-storey roof, he lands on it through land() and rides it', () => {
    const sc = flyAtRoof();
    // The bars toward the building for a third of a second, then let go (the air lines the bike up).
    let down: SimEvent | undefined;
    for (let t = 0; t < 300 && !down; t++)
      down = sc.step(t < 20 ? held(0, 0, 1) : coast).find((e) => e.type === 'land' || e.type === 'crash');
    console.log(`[examined] over a 5 m roof from 7 m: ${down?.type} ${JSON.stringify(down?.data)}`);
    expect(down?.type).toBe('land');
    expect(down?.data).toMatchObject({ quality: 'clean', on: 'structure', object: 'building' });
    // He rides it: in Road mode on its top, past the band's edge (8.4 m), for a second on the gas.
    for (let t = 0; t < 60; t++) {
      sc.step(held(0.4));
      expect(sc.rider.mode).toBe('Road');
      expect(supportKindOf(sc.world, sc.rider.id)).toBe('structure');
      expect(sc.rider.h).toBeCloseTo(5, 6);
    }
    console.log(
      `[examined] after 1 s on the roof: s ${sc.rider.pos.s.toFixed(1)}, d ${sc.rider.pos.d.toFixed(2)} (band edge ${EDGE_D}), h ${sc.rider.h.toFixed(2)}`,
    );
    expect(sc.rider.pos.d).toBeGreaterThan(EDGE_D - BIKE_HALF_WIDTH_M);
    expect(sc.events.some((e) => e.type === 'crash')).toBe(false);
  });

  it('control: the old rules hold him at the band’s edge, a wall at any height, and he comes down on the sidewalk', () => {
    const sc = flyAtRoof(OLD_RULES);
    let furthest = -Infinity;
    let down: SimEvent | undefined;
    for (let t = 0; t < 300 && !down; t++) {
      down = sc.step(t < 20 ? held(0, 0, 1) : coast).find((e) => e.type === 'land' || e.type === 'crash');
      furthest = Math.max(furthest, sc.rider.pos.d);
    }
    console.log(`[examined] old rules: furthest d ${furthest.toFixed(3)}, ${down?.type} h ${sc.rider.h}`);
    expect(furthest).toBeLessThanOrEqual(EDGE_D - BIKE_HALF_WIDTH_M + 1e-9);
    expect(down?.data['on']).toBeUndefined();
    expect(sc.rider.h).toBe(0);
  });
});

describe('the chalk mark and the floor below agree with the flight onto a roof', () => {
  it('flying at the one-storey roof, the mark is on its top and the floor below him is the roof once over it', () => {
    const sc = scene(makeConfig([ONE_STOREY]), {
      s: 312,
      d: EDGE_D - 1.2,
      speed: 18,
      yaw: 0.3,
      air: { h: 7, vy: 0 },
    });
    // Still over the sidewalk, short of its edge (the forecast meets the front by the flight's own rule).
    for (let t = 0; t < 2; t++) sc.step(held(0, 0, 1));
    expect(sc.rider.pos.d).toBeLessThan(EDGE_D - BIKE_HALF_WIDTH_M);
    const mark = touchdownOf(sc.world, sc.config, sc.rider);
    const roofY = sc.config.road.surfaceHeight(0, 312, EDGE_D) + 5;
    console.log(
      `[examined] the chalk mark at y ${mark?.y.toFixed(2)} (the roof ${roofY.toFixed(2)}), d ${sc.rider.pos.d.toFixed(2)}`,
    );
    expect(mark?.y).toBeCloseTo(roofY, 1);
    let floor = 0;
    let down: SimEvent | undefined;
    for (let t = 0; t < 120 && !down; t++) {
      down = sc.step(t < 8 ? held(0, 0, 1) : coast).find((e) => e.type === 'land' || e.type === 'crash');
      if (!down && sc.rider.pos.d > EDGE_D + 0.5) floor = floorOf(sc.world, sc.config, sc.rider) ?? 0;
    }
    expect(down?.data).toMatchObject({ on: 'structure' });
    expect(floor).toBeCloseTo(roofY, 6);
  });
});
describe('below the roofline he meets the wall, by the one rule (closing speed)', () => {
  it('a glance (about 6 m/s across) wobbles and slides him along it; square on (about 14 m/s across) crashes', () => {
    for (const [yaw, want] of [
      [0.35, 'wobble'],
      [1.0, 'crash'],
    ] as const) {
      const sc = scene(makeConfig([ONE_STOREY]), {
        s: 312,
        d: EDGE_D - 1.2,
        speed: 18,
        yaw,
        air: { h: 3, vy: 0 },
      });
      let met: SimEvent | undefined;
      for (let t = 0; t < 60 && !met; t++)
        met = sc
          .step(held(0, 0, 1))
          .find((e) => (e.type === 'wobble' || e.type === 'crash') && structureOf(e));
      console.log(`[examined] at 3 m, yaw ${yaw}: ${met?.type} ${JSON.stringify(met?.data)}`);
      expect(met?.type).toBe(want);
      expect(met?.data).toMatchObject({ object: 'building', hit: 'side' });
      // Never inside it: the bike's side stays at its face.
      expect(sc.rider.pos.d).toBeLessThan(EDGE_D);
    }
  });

  it('on the ground at the sidewalk’s edge, the building meets him by the same rule (not the barrier’s 6 m/s)', () => {
    // 7.6 m/s across: the barrier's line (6) would crash; the one rule (10) wobbles.
    const sc = scene(makeConfig([ONE_STOREY]), { s: 312, d: EDGE_D - 1.2, speed: 18, yaw: 0.44 });
    let met: SimEvent | undefined;
    for (let t = 0; t < 60 && !met; t++)
      met = sc.step(held(0.3, 0, 1)).find((e) => e.type === 'wobble' || e.type === 'crash');
    console.log(`[examined] on the ground into the front: ${met?.type} ${JSON.stringify(met?.data)}`);
    expect(met?.type).toBe('wobble');
    expect(met?.data).toMatchObject({ object: 'building' });
    // Control: the old rules' barrier crashes the same contact.
    const old = scene(makeConfig([ONE_STOREY], OLD_RULES), { s: 312, d: EDGE_D - 1.2, speed: 18, yaw: 0.44 });
    let was: SimEvent | undefined;
    for (let t = 0; t < 60 && !was; t++)
      was = old.step(held(0.3, 0, 1)).find((e) => e.type === 'wobble' || e.type === 'crash');
    expect(was?.type).toBe('crash');
    expect(was?.data['cause']).toBe('barrier');
  });
});

describe('a row of roofs to run along', () => {
  it('rides across 5 cm cracks and 0.1 m steps without a hop, then meets the taller one’s wall', () => {
    const sc = scene(makeConfig(ROW), { s: 402, d: EDGE_D + 4, speed: 12, air: { h: 6.4, vy: 0 } });
    const down = untilDown(sc);
    expect(down?.type).toBe('land');
    expect(down?.data).toMatchObject({ on: 'structure' });
    const keys = new Set<string>();
    let wall: SimEvent | undefined;
    for (let t = 0; t < 600 && !wall; t++) {
      const out = sc.step(held(0.5));
      wall = out.find((e) => (e.type === 'wobble' || e.type === 'crash') && structureOf(e));
      if (sc.rider.pos.s < 459.5) {
        expect(sc.rider.mode, `s ${sc.rider.pos.s}`).toBe('Road');
        expect(out.some((e) => e.type === 'jump' || e.type === 'land')).toBe(false);
      }
      keys.add(supportKeyOf(sc.world, sc.rider.id));
    }
    console.log(
      `[examined] along the row: supports ${[...keys].join(' ')}; at the tall one ${wall?.type} ${JSON.stringify(wall?.data)}`,
    );
    expect([...keys].filter((k) => k.startsWith('s:')).length).toBeGreaterThanOrEqual(3);
    // The 12 m building stands 6 m over his roof: a wall, end on at his speed (about 15 m/s): a crash.
    expect(wall?.data).toMatchObject({ object: 'building', hit: 'end' });
  });
});

describe('a pitched roof is a slope he lands and rides on like a ramp', () => {
  it('lands on its near slope judged against the slope, rides up it and leaves the ridge in the air', () => {
    const sc = scene(makeConfig([PITCHED]), { s: 601, d: EDGE_D + 6, speed: 16, air: { h: 6.2, vy: 0 } });
    const down = untilDown(sc);
    console.log(`[examined] onto the pitched roof: ${JSON.stringify(down?.data)}`);
    expect(down?.data).toMatchObject({ on: 'structure', quality: 'clean' });
    let jump: SimEvent | undefined;
    let highest = 0;
    for (let t = 0; t < 120 && !jump; t++) {
      jump = sc.step(held(1)).find((e) => e.type === 'jump');
      highest = Math.max(highest, sc.rider.h);
    }
    console.log(
      `[examined] up the slope to ${highest.toFixed(2)} m, then ${jump?.type} at s ${sc.rider.pos.s.toFixed(1)}`,
    );
    expect(highest).toBeGreaterThan(7.5);
    expect(jump).toBeDefined();
    expect(sc.rider.pos.s).toBeGreaterThan(611.5);
    expect(sc.rider.pos.s).toBeLessThan(614);
  });

  it('control: the same ride on a flat roof as high as the ridge never leaves it before its end', () => {
    const level: Lot = { ...PITCHED, rule: 'flat', roof: flat(8) };
    const sc = scene(makeConfig([level]), { s: 601, d: EDGE_D + 6, speed: 16, air: { h: 8.2, vy: 0 } });
    expect(untilDown(sc)?.data).toMatchObject({ on: 'structure' });
    let jump: SimEvent | undefined;
    for (let t = 0; t < 120 && !jump; t++) jump = sc.step(held(1)).find((e) => e.type === 'jump');
    expect(sc.rider.pos.s).toBeGreaterThan(623.5);
  });
});

describe('a gap between two buildings is open', () => {
  it('rolled into slowly, he falls through it below the roofs; fast, he jumps it and lands on the next', () => {
    for (const [speed, through] of [
      [4, true],
      [20, false],
    ] as const) {
      const sc = scene(makeConfig(GAP), { s: 712, d: EDGE_D + 6, speed, air: { h: 6.1, vy: 0 } });
      expect(untilDown(sc)?.data).toMatchObject({ on: 'structure' });
      let lowest = Infinity;
      for (let t = 0; t < 240 && sc.rider.pos.s < 726; t++) {
        sc.step(held(speed > 10 ? 0.6 : 0.1));
        if (sc.rider.pos.s > 720.5 && sc.rider.pos.s < 723.5) lowest = Math.min(lowest, feetY(sc));
      }
      console.log(
        `[examined] over the 4 m gap at ${speed} m/s: lowest ${lowest.toFixed(2)} m, then h ${sc.rider.h}`,
      );
      if (through) expect(lowest).toBeLessThan(4);
      else expect(lowest).toBeGreaterThan(5.5);
    }
  });
});

describe('a downtown tower out of reach is a wall at every reachable height', () => {
  it('at 1, 5 and 9.5 m (the hood launch’s apex) he meets its wall and never stands on it', () => {
    for (const h of [1, 5, 9.5]) {
      const sc = scene(makeConfig([TOWER]), {
        s: 910,
        d: EDGE_D - 1.2,
        speed: 20,
        yaw: 0.6,
        air: { h, vy: 0 },
      });
      let met: SimEvent | undefined;
      for (let t = 0; t < 200; t++) {
        const out = sc.step(held(0, 0, 1));
        met ??= out.find((e) => (e.type === 'wobble' || e.type === 'crash') && structureOf(e));
        expect(supportKindOf(sc.world, sc.rider.id)).not.toBe('structure');
        expect(sc.rider.pos.d).toBeLessThan(EDGE_D + 0.01);
        if (sc.rider.mode !== 'Airborne') break;
      }
      console.log(`[examined] at the tower from ${h} m: ${met?.type} ${JSON.stringify(met?.data)}`);
      expect(met?.data).toMatchObject({ object: 'building' });
    }
  });
});

describe('a crash on a roof stays on the roof', () => {
  it('ridden end on into the taller building at speed, he crashes and his body comes to rest up there', () => {
    const sc = scene(makeConfig(ROW), { s: 442, d: EDGE_D + 4, speed: 14, air: { h: 6.4, vy: 0 } }, [
      ridersSystem,
      tumbleSystem,
    ]);
    let crash: SimEvent | undefined;
    for (let t = 0; t < 300 && !crash; t++) crash = sc.step(held(1)).find((e) => e.type === 'crash');
    expect(crash?.data).toMatchObject({ object: 'building', hit: 'end' });
    let lowest = Infinity;
    for (let t = 0; t < 90; t++) {
      sc.step();
      const body = tumbleState(sc.world).records[sc.rider.id]?.rider;
      if (body) lowest = Math.min(lowest, body.y);
    }
    console.log(`[examined] a crash on the 6 m roof: the body's lowest over 1.5 s ${lowest.toFixed(2)} m`);
    // Its centre rests over the roof (a body's points sit about half a metre over what they lie on).
    expect(lowest).toBeGreaterThan(5.9);
  });
});

describe('determinism', () => {
  it('a ride onto a roof and along it replays to the same hash tick by tick', () => {
    const run = () => {
      const sc = scene(makeConfig([ONE_STOREY]), {
        s: 312,
        d: EDGE_D - 1.2,
        speed: 18,
        yaw: 0.3,
        air: { h: 7, vy: 0 },
      });
      const hashes: number[] = [];
      for (let t = 0; t < 180; t++) {
        sc.step(held(t < 40 ? 0 : 0.6, 0, t < 40 ? 1 : 0));
        hashes.push(worldHash(sc.world));
      }
      return { hashes, events: sc.events.map((e) => `${e.tick}:${e.type}`) };
    };
    const a = run();
    const b = run();
    expect(b.hashes).toEqual(a.hashes);
    expect(b.events).toEqual(a.events);
    expect(a.events.some((e) => e.endsWith(':land'))).toBe(true);
  });

  it('a ride that never meets a structure hashes as before (the switch on or off), with no structure state', () => {
    const run = (tuning: Record<string, number>) => {
      const sc = scene(makeConfig([ONE_STOREY, ...ROW], tuning), { s: 250, d: 2, speed: 25 });
      for (let t = 0; t < 600; t++) sc.step(held(1, 0, t % 120 < 60 ? 0.3 : -0.3));
      const { tick, timeScale, movers, inputs, rng, systems, facts } = sc.world;
      return {
        hash: hashPlain(FNV_OFFSET, { tick, timeScale, movers, inputs, rng, systems, facts }),
        events: sc.events.map((e) => `${e.tick}:${e.type}:${JSON.stringify(e.data)}`),
        world: sc.world,
      };
    };
    const on = run({});
    const off = run(OLD_RULES);
    expect(on.events).toEqual(off.events);
    expect(on.hash).toBe(off.hash);
    expect(on.world.systems[STRUCTURE_STATE_KEY]).toBeUndefined();
  });
});
