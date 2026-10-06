// Pile-ups (playtest 4's answers, the maintainer, 2026-10-06: "Pile ups are fun lol"): a bike left on
// the road after a crash is a solid thing under the one contact rule (docs/content-packs.md, "Contact
// outcomes: one rule"). A square-on hit at the crash line's closing speed (`traffic.solidHitMps`, 10 m/s)
// or more brings the rider down (a pile-up); a crawl, a graze or a side brush wobbles him past it. The
// control is the old rule (`riders.pileUps` 0, as every recording made before it): ridden through with a
// wobble, never a crash. What must hold: a rider back on his bike is never crashed by a dropped bike
// while his respawn ghost lasts, a bike put down where a rider already is never crashes him, the bike is
// cleared at the remount, and the same inputs give the same hashes.
//
// The harness is the real systems in tick order (as tumble.test.ts), a rival who is knocked off by a
// scripted crash, and the player riding at its bike: the bike is planted where the test wants it
// (`r.parked`, as tumble.test.ts's run-back tests do) and the runner is put 40 m past it, so he is still
// running when the player arrives.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureNetwork } from '../../road';
import { aiSystem } from '../ai';
import { copsSystem } from '../cops';
import { modifiersSystem } from '../modifiers';
import { pedsSystem } from '../peds';
import { gridPosition, raceSystem } from '../race';
import { ridersSystem } from '../riders';
import { RIDER_CONTACT_HALF_WIDTH_M } from '../riders/contact';
import { trafficHitMps } from '../traffic/contact-rule';
import { trafficGhost, trafficSystem } from '../traffic';
import { InputFlag, type SimConfig, type SimEvent, type SimInput } from '../types';
import {
  addMover,
  createWorld,
  emit,
  hashPlain,
  orderSystems,
  stepWorld,
  type Mover,
  type SimSystem,
  type World,
} from '../world';
import { parkedBike, tumbleRecord, tumbleSystem } from '.';

const BIKE = { edge: 0, s: 300, d: 1.7, dir: 1 as const };

function config(tuning: Record<string, number>): SimConfig {
  const road = createRoadNetwork(fixtureNetwork([{ id: 'a', lengthM: 1200, kappa: 0 }]));
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 20, dir: 1 },
    finish: { road: 'a', s: 1180 },
    mainPath: ['a'],
    allowedRoads: ['a'],
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
  const rider = (i: number, player: boolean) => ({
    contentId: player ? 'base:player' : `base:rival-${i}`,
    name: player ? 'You' : `Rival ${i}`,
    role: player ? ('player' as const) : ('rival' as const),
    faction: 'rider' as const,
    controller: player
      ? { kind: 'player' as const, slot: 0 }
      : { kind: 'ai' as const, style: 'racer' as const },
    bike,
    massKg: 85,
    healthMax: 100,
  });
  return {
    seed: 4321,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 30,
      byPlaceCash: [100, 50],
      raceEndTimeoutTicks: 1800,
    },
    riders: [rider(0, false), rider(1, true)],
    weapons: [],
    trafficTypes: [],
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: { 'riders.steerScale': 1, 'riders.furniture': 1, ...tuning },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

/** The scripted crash: the rival goes down on `tick` (it stands in for combat, before tumble). */
function knockOff(orders: readonly { tick: number; rider: number }[]): SimSystem {
  return {
    name: 'combat',
    init() {},
    step(world: World) {
      for (const o of orders) if (o.tick === world.tick) emit(world, 'crash', o.rider, {});
    },
  };
}

interface Harness {
  world: World;
  config: SimConfig;
  rival: Mover;
  player: Mover;
  /** Steps once with the player's input; returns the tick's events. */
  step(input?: SimInput): SimEvent[];
  /** Knocks a rider off on the next tick. */
  knock(rider: number): void;
  hash(): number;
}

function harness(tuning: Record<string, number>): Harness {
  const cfg = config(tuning);
  const world = createWorld(cfg);
  cfg.riders.forEach((_d, i) => addMover(world, 'rider', gridPosition(cfg, i), i));
  const orders = [{ tick: 5, rider: 0 }];
  const systems = orderSystems([
    aiSystem,
    ridersSystem,
    knockOff(orders),
    copsSystem,
    trafficSystem,
    pedsSystem,
    tumbleSystem,
    raceSystem,
    modifiersSystem,
  ]);
  for (const s of systems) s.init(world, cfg);
  const rival = world.movers[0];
  const player = world.movers[1];
  if (!rival || !player) throw new Error('harness: no riders');
  return {
    world,
    config: cfg,
    rival,
    player,
    step(input = coast()) {
      return stepWorld(world, cfg, systems, [input]);
    },
    knock(rider: number) {
      orders.push({ tick: world.tick, rider });
    },
    hash() {
      const { tick, timeScale, params, movers, inputs, rng, systems: st } = world;
      return hashPlain(0x811c9dc5, { tick, timeScale, params, movers, inputs, rng, systems: st });
    },
  };
}

function coast(flags = 0): SimInput {
  return { steer: 0, throttle: 0, brake: 0, flags };
}

/** Steps until `done` holds; fails instead of hanging after `max` ticks. */
function until(h: Harness, done: () => boolean, input: () => SimInput = coast, max = 600): void {
  for (let t = 0; !done(); t++) {
    if (t >= max) throw new Error(`condition not reached in ${max} ticks`);
    h.step(input());
  }
}

/** The rival knocked off, his bike planted at BIKE and him 40 m past it, still to run back. */
function rivalDown(tuning: Record<string, number>): Harness {
  const h = harness(tuning);
  until(h, () => h.rival.mode === 'OnFoot');
  const r = tumbleRecord(h.world, 0);
  if (!r) throw new Error('no record');
  r.parked = { ...BIKE };
  h.rival.pos = { ...BIKE, s: BIKE.s + 40 };
  return h;
}

/**
 * The player put `gapM` behind the bike at `speed`, `dd` across from its line, heading `yaw` off the
 * road, then riding on with the bars straight and the throttle off for `ticks`: the events that name the
 * bike, and the player's mode at the end.
 */
function rideAt(
  h: Harness,
  o: { speed: number; dd?: number; yaw?: number; gapM?: number; ticks?: number },
): { events: SimEvent[]; mode: Mover['mode'] } {
  h.player.pos = { edge: 0, s: BIKE.s - (o.gapM ?? 6), d: BIKE.d + (o.dd ?? 0), dir: 1 };
  h.player.speed = o.speed;
  h.player.yaw = o.yaw ?? 0;
  h.player.h = 0;
  const events: SimEvent[] = [];
  for (let t = 0; t < (o.ticks ?? 60); t++) {
    for (const e of h.step())
      if (e.actor === h.player.id && e.data['object'] === 'parked-bike') events.push(e);
    if (h.player.mode !== 'Road' && h.player.mode !== 'Airborne') break;
  }
  return { events, mode: h.player.mode };
}

const SOLID = { 'riders.pileUps': 1 };
const OLD = { 'riders.pileUps': 0 };

describe('pile-ups: a dropped bike is solid by closing speed (the maintainer, 2026-10-06)', () => {
  it('square on at 20 m/s is a crash, a pile-up; the old rule (the control) only wobbled', () => {
    expect(trafficHitMps({})).toBe(10);
    const now = rideAt(rivalDown(SOLID), { speed: 20 });
    expect(now.mode).toBe('Tumble');
    const crash = now.events.find((e) => e.type === 'crash');
    expect(crash?.data).toMatchObject({ cause: 'barrier', object: 'parked-bike', hit: 'end', bikeOf: '0' });
    expect(crash?.target).toBeUndefined(); // the rider on foot did not knock him off: no blame, no grudge

    const old = rideAt(rivalDown(OLD), { speed: 20 });
    expect(old.mode).toBe('Road');
    expect(old.events.map((e) => e.type)).toEqual(['wobble']);
    expect(old.events[0]?.data['cause']).toBe('smash');
  });

  it('square on at a crawl (8 m/s, under the crash line) wobbles and stops short of the bike', () => {
    const h = rivalDown(SOLID);
    const slow = rideAt(h, { speed: 8 });
    expect(slow.mode).toBe('Road');
    expect(slow.events.map((e) => e.type)).toEqual(['wobble']);
    expect(slow.events[0]?.data).toMatchObject({ cause: 'barrier', object: 'parked-bike', hit: 'end' });
    expect(h.player.pos.s).toBeLessThan(BIKE.s);
  });

  it('a glancing hit at 20 m/s (overlapping it sideways by under 0.3 m: a graze) wobbles him past it', () => {
    // The two boxes overlap across the road by 0.15 m: the corner.
    const dd = 2 * RIDER_CONTACT_HALF_WIDTH_M - 0.15;
    const graze = rideAt(rivalDown(SOLID), { speed: 20, dd, ticks: 90 });
    expect(graze.mode).toBe('Road');
    expect(graze.events.filter((e) => e.type === 'crash')).toEqual([]);
    expect(graze.events[0]?.data).toMatchObject({ object: 'parked-bike', hit: 'graze' });
    expect(graze.events[0]?.type).toBe('wobble');
  });

  it('a side brush at 20 m/s (drifting into it from beside) wobbles, never a crash', () => {
    // Beside the bike with 0.1 m between them, drifting toward it at about 1.2 m/s.
    const side = rideAt(rivalDown(SOLID), { speed: 20, dd: 0.9, yaw: -0.06, gapM: 1.5, ticks: 40 });
    expect(side.mode).toBe('Road');
    expect(side.events.map((e) => [e.type, e.data['hit']])).toEqual([['wobble', 'side']]);
  });

  it('a rider is never crashed by a dropped bike while his respawn ghost lasts (the control: without it, he is)', () => {
    // The player knocked off too, his bike planted 3.5 m behind the rival's in the same line; he skips the
    // run-back, so he remounts at his bike with the rival's just ahead, and is put at 20 m/s at once.
    const remountBehind = (ghost: boolean) => {
      const h = rivalDown(SOLID);
      h.knock(h.player.id);
      until(h, () => h.player.mode === 'OnFoot', coast, 400);
      const mine = tumbleRecord(h.world, 1);
      const theirs = tumbleRecord(h.world, 0);
      if (!mine || !theirs) throw new Error('no record');
      mine.parked = { ...BIKE, s: BIKE.s - 3.5 };
      theirs.parked = { ...BIKE };
      h.rival.pos = { ...BIKE, s: BIKE.s + 40 };
      until(
        h,
        () => h.player.mode === 'Road',
        () => coast(InputFlag.skipRunBack),
        400,
      );
      expect(parkedBike(h.world, 1)).toBeNull(); // his own bike is cleared at the remount
      expect(parkedBike(h.world, 0)).not.toBeNull();
      expect(trafficGhost(h.world, 1)).toBe(true);
      if (!ghost) {
        const traffic = h.world.systems['traffic'] as { ghostT: number[]; ghostCapT: number[] };
        traffic.ghostT[1] = 0;
        traffic.ghostCapT[1] = 0;
      }
      h.player.speed = 20;
      const crashes: SimEvent[] = [];
      for (let t = 0; t < 30; t++)
        crashes.push(...h.step().filter((e) => e.actor === 1 && e.type === 'crash'));
      return crashes;
    };
    expect(remountBehind(true)).toEqual([]);
    expect(remountBehind(false).map((e) => e.data['object'])).toEqual(['parked-bike']);
  });

  it('a bike put down where a rider already is never crashes him', () => {
    // Already overlapping it and heading into it at 20 m/s, 0.6 rad off the road: 11 m/s across, over
    // the crash line, so only the held contact's rule keeps him up.
    const h = rivalDown(SOLID);
    h.player.pos = { ...BIKE, s: BIKE.s - 1.2, d: BIKE.d + 0.3 };
    h.player.speed = 20;
    h.player.yaw = -0.6;
    const events: SimEvent[] = [];
    for (let t = 0; t < 30; t++) events.push(...h.step());
    expect(events.filter((e) => e.actor === 1 && e.type === 'crash')).toEqual([]);
    expect(h.player.mode).toBe('Road');
  });

  it('the same pile-up gives the same hashes every run', () => {
    const run = () => {
      const h = rivalDown(SOLID);
      const r = rideAt(h, { speed: 20 });
      expect(r.mode).toBe('Tumble');
      const hashes: number[] = [];
      for (let t = 0; t < 120; t++) {
        h.step();
        hashes.push(h.hash());
      }
      return hashes;
    };
    expect(run()).toEqual(run());
  });
});
