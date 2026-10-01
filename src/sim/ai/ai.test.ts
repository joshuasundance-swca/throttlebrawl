// ai-1 and ai-2 unit tests: the AIController against scripted scenes on a fixture road. Only the
// phases the AI needs run (controllers, riders, race); every other phase is a no-op here, so these
// tests pin the AI's own behaviour while the sibling lanes fill theirs in. The race-long grudge is
// noted here with the world's `noteGrudge`, the one call tumble-2 makes when a rival gets up.
import { describe, expect, it } from 'vitest';
import { FNV_OFFSET } from '../../core';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type RoadPos } from '../../road';
import { raceState, raceSystem, rubberBandFactor } from '../race';
import { ridersSystem } from '../riders';
import { InputFlag, type SimAiPersonality, type SimConfig, type SimInput, type SimRiderDef } from '../types';
import {
  addMover,
  createWorld,
  hashPlain,
  noteGrudge,
  orderSystems,
  stepWorld,
  TICK_ORDER,
  type Mover,
  type SimSystem,
  type SystemName,
  type World,
} from '../world';
import { spawnPickup } from '../combat';
import { riderState } from '../riders';
import { aiState, aiSystem, AI_STYLE_IDS, grudgeTargets, resolveProfile, takedownPush } from './index';
import { see, vehicleSize } from './sense';

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

  it('falls back to the racer preset for a style id it does not know', () => {
    expect(resolveProfile('no-such-style', undefined).behaviour).toBe('racer');
    expect(resolveProfile('no-such-style', undefined).traits).toEqual(
      resolveProfile('racer', undefined).traits,
    );
    expect(resolveProfile('racer', undefined).behaviour).toBe('racer');
  });

  it('registers a preset for every rider style in the content schema except the cop (M4 rivals-1)', () => {
    expect([...AI_STYLE_IDS].sort()).toEqual(
      [
        'heavy-hitter',
        'weaver',
        'showboat',
        'grudge-keeper',
        'scrapper',
        'crowd-pleaser',
        'crew-boss',
        'racer',
      ].sort(),
    );
    expect(resolveProfile('weaver', undefined).traits.roadWeave).toBe(true);
    expect(resolveProfile('weaver', undefined, false).traits.roadWeave).toBe(false);
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

// ---- ai-2 ------------------------------------------------------------------------------------

/** The fixture chain with a rail along its right side (+d) on every road, like the M1 bridge. */
const railBundle = (() => {
  const b = fixtureNetwork([
    { id: 'a', lengthM: 800, kappa: 0 },
    { id: 'b', lengthM: 800, kappa: 1 / 600 },
    { id: 'c', lengthM: 800, kappa: 0 },
  ]);
  return {
    ...b,
    roads: b.roads.map((r) => ({
      ...r,
      barriers: [{ s0: 0, s1: r.lengthM, side: 'right' as const, kind: 'rail' as const, heightM: 1 }],
    })),
  };
})();
const railRoad = createRoadNetwork(railBundle);
const railRoute = createRouteProgress(railRoad, {
  id: 'r',
  network: 'fixture',
  start: { road: 'a', s: 20, dir: 1 },
  finish: { road: 'c', s: 760 },
  mainPath: ['a', 'b', 'c'],
  allowedRoads: ['a', 'b', 'c'],
  closed: false,
});
const ON_RAIL: Partial<SimConfig> = { road: railRoad, route: railRoute };

/** Every attack press by rider `id` on the player `pid`: which side of them it came from, and whether it kicked. */
function pressesOn(sc: Scene, id: number, pid: number, seconds: number, player: () => SimInput) {
  const out: { side: number; kick: boolean }[] = [];
  for (let t = 0; t < 60 * seconds; t++) {
    step(sc, player());
    const flags = sc.world.inputs[id]?.flags ?? 0;
    const me = sc.world.movers[id];
    const them = sc.world.movers[pid];
    if (flags & InputFlag.attack && me && them && aiState(sc.world).targetId[id] === pid) {
      // +1: the attacker is on the player's +d side, so its hit pushes the player toward −d.
      out.push({ side: me.pos.d > them.pos.d ? 1 : -1, kick: (flags & InputFlag.kick) !== 0 });
    }
  }
  return out;
}

describe('ai-2: the race-long grudge', () => {
  it('a racer who holds a grudge against the player hunts them and swings at them far more', () => {
    const run = (grudge: boolean) => {
      const sc = scene(
        [rival('racer', { aggression: 0.6 }), PLAYER],
        [
          { s: 30, d: 1.0, v: 28 },
          { s: 50, d: 2.2, v: 28 },
        ],
      );
      if (grudge) noteGrudge(sc.world, 0, 1);
      presses(sc, 0, 25, cruise(sc, 1));
      const st = aiState(sc.world);
      return { presses: st.pressesOnPlayer[0] ?? 0, hunt: st.huntTicksOnPlayer[0] ?? 0 };
    };
    const before = run(false);
    const after = run(true);
    console.log(
      `racer presses on the player in 25 s: ${before.presses} without a grudge, ${after.presses} with one; ` +
        `ticks hunting the player: ${before.hunt} and ${after.hunt}`,
    );
    expect(before.hunt).toBe(0);
    expect(after.hunt).toBeGreaterThan(60 * 10);
    expect(after.presses).toBeGreaterThan(before.presses);
    expect(after.presses).toBeGreaterThan(2);
  });

  it('a grudge comes first in a brawler’s target choice, ahead of its own preference', () => {
    const run = (grudge: boolean) => {
      const sc = scene(
        [rival('heavy-hitter', {}, 'a'), rival('racer', { aggression: 0, weave: 0 }, 'b'), PLAYER],
        [
          { s: 30, d: 1.7, v: 28 },
          { s: 44, d: 1.0, v: 28 },
          { s: 40, d: 2.4, v: 28 },
        ],
      );
      if (grudge) noteGrudge(sc.world, 0, 1);
      const player = cruise(sc, 2);
      const picks = new Map<number, number>();
      for (let t = 0; t < 60 * 5; t++) {
        step(sc, player());
        const target = aiState(sc.world).targetId[0] ?? -1;
        picks.set(target, (picks.get(target) ?? 0) + 1);
      }
      return picks;
    };
    // The heavy hitter prefers the player; a grudge against rival b turns it onto b.
    expect(run(false).get(2) ?? 0).toBeGreaterThan(60 * 4);
    expect(run(true).get(1) ?? 0).toBeGreaterThan(60 * 4);
  });

  it('lists who a rider holds a grudge against, and drops a rider once they finish', () => {
    const sc = scene(
      [rival('racer', {}, 'a'), rival('racer', {}, 'b'), PLAYER],
      [
        { s: 30, d: 1.2, v: 0 },
        { s: 30, d: 2.2, v: 0 },
        { s: 22, d: 1.7, v: 0 },
      ],
    );
    noteGrudge(sc.world, 0, 2);
    noteGrudge(sc.world, 0, 1);
    noteGrudge(sc.world, 1, 2);
    expect(grudgeTargets(sc.world, 0)).toEqual([1, 2]);
    expect(grudgeTargets(sc.world, 1)).toEqual([2]);
    expect(grudgeTargets(sc.world, 2)).toEqual([]);
    raceState(sc.world).finishOrder.push(2);
    expect(grudgeTargets(sc.world, 0)).toEqual([1]);
  });

  it('a race with a grudge noted mid-race gives the same hash every run', () => {
    const run = () => {
      const sc = scene(
        [rival('heavy-hitter', {}, 'a'), rival('racer', { weave: 0.8 }, 'b'), PLAYER],
        [
          { s: 30, d: 1.2, v: 0 },
          { s: 30, d: 2.2, v: 0 },
          { s: 22, d: 1.7, v: 0 },
        ],
        [{ s: 900, d: -1.7, v: 24, dir: -1 }],
      );
      const player = cruise(sc, 2);
      const hashes: number[] = [];
      for (let t = 0; t < 60 * 20; t++) {
        if (t === 300) noteGrudge(sc.world, 1, 2);
        step(sc, player());
        if (t % 30 === 0)
          hashes.push(hashPlain(FNV_OFFSET, { movers: sc.world.movers, systems: sc.world.systems }));
      }
      return hashes;
    };
    expect(run()).toEqual(run());
  });
});

describe('ai-2: takedown intent', () => {
  const cars = vehicleSize(config([PLAYER]));
  /** takedownPush for a player at d with the given cars, seen from a heavy hitter 3 m behind. */
  const pushFor = (
    over: Partial<SimConfig>,
    d: number,
    vehicles: { s: number; d: number; v: number; dir: 1 | -1 }[],
  ) => {
    const sc = scene(
      [rival('heavy-hitter'), PLAYER],
      [
        { s: 97, d: d - 1, v: 28 },
        { s: 100, d, v: 28 },
      ],
      vehicles,
      over,
    );
    const [me, them] = sc.riders;
    if (!me || !them) throw new Error('scene');
    const seen = sc.vehicles.flatMap((v) => {
      const s = see(sc.config.road, me, v, 250);
      return s ? [{ s, size: cars }] : [];
    });
    return takedownPush(sc.config.road, them, seen);
  };

  it('picks a rail when one is close, an oncoming car over that, and nothing on an empty road', () => {
    // No rail, no cars: nothing to push the player into, so no preference.
    expect(pushFor({}, 1.7, [])).toBe(0);
    // A rail on the right, 3.2 m from a player in the middle of their lane: toward the rail.
    expect(pushFor(ON_RAIL, 1.7, [])).toBe(1);
    // ...but not when the player is across the road from it.
    expect(pushFor(ON_RAIL, -1.7, [])).toBe(0);
    // An oncoming car about to pass: toward it, rail or not.
    expect(pushFor({}, 1.7, [{ s: 200, d: -1.7, v: 24, dir: -1 }])).toBe(-1);
    expect(pushFor(ON_RAIL, 1.7, [{ s: 200, d: -1.7, v: 24, dir: -1 }])).toBe(-1);
    // An oncoming car still far off does not count yet; one already past does not either.
    expect(pushFor(ON_RAIL, 1.7, [{ s: 800, d: -1.7, v: 24, dir: -1 }])).toBe(1);
    expect(pushFor(ON_RAIL, 1.7, [{ s: 80, d: -1.7, v: 24, dir: -1 }])).toBe(1);
    // A car going the player's own way is not oncoming traffic.
    expect(pushFor(ON_RAIL, 1.7, [{ s: 150, d: -1.7, v: 10, dir: 1 }])).toBe(1);
  });

  /** Oncoming cars every 200 m in the other lane, so one is always on its way. */
  const ONCOMING = Array.from({ length: 11 }, (_, i) => ({
    s: 250 + 200 * i,
    d: -1.7,
    v: 24,
    dir: -1 as const,
  }));

  it('with oncoming traffic, a heavy hitter works round to the player’s far side, so its hits push them into it', () => {
    const run = (style: string, vehicles: typeof ONCOMING) => {
      const sc = scene(
        [rival(style, { aggression: 0.8 }), PLAYER],
        [
          { s: 30, d: 0.6, v: 28 }, // starts on the player's −d side (the oncoming side)
          { s: 50, d: 1.7, v: 28 },
        ],
        vehicles,
      );
      if (style === 'racer') noteGrudge(sc.world, 0, 1); // a racer hunts only with a grudge
      return pressesOn(sc, 0, 1, 25, cruise(sc, 1));
    };
    const brawler = run('heavy-hitter', ONCOMING);
    const racer = run('racer', ONCOMING);
    const empty = run('heavy-hitter', []);
    const fromPlus = (xs: { side: number }[]) => xs.filter((x) => x.side > 0).length;
    console.log(
      `presses from the player's +d side (pushing toward oncoming): heavy hitter ${fromPlus(brawler)} of ${brawler.length}, ` +
        `racer with a grudge (no intent) ${fromPlus(racer)} of ${racer.length}, ` +
        `heavy hitter on an empty road ${fromPlus(empty)} of ${empty.length}`,
    );
    expect(brawler.length).toBeGreaterThan(3);
    expect(fromPlus(brawler) / brawler.length).toBeGreaterThanOrEqual(0.8);
    // Without takedown intent, or with nothing to push the player into, a hunter stays on the
    // side it started on.
    expect(racer.length).toBeGreaterThan(3);
    expect(fromPlus(racer) / racer.length).toBeLessThanOrEqual(0.2);
    expect(empty.length).toBeGreaterThan(3);
    expect(fromPlus(empty) / empty.length).toBeLessThanOrEqual(0.2);
  });

  it('on a railed bridge, a heavy hitter works round to push the player toward the rail', () => {
    const sc = scene(
      [rival('heavy-hitter', { aggression: 0.8 }), PLAYER],
      [
        { s: 30, d: 2.8, v: 28 }, // starts on the rail side of the player
        { s: 50, d: 1.7, v: 28 },
      ],
      [],
      ON_RAIL,
    );
    const got = pressesOn(sc, 0, 1, 25, cruise(sc, 1));
    const fromMinus = got.filter((x) => x.side < 0).length;
    console.log(`presses from the player's −d side (pushing toward the rail): ${fromMinus} of ${got.length}`);
    expect(got.length).toBeGreaterThan(3);
    expect(fromMinus / got.length).toBeGreaterThanOrEqual(0.8);
  });
});

describe('ai-2: difficulty', () => {
  it('the preset’s aggression scale changes how often a rival swings (Hard above Easy)', () => {
    const run = (riderAggression: number) => {
      const sc = scene(
        [rival('heavy-hitter', { aggression: 0.5 }), PLAYER],
        [
          { s: 30, d: 1.7, v: 28 },
          { s: 50, d: 1.7, v: 28 },
        ],
        [],
        { difficulty: { presetId: 'hard', riderAggression, copFrequency: 1, rubberBand: 1 } },
      );
      presses(sc, 0, 60, cruise(sc, 1));
      return aiState(sc.world).pressesOnPlayer[0] ?? 0;
    };
    const easy = run(0.75);
    const hard = run(1.25);
    console.log(`heavy-hitter presses on the player in 60 s: Easy scale ${easy}, Hard scale ${hard}`);
    expect(hard).toBeGreaterThan(easy);
  });

  it("Hard's rubber-band scale leaves the pack's first-to-last gap wider than Easy's", () => {
    // Four racers who never fight, around a player holding 28 m/s below the event's 30 m/s pace:
    // the band eases those ahead back and pulls those behind on, harder on Easy (1.5) than Hard (0.5).
    const run = (rubberBand: number) => {
      const defs = ['a', 'b', 'c', 'd'].map((n) => rival('racer', { aggression: 0, weave: 0 }, n));
      const sc = scene(
        [...defs, PLAYER],
        [
          { s: 20, d: 1.2, v: 28 },
          { s: 35, d: 2.2, v: 28 },
          { s: 140, d: 1.2, v: 28 },
          { s: 160, d: 2.2, v: 28 },
          { s: 90, d: 1.7, v: 28 },
        ],
        [],
        { difficulty: { presetId: 'custom', riderAggression: 1, copFrequency: 1, rubberBand } },
      );
      const player = cruise(sc, 4);
      let sum = 0;
      let n = 0;
      for (let t = 0; t < 60 * 40; t++) {
        step(sc, player());
        if (t % 60 === 59) {
          const p = sc.riders.map((r) => route.progressAt(r.pos.edge, r.pos.s));
          sum += Math.max(...p) - Math.min(...p);
          n++;
        }
      }
      return sum / n;
    };
    const easy = run(1.5);
    const normal = run(1);
    const hard = run(0.5);
    console.log(
      `pack spread, mean over 40 s: Easy band ${easy.toFixed(0)} m, Normal ${normal.toFixed(0)} m, Hard ${hard.toFixed(0)} m`,
    );
    expect(hard).toBeGreaterThan(normal);
    expect(normal).toBeGreaterThan(easy);
  });
});

// ---- M4 rivals-1 (built early): the cast's styles, rivalries, career grudges, preferred weapons ----

/** One style's behaviour, measured in six scripted probes (means over the seeds). */
interface Fingerprint {
  /** Probe 1, an open road from a standstill with fights off: metres covered in the first 12 s. */
  launchM: number;
  /** Probe 1: spread of its lateral position (standard deviation, metres) from 12 s to 30 s. */
  laneStdM: number;
  /** Probe 1: mean speed from 15 s to 30 s, m/s. */
  cruiseMps: number;
  /** Probe 2, the race leader alongside it: swings at the leader in 10 s. */
  leaderSwings: number;
  /** Probe 3, hit once by the player with a decoy rival nearer: ticks hunting the player in the 4 s after the hit... */
  huntSoon: number;
  /** ...and from 9 s to 20 s after it. */
  huntLate: number;
  /** Probe 4, at 35 % health with the player alongside: ticks spent fleeing, and swings, in 10 s. */
  fleeTicks: number;
  hurtSwings: number;
  /** Probe 5, a rider 4 m behind it and the player 12 m ahead: ticks targeting the rider behind, in 6 s. */
  chaserTicks: number;
  /** Probe 6, the player 30 m behind and slower: its lowest speed in 6 s (a hunter waits for them). */
  waitMinMps: number;
}

const FP_SEEDS = [11, 12, 13];
const PRINT_KEYS: readonly (keyof Fingerprint)[] = [
  'launchM',
  'laneStdM',
  'cruiseMps',
  'leaderSwings',
  'huntSoon',
  'huntLate',
  'fleeTicks',
  'hurtSwings',
  'chaserTicks',
  'waitMinMps',
];

/** A player input that holds rider `id` `leadM` metres ahead of rider `of` and `offD` metres to its +d side. */
function shadow(sc: Scene, id: number, of: number, leadM: number, offD: number): SimInput {
  const me = sc.world.movers[id];
  const ai = sc.world.movers[of];
  if (!me || !ai) return { steer: 0, throttle: 0, brake: 0, flags: 0 };
  const gap = along(ai, me);
  const want = Math.max(-1, Math.min(1, (leadM - gap) * 0.6 + (ai.speed - me.speed) * 0.4));
  return {
    steer: Math.round(
      Math.max(-1, Math.min(1, (Math.min(4, ai.pos.d + offD) - me.pos.d) * 0.6 - me.yaw * 2)) * 127,
    ),
    throttle: want > -0.6 ? Math.round(Math.min(1, Math.max(0, 0.6 + want)) * 255) : 0,
    brake: want < -0.6 ? Math.round(Math.min(1, -want) * 255) : 0,
    flags: 0,
  };
}

function fingerprintRun(style: string, seed: number, quirks = 1): Fingerprint {
  const over = { seed, tuning: { 'riders.steerScale': 1, 'ai.styleQuirks': quirks } };
  // Probe 1: open road, fights off (aggression 0), the player parked far behind.
  const p1 = scene(
    [rival(style, { aggression: 0 }, 'me'), PLAYER],
    [
      { s: 40, d: 1.7, v: 0 },
      { s: 5, d: -1.7, v: 0 },
    ],
    [],
    over,
  );
  const me1 = p1.riders[0];
  const start = me1 ? route.progressAt(me1.pos.edge, me1.pos.s) : 0;
  let launchM = 0;
  const ds: number[] = [];
  let speedSum = 0;
  let speedN = 0;
  for (let t = 0; t < 60 * 30; t++) {
    step(p1);
    if (!me1) break;
    if (t === 60 * 12 - 1) launchM = route.progressAt(me1.pos.edge, me1.pos.s) - start;
    if (t >= 60 * 12) ds.push(me1.pos.d);
    if (t >= 60 * 15) {
      speedSum += me1.speed;
      speedN++;
    }
  }
  const mean = ds.reduce((a, b) => a + b, 0) / Math.max(1, ds.length);
  const laneStdM = Math.sqrt(ds.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, ds.length));

  // Probe 2: the player leads the race, held 1.5 m ahead of it and alongside, every tick.
  const p2 = scene(
    [rival(style, undefined, 'me'), PLAYER],
    [
      { s: 100, d: 1.2, v: 28 },
      { s: 101.5, d: 2.6, v: 28 },
    ],
    [],
    over,
  );
  for (let t = 0; t < 60 * 10; t++) step(p2, shadow(p2, 1, 0, 0.5, 1.2));
  const leaderSwings = aiState(p2.world).pressesOnLeader[0] ?? 0;

  // Probe 3: the player lands one hit on it at 1 s; a non-fighting decoy rides nearer than the player.
  const p3 = scene(
    [
      rival(style, { targetPreference: ['nearest'] }, 'me'),
      rival('racer', { aggression: 0, weave: 0 }, 'decoy'),
      PLAYER,
    ],
    [
      { s: 100, d: 1.7, v: 28 },
      { s: 104, d: 1.2, v: 28 },
      { s: 88, d: 1.7, v: 28 },
    ],
    [],
    over,
  );
  const drive3 = cruise(p3, 2);
  let huntSoon = 0;
  let huntLate = 0;
  for (let t = 0; t < 60 * 21; t++) {
    if (t === 60) {
      p3.world.lastEvents = [{ tick: t - 1, type: 'hit', actor: 2, target: 0, data: {}, causeId: 1 }];
    }
    step(p3, drive3());
    const onPlayer = aiState(p3.world).targetId[0] === 2;
    if (onPlayer && t >= 60 && t < 60 * 5) huntSoon++;
    if (onPlayer && t >= 60 * 10) huntLate++;
  }

  // Probe 4: hurt (35 % health), with the player alongside.
  const p4 = scene(
    [rival(style, undefined, 'me'), PLAYER],
    [
      { s: 100, d: 1.2, v: 28 },
      { s: 100.5, d: 2.6, v: 28 },
    ],
    [],
    over,
  );
  riderState(p4.world).health[0] = 35;
  const drive4 = cruise(p4, 1);
  for (let t = 0; t < 60 * 10; t++) step(p4, drive4());
  const st4 = aiState(p4.world);

  // Probe 5: a non-fighting rider 4 m behind it, the player 12 m ahead.
  const p5 = scene(
    [rival(style, undefined, 'me'), rival('racer', { aggression: 0, weave: 0 }, 'chaser'), PLAYER],
    [
      { s: 200, d: 1.7, v: 28 },
      { s: 196, d: 1.0, v: 29 },
      { s: 212, d: 1.7, v: 28 },
    ],
    [],
    over,
  );
  const drive5 = cruise(p5, 2);
  let chaserTicks = 0;
  for (let t = 0; t < 60 * 6; t++) {
    step(p5, drive5());
    if (aiState(p5.world).targetId[0] === 1) chaserTicks++;
  }

  // Probe 6: the player 30 m behind and slower.
  const p6 = scene(
    [rival(style, undefined, 'me'), PLAYER],
    [
      { s: 80, d: 1.7, v: 30 },
      { s: 50, d: 1.7, v: 24 },
    ],
    [],
    over,
  );
  const drive6 = cruise(p6, 1);
  let waitMinMps = Infinity;
  for (let t = 0; t < 60 * 6; t++) {
    step(p6, { ...drive6(), throttle: 120 });
    waitMinMps = Math.min(waitMinMps, p6.riders[0]?.speed ?? 0);
  }

  return {
    launchM,
    laneStdM,
    cruiseMps: speedSum / Math.max(1, speedN),
    leaderSwings,
    huntSoon,
    huntLate,
    fleeTicks: st4.fleeTicks[0] ?? 0,
    hurtSwings: st4.presses[0] ?? 0,
    chaserTicks,
    waitMinMps,
  };
}

function fingerprint(style: string, quirks = 1): Fingerprint {
  const runs = FP_SEEDS.map((seed) => fingerprintRun(style, seed, quirks));
  const out = {} as Fingerprint;
  for (const k of PRINT_KEYS) out[k] = runs.reduce((a, r) => a + r[k], 0) / runs.length;
  return out;
}

describe('ai: the cast’s styles (M4 rivals-1)', () => {
  const prints = new Map<string, Fingerprint>(AI_STYLE_IDS.map((s) => [s, fingerprint(s)]));
  const fp = (s: string): Fingerprint => {
    const p = prints.get(s);
    if (!p) throw new Error(`no fingerprint for ${s}`);
    return p;
  };
  const others = (s: string) => AI_STYLE_IDS.filter((x) => x !== s).map(fp);

  it('prints every style’s fingerprint over the seeded batch', () => {
    const rows = AI_STYLE_IDS.map(
      (s) => `${s.padEnd(14)} ${PRINT_KEYS.map((k) => `${k} ${fp(s)[k].toFixed(2)}`).join('  ')}`,
    );
    console.log(`style fingerprints (means over seeds ${FP_SEEDS.join(', ')}):\n${rows.join('\n')}`);
    expect(prints.size).toBe(AI_STYLE_IDS.length);
  });

  it('every style rides measurably differently from every other', () => {
    for (const a of AI_STYLE_IDS) {
      for (const b of AI_STYLE_IDS) {
        if (a >= b) continue;
        const diff = PRINT_KEYS.some((k) => Math.abs(fp(a)[k] - fp(b)[k]) > 0.05 * (Math.abs(fp(a)[k]) + 1));
        expect(diff, `${a} vs ${b}`).toBe(true);
      }
    }
  });

  it('a weaver swerves widest; a heavy hitter is slowest off the line, a scrapper quickest', () => {
    for (const o of others('weaver')) expect(fp('weaver').laneStdM).toBeGreaterThan(o.laneStdM);
    for (const o of others('heavy-hitter')) expect(fp('heavy-hitter').launchM).toBeLessThan(o.launchM);
    for (const o of others('scrapper')) expect(fp('scrapper').launchM).toBeGreaterThan(o.launchM);
  });

  it('a showboat never swings at the race leader; a racer does', () => {
    expect(fp('showboat').leaderSwings).toBe(0);
    expect(fp('racer').leaderSwings).toBeGreaterThan(0);
  });

  it('a grudge-keeper hunts whoever hit it for the rest of the race; a scrapper hits back, then lets go', () => {
    for (const o of others('grudge-keeper')) expect(fp('grudge-keeper').huntLate).toBeGreaterThan(o.huntLate);
    expect(fp('scrapper').huntSoon).toBeGreaterThan(0);
    expect(fp('scrapper').huntLate).toBeLessThan(fp('grudge-keeper').huntLate / 4);
    expect(fp('racer').huntSoon + fp('racer').huntLate).toBe(0);
  });

  it('a crowd-pleaser flees a fight that has turned; a heavy hitter fights on', () => {
    expect(fp('crowd-pleaser').fleeTicks).toBeGreaterThan(60 * 5);
    expect(fp('crowd-pleaser').hurtSwings).toBe(0);
    expect(fp('heavy-hitter').fleeTicks).toBe(0);
    expect(fp('heavy-hitter').hurtSwings).toBeGreaterThan(0);
  });

  it('a crew boss deals with the rider closing from behind first, and waits for nobody', () => {
    for (const o of others('crew-boss')) expect(fp('crew-boss').chaserTicks).toBeGreaterThan(o.chaserTicks);
    expect(fp('crew-boss').waitMinMps).toBeGreaterThan(fp('heavy-hitter').waitMinMps + 2);
  });

  it('with ai.styleQuirks off, the weaver keeps its numbers but loses its road-wide swerve', () => {
    const off = fingerprint('weaver', 0);
    console.log(
      `weaver lateral spread: quirks on ${fp('weaver').laneStdM.toFixed(2)} m, off ${off.laneStdM.toFixed(2)} m`,
    );
    expect(off.laneStdM).toBeLessThan(fp('weaver').laneStdM * 0.8);
  });
});

describe('ai: career grudges, rivalries and preferred weapons (M4 rivals-1)', () => {
  /** Ticks each of two racers spends hunting the player over 15 s, with the given grudge table. */
  function huntWith(grudges: SimConfig['grudges'], huntAt?: number) {
    const tuning: Record<string, number> = { 'riders.steerScale': 1 };
    if (huntAt !== undefined) tuning['ai.grudgeHuntAt'] = huntAt;
    const sc = scene(
      [rival('racer', {}, 'holder'), rival('racer', {}, 'calm'), PLAYER],
      [
        { s: 100, d: 1.2, v: 28 },
        { s: 100, d: 2.6, v: 28 },
        { s: 92, d: 1.7, v: 28 },
      ],
      [],
      { grudges, tuning },
    );
    const drive = cruise(sc, 2);
    for (let t = 0; t < 60 * 15; t++) step(sc, drive());
    const st = aiState(sc.world);
    return { holder: st.huntTicksOnPlayer[0] ?? 0, calm: st.huntTicksOnPlayer[1] ?? 0 };
  }

  it('a rival holding a high career grudge targets the player more than one holding none', () => {
    const got = huntWith({ 'base:holder': { 'base:player': 6 } });
    console.log(`career grudge 6 vs none: ticks hunting the player in 15 s ${got.holder} vs ${got.calm}`);
    expect(got.holder).toBeGreaterThan(got.calm + 120);
    // Bare ids work on both sides of the table, and points under ai.grudgeHuntAt hunt nobody.
    expect(huntWith({ holder: { player: 6 } }).holder).toBe(got.holder);
    expect(huntWith({ 'base:holder': { 'base:player': 3 } }).holder).toBe(0);
    expect(huntWith({ 'base:holder': { 'base:player': 3 } }, 3).holder).toBe(got.holder);
  });

  it('an authored rivalry makes a racer hunt and swing at its rival, with no grudge', () => {
    const run = (rivals?: string[]) => {
      const sc = scene(
        [
          rival('racer', rivals ? { rivals } : {}, 'a'),
          rival('racer', { aggression: 0, weave: 0 }, 'b'),
          PLAYER,
        ],
        [
          { s: 100, d: 1.7, v: 28 },
          { s: 110, d: 1.2, v: 28 },
          { s: 20, d: 1.7, v: 28 },
        ],
      );
      const drive = cruise(sc, 2);
      let onRival = 0;
      for (let t = 0; t < 60 * 15; t++) {
        step(sc, drive());
        if (aiState(sc.world).targetId[0] === 1) onRival++;
      }
      return { onRival, swings: aiState(sc.world).presses[0] ?? 0 };
    };
    const feud = run(['b']);
    const none = run();
    console.log(
      `rivalry: ticks hunting its rival ${feud.onRival} (swings ${feud.swings}); without ${none.onRival} (${none.swings})`,
    );
    expect(feud.onRival).toBeGreaterThan(60 * 5);
    expect(none.onRival).toBe(0);
    expect(feud.swings).toBeGreaterThan(none.swings);
    // Prefixed ids in the rider file resolve the same way.
    expect(resolveProfile('racer', { rivals: ['base:b'] }).rivals).toEqual(['b']);
  });

  it('an unarmed rider steers over its preferred weapon; one without a preference rides past', () => {
    const run = (preferredWeapon?: string) => {
      const sc = scene(
        [rival('racer', { weave: 0, ...(preferredWeapon ? { preferredWeapon } : {}) }), PLAYER],
        [
          { s: 100, d: 2.4, v: 28 },
          { s: 20, d: -1.7, v: 0 },
        ],
      );
      const pickup = spawnPickup(sc.world, 'base:chain', { edge: 0, s: 220, d: 0.4, dir: 1 });
      const me = sc.riders[0];
      let missAt = Infinity;
      for (let t = 0; t < 60 * 8; t++) {
        step(sc);
        const p = sc.world.movers[pickup];
        if (me && p && Math.abs(along(me, p)) < 2) missAt = Math.min(missAt, Math.abs(me.pos.d - p.pos.d));
      }
      return { missAt, seek: aiState(sc.world).seekTicks[0] ?? 0 };
    };
    const wants = run('chain');
    const other = run('briefcase');
    const none = run();
    console.log(
      `closest pass to a lying chain: prefers it ${wants.missAt.toFixed(2)} m, prefers a briefcase ${other.missAt.toFixed(2)} m, no preference ${none.missAt.toFixed(2)} m`,
    );
    expect(wants.seek).toBeGreaterThan(0);
    expect(wants.missAt).toBeLessThan(0.6);
    expect(other.missAt).toBeGreaterThan(1);
    expect(none.missAt).toBeGreaterThan(1);
  });
});
