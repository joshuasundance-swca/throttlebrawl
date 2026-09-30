// ai-1 unit tests: the AIController against scripted scenes on a fixture road. Only the phases
// the AI needs run (controllers, riders, race); every other phase is a no-op here, so these tests
// pin the AI's own behaviour while the sibling lanes fill theirs in.
import { describe, expect, it } from 'vitest';
import { FNV_OFFSET } from '../../core';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type RoadPos } from '../../road';
import { raceSystem, rubberBandFactor } from '../race';
import { ridersSystem } from '../riders';
import { InputFlag, type SimAiPersonality, type SimConfig, type SimInput, type SimRiderDef } from '../types';
import {
  addMover,
  createWorld,
  hashPlain,
  orderSystems,
  stepWorld,
  TICK_ORDER,
  type Mover,
  type SimSystem,
  type SystemName,
  type World,
} from '../world';
import { aiState, aiSystem, resolveProfile } from './index';

const noop = (name: SystemName): SimSystem => ({ name, init() {}, step() {} });
const SYSTEMS = orderSystems(
  TICK_ORDER.map((n) =>
    n === 'controllers' ? aiSystem : n === 'riders' ? ridersSystem : n === 'race' ? raceSystem : noop(n),
  ),
);

const road = createRoadNetwork(
  fixtureNetwork([
    { id: 'a', lengthM: 800, kappa: 0 },
    { id: 'b', lengthM: 800, kappa: 1 / 600 },
    { id: 'c', lengthM: 800, kappa: 0 },
  ]),
);
const route = createRouteProgress(road, {
  id: 'r',
  network: 'fixture',
  start: { road: 'a', s: 20, dir: 1 },
  finish: { road: 'c', s: 760 }, // 40 m before the road's end, like the M1 track
  mainPath: ['a', 'b', 'c'],
  allowedRoads: ['a', 'b', 'c'],
  closed: false,
});
const bike = {
  contentId: 'base:bike',
  topSpeedMps: 38,
  accelMps2: 4.2,
  brakeMps2: 9,
  steerRateMps: 5.5,
  massKg: 180,
};

function rival(style: string, personality?: SimAiPersonality, name = style): SimRiderDef {
  return {
    contentId: `base:${name}`,
    name,
    role: 'rival',
    faction: 'rider',
    controller: personality ? { kind: 'ai', style, personality } : { kind: 'ai', style },
    bike,
    massKg: 90,
    healthMax: 100,
  };
}

const PLAYER: SimRiderDef = {
  contentId: 'base:player',
  name: 'You',
  role: 'player',
  faction: 'rider',
  controller: { kind: 'player', slot: 0 },
  bike,
  massKg: 80,
  healthMax: 100,
};

function config(riders: SimRiderDef[], over: Partial<SimConfig> = {}): SimConfig {
  return {
    seed: 99,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 30,
      byPlaceCash: [1],
      raceEndTimeoutTicks: 1800,
    },
    riders,
    weapons: [],
    trafficTypes: [
      {
        contentId: 'base:car',
        category: 'car',
        lengthM: 4.5,
        widthM: 1.9,
        cruiseMps: 24.6,
        hazard: 'normal',
      },
    ],
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: { 'riders.steerScale': 1, 'ai.paceScale': 1, 'ai.aggressionScale': 1 },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
    ...over,
  };
}

interface Scene {
  world: World;
  config: SimConfig;
  riders: Mover[];
  vehicles: Mover[];
}

/** Riders at the given road positions and speeds; vehicles are added after them. */
function scene(
  defs: SimRiderDef[],
  at: { s: number; d: number; v: number }[],
  vehicles: { s: number; d: number; v: number; dir: 1 | -1 }[] = [],
  over: Partial<SimConfig> = {},
): Scene {
  const cfg = config(defs, over);
  const world = createWorld(cfg);
  const riders = defs.map((_, i) => {
    const p = at[i] ?? { s: 30, d: 1.7, v: 0 };
    const pos: RoadPos = { edge: 0, s: p.s, d: p.d, dir: 1 };
    road.advance(pos);
    const m = addMover(world, 'rider', pos, i);
    m.speed = p.v;
    return m;
  });
  const cars = vehicles.map((c) => {
    const pos: RoadPos = { edge: 0, s: c.s, d: c.d, dir: c.dir };
    road.advance(pos);
    const m = addMover(world, 'vehicle', pos);
    m.speed = c.v;
    return m;
  });
  for (const s of SYSTEMS) s.init(world, cfg);
  return { world, config: cfg, riders, vehicles: cars };
}

/** Steps the scene; vehicles move straight along their lane at their own speed. */
function step(sc: Scene, player: SimInput = { steer: 0, throttle: 0, brake: 0, flags: 0 }): void {
  for (const v of sc.vehicles) {
    v.pos.s += v.pos.dir * v.speed * (1 / 60);
    road.advance(v.pos);
  }
  stepWorld(sc.world, sc.config, SYSTEMS, [player]);
}

/** Along-road gap (b − a) between two movers on the fixture chain, in metres of route. */
function along(a: Mover, b: Mover): number {
  return route.progressAt(b.pos.edge, b.pos.s) - route.progressAt(a.pos.edge, a.pos.s);
}

/** Whether a rider overlaps a car body (4.5 × 1.9 m) plus the rider's half width. */
function overlaps(r: Mover, car: Mover): boolean {
  return Math.abs(along(car, r)) < 2.25 + 0.3 && Math.abs(r.pos.d - car.pos.d) < 0.95 + 0.3;
}

describe('ai: style presets and personality overrides', () => {
  it('lays a rider’s own numbers over its preset, clamped to 0..1', () => {
    const p = resolveProfile('heavy-hitter', { aggression: 0.2, weave: 1.4, targetPreference: ['leader'] });
    expect(p.behaviour).toBe('brawler');
    expect(p.aggression).toBe(0.2);
    expect(p.weave).toBe(1);
    expect(p.dirtiness).toBe(0.5); // from the preset
    expect(p.targetPreference).toEqual(['leader']);
  });

  it('falls back to the racer preset for a style without its own preset yet', () => {
    expect(resolveProfile('weaver', undefined).behaviour).toBe('racer');
    expect(resolveProfile('racer', undefined).behaviour).toBe('racer');
  });
});

describe('ai: the rubber band', () => {
  it('holds pace × its jitter × the race’s rubber-band factor: faster behind the player, slower ahead', () => {
    const sc = scene(
      [rival('racer', { weave: 0 }, 'ahead'), rival('racer', { weave: 0 }, 'behind'), PLAYER],
      [
        { s: 700, d: 1.7, v: 30 },
        { s: 40, d: 1.7, v: 30 },
        { s: 400, d: 1.7, v: 30 },
      ],
    );
    const player = cruise(sc, 2);
    for (let t = 0; t < 60 * 10; t++) step(sc, { ...player(), throttle: 255 });
    const st = aiState(sc.world);
    const factors = [rubberBandFactor(sc.world, 0), rubberBandFactor(sc.world, 1)];
    expect(factors[0]).toBeLessThan(1);
    expect(factors[1]).toBeGreaterThan(1);
    for (const id of [0, 1]) {
      const want = sc.config.event.paceMps * (st.paceJitter[id] ?? 1) * (factors[id] ?? 1);
      expect(Math.abs((sc.riders[id]?.speed ?? 0) - want)).toBeLessThan(0.6);
    }
  });
});

describe('ai: traffic', () => {
  it('goes around a parked car in its lane without touching it, and keeps going', () => {
    const sc = scene([rival('racer')], [{ s: 30, d: 1.7, v: 28 }], [{ s: 200, d: 1.7, v: 0, dir: 1 }]);
    const [r] = sc.riders;
    const [car] = sc.vehicles;
    if (!r || !car) throw new Error('scene');
    let touched = 0;
    for (let t = 0; t < 60 * 12; t++) {
      step(sc);
      if (overlaps(r, car)) touched++;
    }
    expect(touched).toBe(0);
    expect(along(car, r)).toBeGreaterThan(50); // well past it
  });

  it('never rides into an oncoming car while dodging a parked one', () => {
    const sc = scene(
      [rival('racer', { riskTaking: 1 })],
      [{ s: 30, d: 1.7, v: 28 }],
      [
        { s: 200, d: 1.7, v: 0, dir: 1 },
        { s: 420, d: -1.7, v: 24, dir: -1 },
      ],
    );
    const [r] = sc.riders;
    let touched = 0;
    for (let t = 0; t < 60 * 12; t++) {
      step(sc);
      for (const car of sc.vehicles) if (r && overlaps(r, car)) touched++;
    }
    expect(touched).toBe(0);
  });

  it('stops behind a wall of cars without touching it, then moves on when it clears', () => {
    const wall = [-3.4, 0, 3.4].map((d) => ({ s: 220, d, v: 0, dir: 1 as const }));
    const sc = scene([rival('racer')], [{ s: 30, d: 1.7, v: 28 }], wall);
    const [r] = sc.riders;
    if (!r) throw new Error('scene');
    let touched = 0;
    for (let t = 0; t < 60 * 10; t++) {
      step(sc);
      for (const car of sc.vehicles) if (overlaps(r, car)) touched++;
    }
    expect(touched).toBe(0);
    expect(r.speed).toBeLessThan(1);
    // The wall drives off down the road; the rider follows it and passes.
    for (const car of sc.vehicles) car.speed = 20;
    const before = route.progressAt(r.pos.edge, r.pos.s);
    for (let t = 0; t < 60 * 15; t++) step(sc);
    expect(route.progressAt(r.pos.edge, r.pos.s) - before).toBeGreaterThan(200);
  });

  it('passes a slower car in its lane without cutting back into it while alongside', () => {
    const sc = scene(
      [rival('racer', { weave: 0 })],
      [{ s: 30, d: 1.7, v: 30 }],
      [{ s: 110, d: 1.7, v: 20, dir: 1 }],
    );
    const [r] = sc.riders;
    const [car] = sc.vehicles;
    if (!r || !car) throw new Error('scene');
    let touched = 0;
    for (let t = 0; t < 60 * 20; t++) {
      step(sc);
      if (overlaps(r, car)) touched++;
    }
    expect(touched).toBe(0);
    expect(along(car, r)).toBeGreaterThan(20); // it got past
  });

  it('caught in the oncoming lane with a car coming, it gets out of that car’s way', () => {
    const sc = scene(
      [rival('racer', { weave: 0 })],
      [{ s: 30, d: -0.6, v: 30 }],
      [
        { s: 42, d: 1.7, v: 29, dir: 1 }, // a car just ahead in its own lane
        { s: 160, d: -1.7, v: 24, dir: -1 }, // and one coming the other way
      ],
    );
    const [r] = sc.riders;
    const oncoming = sc.vehicles[1];
    if (!r || !oncoming) throw new Error('scene');
    let touched = 0;
    for (let t = 0; t < 60 * 6; t++) {
      step(sc);
      if (overlaps(r, oncoming)) touched++;
    }
    expect(touched).toBe(0);
  });

  it('four rivals behind one parked car do not all pile into it', () => {
    const defs = ['a', 'b', 'c', 'd'].map((n) =>
      rival(n === 'a' || n === 'c' ? 'heavy-hitter' : 'racer', {}, n),
    );
    const sc = scene(
      defs,
      [
        { s: 30, d: 1.2, v: 28 },
        { s: 30, d: 2.2, v: 28 },
        { s: 22, d: 1.2, v: 28 },
        { s: 22, d: 2.2, v: 28 },
      ],
      [{ s: 200, d: 1.7, v: 0, dir: 1 }],
    );
    const [car] = sc.vehicles;
    let touched = 0;
    for (let t = 0; t < 60 * 12; t++) {
      step(sc);
      for (const r of sc.riders) if (car && overlaps(r, car)) touched++;
    }
    expect(touched).toBe(0);
  });
});

/** Runs a scene and collects every attack press the AI rider `id` made, with its target side. */
function presses(sc: Scene, id: number, seconds: number, player?: (t: number) => SimInput) {
  const out: { tick: number; flags: number; dd: number; ds: number }[] = [];
  const holdPlayer: SimInput = { steer: 0, throttle: 0, brake: 0, flags: 0 };
  for (let t = 0; t < 60 * seconds; t++) {
    step(sc, player ? player(t) : holdPlayer);
    const flags = sc.world.inputs[id]?.flags ?? 0;
    if (flags & InputFlag.attack) {
      const me = sc.world.movers[id];
      const other =
        sc.world.movers[aiState(sc.world).targetId[id] ?? -1] ?? sc.world.movers.find((m) => m.id !== id);
      if (me && other) out.push({ tick: t, flags, dd: other.pos.d - me.pos.d, ds: along(me, other) });
    }
  }
  return out;
}

/** A player who holds about 28 m/s in the middle of its lane. */
function cruise(sc: Scene, id: number) {
  return () => {
    const me = sc.world.movers[id];
    const v = me?.speed ?? 0;
    const d = me?.pos.d ?? 1.7;
    const yaw = me?.yaw ?? 0;
    return {
      steer: Math.round(Math.max(-1, Math.min(1, (1.7 - d) * 0.3 - yaw * 2)) * 127),
      throttle: v < 28 ? 220 : 90,
      brake: 0,
      flags: 0,
    };
  };
}

describe('ai: fights', () => {
  it('a heavy hitter hunts the player down, rides alongside and swings with the right side flag', () => {
    const sc = scene(
      [rival('heavy-hitter'), PLAYER],
      [
        { s: 30, d: 1.7, v: 28 },
        { s: 60, d: 1.7, v: 28 },
      ],
    );
    const got = presses(sc, 0, 20, cruise(sc, 1));
    expect(got.length).toBeGreaterThan(2);
    for (const p of got) {
      expect(Math.abs(p.ds)).toBeLessThanOrEqual(4); // inside the acquisition box
      expect(Math.abs(p.dd)).toBeLessThanOrEqual(3);
      // Riding toward +s, the rider's right is +d.
      const side = p.flags & (InputFlag.attackSideLeft | InputFlag.attackSideRight);
      expect(side).toBe(p.dd > 0 ? InputFlag.attackSideRight : InputFlag.attackSideLeft);
    }
    expect(aiState(sc.world).pressesOnPlayer[0]).toBe(got.length);
  });

  it('a heavy hitter waits for a player behind it; a racer does not', () => {
    const run = (style: string) => {
      const sc = scene(
        [rival(style), PLAYER],
        [
          { s: 80, d: 1.7, v: 30 },
          { s: 50, d: 1.7, v: 24 },
        ],
      );
      const player = cruise(sc, 1);
      let minSpeed = Infinity;
      for (let t = 0; t < 60 * 6; t++) {
        step(sc, { ...player(), throttle: 120 });
        minSpeed = Math.min(minSpeed, sc.riders[0]?.speed ?? 0);
      }
      return minSpeed;
    };
    expect(run('heavy-hitter')).toBeLessThan(26);
    expect(run('racer')).toBeGreaterThan(27);
  });

  it('with its own aggression at 0 a heavy hitter never swings', () => {
    const sc = scene(
      [rival('heavy-hitter', { aggression: 0 }), PLAYER],
      [
        { s: 30, d: 1.7, v: 28 },
        { s: 32, d: 2.8, v: 28 },
      ],
    );
    expect(presses(sc, 0, 15, cruise(sc, 1))).toEqual([]);
  });

  it('rivals fight each other when no player is near', () => {
    const sc = scene(
      [rival('heavy-hitter', {}, 'a'), rival('heavy-hitter', {}, 'b')],
      [
        { s: 30, d: 1.2, v: 28 },
        { s: 45, d: 2.4, v: 28 },
      ],
    );
    presses(sc, 0, 25);
    const st = aiState(sc.world);
    expect((st.presses[0] ?? 0) + (st.presses[1] ?? 0)).toBeGreaterThan(2);
    expect(st.pressesOnPlayer[0]).toBe(0);
  });

  it('a kick is pressed together with the attack and held through its wind-up', () => {
    const sc = scene(
      [rival('heavy-hitter', { dirtiness: 1, aggression: 1 }), PLAYER],
      [
        { s: 30, d: 1.7, v: 28 },
        { s: 40, d: 1.7, v: 28 },
      ],
    );
    const player = cruise(sc, 1);
    let kicks = 0;
    let heldAfterPress = 0;
    let lastPress = -100;
    for (let t = 0; t < 60 * 20; t++) {
      step(sc, player());
      const f = sc.world.inputs[0]?.flags ?? 0;
      if (f & InputFlag.attack) {
        lastPress = t;
        if (f & InputFlag.kick) kicks++;
      } else if (t - lastPress <= 5 && f & InputFlag.kick) heldAfterPress++;
    }
    expect(kicks).toBeGreaterThan(0);
    expect(heldAfterPress).toBeGreaterThan(0);
  });
});

describe('ai: the rest of the controller', () => {
  it('a rival who has finished pulls onto the shoulder, out of the lane', () => {
    const sc = scene(
      [rival('racer', { weave: 0 }), PLAYER],
      [
        { s: 2362, d: 1.7, v: 25 }, // just past the finish (c at 760)
        { s: 30, d: 1.7, v: 0 },
      ],
    );
    for (let t = 0; t < 60 * 3; t++) step(sc);
    // The drive lane toward +s spans d 0..3.4; its shoulder is centred at 4.15.
    expect(sc.riders[0]?.pos.d).toBeGreaterThan(3.4);
  });

  it('once the player is home, the rest stop fighting and hurry to the line', () => {
    const sc = scene(
      [rival('heavy-hitter', {}, 'a'), rival('racer', {}, 'b'), PLAYER],
      [
        { s: 30, d: 1.2, v: 28 },
        { s: 32, d: 2.4, v: 28 },
        { s: 2385, d: 1.7, v: 20 }, // past the finish (c at 760)
      ],
    );
    let swings = 0;
    for (let t = 0; t < 60 * 15; t++) {
      step(sc);
      for (const id of [0, 1]) if ((sc.world.inputs[id]?.flags ?? 0) & InputFlag.attack) swings++;
    }
    expect(swings).toBe(0);
    expect(sc.riders[0]?.speed).toBeGreaterThan(35);
    expect(sc.riders[1]?.speed).toBeGreaterThan(35);
  });

  it('asks for the quick remount while down, and leaves cops to the cops phase', () => {
    const cop: SimRiderDef = {
      ...rival('racer'),
      contentId: 'base:cop',
      role: 'cop',
      faction: 'law',
      controller: { kind: 'cop' },
    };
    const sc = scene(
      [rival('racer'), cop],
      [
        { s: 30, d: 1.7, v: 0 },
        { s: 40, d: 1.7, v: 0 },
      ],
    );
    const [r] = sc.riders;
    if (!r) throw new Error('scene');
    r.mode = 'Tumble';
    sc.world.inputs[1] = { steer: 5, throttle: 7, brake: 0, flags: 0 };
    step(sc);
    expect(sc.world.inputs[0]?.flags).toBe(InputFlag.skipRunBack);
    expect(sc.world.inputs[1]).toEqual({ steer: 5, throttle: 7, brake: 0, flags: 0 });
  });

  it('a scripted race gives the same hash every run', () => {
    const run = () => {
      const sc = scene(
        [rival('heavy-hitter', {}, 'a'), rival('racer', { weave: 0.8 }, 'b'), PLAYER],
        [
          { s: 30, d: 1.2, v: 0 },
          { s: 30, d: 2.2, v: 0 },
          { s: 22, d: 1.7, v: 0 },
        ],
        [
          { s: 300, d: 1.7, v: 10, dir: 1 },
          { s: 900, d: -1.7, v: 24, dir: -1 },
        ],
      );
      const player = cruise(sc, 2);
      const hashes: number[] = [];
      for (let t = 0; t < 60 * 30; t++) {
        step(sc, player());
        if (t % 30 === 0)
          hashes.push(
            hashPlain(FNV_OFFSET, {
              movers: sc.world.movers,
              inputs: sc.world.inputs,
              systems: sc.world.systems,
              rng: sc.world.rng,
            }),
          );
      }
      return hashes;
    };
    const a = run();
    expect(run()).toEqual(a);
    expect(new Set(a).size).toBeGreaterThan(50);
  });
});
