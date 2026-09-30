import { describe, expect, it } from 'vitest';
import type { ActionState } from '../../app';
import type { EntitySnapshot, LaneInfo, RouteQueries, SimSnapshot } from '../../sim/api';
import { ATTACK_REPEAT_TICKS, createBot } from './index';

// Unit tests of the bot's decisions on hand-built snapshots. The real-data check is the seeded
// batch (tests/sim/) and the browser race, which drive the bot against the real sim.

const LANES: LaneInfo[] = [
  { id: 'L0', dCenterM: -4.15, widthM: 1.5, direction: -1, kind: 'shoulder' },
  { id: 'L1', dCenterM: -1.7, widthM: 3.4, direction: -1, kind: 'drive' },
  { id: 'R1', dCenterM: 1.7, widthM: 3.4, direction: 1, kind: 'drive' },
  { id: 'R0', dCenterM: 4.15, widthM: 1.5, direction: 1, kind: 'shoulder' },
];

function route(lanes: readonly LaneInfo[] = LANES): RouteQueries {
  return {
    lanesAt: () => lanes,
    kappaAt: () => 0,
    distanceToFinish: (_e, s) => 1000 - s,
    edgeLength: () => 1000,
  };
}

function mover(id: number, over: Partial<EntitySnapshot> & { s?: number; d?: number }): EntitySnapshot {
  const { s = 100, d = 1.7, ...rest } = over;
  return {
    id,
    kind: 'rider',
    mode: 'Road',
    road: { edge: 0, s, d, h: 0, dir: 1, yaw: 0 },
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    speed: 30,
    lean: 0,
    contentId: '',
    name: '',
    faction: 'rider',
    slot: -1,
    throttle: 0,
    rpm: 0,
    gear: 1,
    grounded: true,
    health: 100,
    healthMax: 100,
    attackPhase: 'idle',
    heldWeapon: null,
    targetId: -1,
    lastAttackerId: -1,
    progress: s,
    distanceToFinish: 1000 - s,
    place: 1,
    finished: false,
    ...rest,
  };
}

function snapshot(tick: number, entities: EntitySnapshot[]): SimSnapshot {
  return { tick, timeScale: 1, entities, race: { over: false, routeLength: 1000, finishOrder: [] } };
}

function blank(): ActionState {
  return {
    throttle: 0,
    brake: 0,
    steer: 0,
    attack: false,
    attackSide: 0,
    kick: false,
    lookBack: false,
    skipRunBack: false,
  };
}

const ME = 0;

describe('dev/bot: the BotController', () => {
  it('rides full throttle in its lane on an empty road', () => {
    const bot = createBot();
    const a = blank();
    bot.drive(snapshot(10, [mover(ME, { slot: 0 })]), ME, route(), a);
    expect(a.throttle).toBe(1);
    expect(a.brake).toBe(0);
    expect(Math.abs(a.steer)).toBeLessThan(0.01);
    expect(a.attack).toBe(false);
  });

  it('steers back toward its lane centre when off it', () => {
    const a = blank();
    createBot().drive(snapshot(10, [mover(ME, { d: 0.2 })]), ME, route(), a);
    expect(a.steer).toBeGreaterThan(0.3); // lane centre is to the right (+d, dir +1)
  });

  it('presses attack (one press edge) with a rival alongside inside its window, then waits', () => {
    const bot = createBot();
    const rival = mover(1, { s: 100.3, d: 0.6 });
    const presses: boolean[] = [];
    for (let t = 0; t < 40; t++) {
      const a = blank();
      bot.drive(snapshot(t, [mover(ME, { d: 1.7 }), rival]), ME, route(), a);
      presses.push(a.attack);
    }
    // Pressed on the first tick, released, and pressed again only after the repeat interval.
    expect(presses[0]).toBe(true);
    expect(presses[1]).toBe(false);
    expect(presses.filter(Boolean).length).toBe(2);
    expect(presses.indexOf(true, 1)).toBe(ATTACK_REPEAT_TICKS);
    expect(bot.stats().attackPresses).toBe(2);
  });

  it('never attacks the cop, and does not swing at a rival out of reach', () => {
    const a = blank();
    const bot = createBot();
    bot.drive(snapshot(5, [mover(ME, {}), mover(1, { s: 100.2, d: 0.6, faction: 'law' })]), ME, route(), a);
    expect(a.attack).toBe(false);
    const b = blank();
    bot.drive(snapshot(6, [mover(ME, {}), mover(2, { s: 100.2, d: -1.7 })]), ME, route(), b);
    expect(b.attack).toBe(false); // 3.4 m to the side
  });

  it('closes on a rival ahead and lines up beside it', () => {
    const a = blank();
    createBot().drive(snapshot(5, [mover(ME, { d: 1.7 }), mover(1, { s: 130, d: 1.7 })]), ME, route(), a);
    expect(a.throttle).toBe(1);
    expect(Math.abs(a.steer)).toBeGreaterThan(0.1); // moving off the rival's line to ride beside it
  });

  it('treats only vehicles as traffic: riders ahead on the grid, or the cop beside it, never make it brake', () => {
    // An oncoming car 150 m out closes the pass lane, as real traffic does, so dodging is no way out.
    const oncoming = mover(9, { kind: 'vehicle', s: 250, d: -1.7, speed: 24 });
    oncoming.road = { ...oncoming.road, dir: -1 };
    // The grid start: two rivals 8 m ahead in its line (riders pass through each other in the sim).
    const bot = createBot();
    const a = blank();
    const grid = [
      mover(ME, { s: 100, d: 0.9, speed: 0 }),
      mover(1, { s: 108, d: 0.9, speed: 0 }),
      mover(2, { s: 108, d: 2.4, speed: 0 }),
      oncoming,
    ];
    bot.drive(snapshot(1, grid), ME, route(), a);
    expect(a.throttle).toBe(1);
    expect(a.brake).toBe(0);
    // The cop pulled up 1 m ahead in its line, matching its speed: no brake, no swerve away.
    const b = blank();
    const cop = mover(5, { s: 101, d: 1.2, speed: 20, faction: 'law' });
    bot.drive(snapshot(9, [mover(ME, { speed: 20 }), cop, oncoming]), ME, route(), b);
    expect(b.throttle).toBe(1);
    expect(b.brake).toBe(0);
    expect(bot.stats().trafficDodges).toBe(0);
  });

  it('skips the run-back while down', () => {
    const bot = createBot();
    for (const mode of ['Tumble', 'OnFoot'] as const) {
      const a = blank();
      bot.drive(snapshot(5, [mover(ME, { mode })]), ME, route(), a);
      expect(a.skipRunBack).toBe(true);
      expect(a.attack).toBe(false);
    }
    expect(bot.stats().skipTicks).toBe(2);
  });

  it('leaves its lane for a free one when a car blocks it, and brakes when boxed in', () => {
    const car = mover(5, { kind: 'vehicle', s: 120, d: 1.7, speed: 20 });
    const a = blank();
    const bot = createBot();
    bot.drive(snapshot(5, [mover(ME, {}), car]), ME, route(), a);
    expect(a.steer).toBeLessThan(-0.3); // toward the clear oncoming lane to pass
    expect(bot.stats().trafficDodges).toBe(1);
    const oncoming = mover(6, { kind: 'vehicle', s: 180, d: -1.7, dir: -1 } as Partial<EntitySnapshot>);
    oncoming.road = { ...oncoming.road, dir: -1 };
    const b = blank();
    createBot().drive(snapshot(5, [mover(ME, {}), car, oncoming]), ME, route(), b);
    expect(b.throttle).toBe(0);
    expect(b.brake).toBeGreaterThan(0);
  });

  it('prefers a shortcut lane in its direction, once', () => {
    const withShortcut: LaneInfo[] = [
      ...LANES,
      { id: 'S1', dCenterM: 5.5, widthM: 3, direction: 1, kind: 'shortcut' },
    ];
    const bot = createBot();
    const a = blank();
    bot.drive(snapshot(5, [mover(ME, {})]), ME, route(withShortcut), a);
    expect(a.steer).toBeGreaterThan(0.3); // heading right, to the shortcut lane
    const b = blank();
    bot.drive(snapshot(6, [mover(ME, { d: 5.5 })]), ME, route(withShortcut), b);
    expect(bot.stats().shortcutTicks).toBe(1);
    // Left the shortcut: it does not go back for it.
    bot.drive(snapshot(7, [mover(ME, { d: 1.7 })]), ME, route(), blank());
    const c = blank();
    bot.drive(snapshot(8, [mover(ME, { d: 1.7 })]), ME, route(withShortcut), c);
    expect(Math.abs(c.steer)).toBeLessThan(0.01);
  });
});

describe('bot: road-2 ramp shortcut behind a split zone', () => {
  // road-2's cut is its own road: the route lists a split zone at the end of edge 0 (the right
  // edge of the road, d 2.4 to 4.9) whose connector leads onto it.
  const zone = { edge: 0, s0: 260, s1: 300, d0: 2.4, d1: 4.9, toEdge: 6, gainM: 54 };
  const zoned = (): RouteQueries => ({ ...route(), shortcuts: [zone] }) as RouteQueries;

  it('steers into the split zone on the approach, and not before', () => {
    const early = blank();
    const bot = createBot();
    bot.drive(snapshot(5, [mover(ME, { s: 60 })]), ME, zoned(), early);
    expect(Math.abs(early.steer)).toBeLessThan(0.01); // still in its lane, 200 m out
    const near = blank();
    bot.drive(snapshot(6, [mover(ME, { s: 200 })]), ME, zoned(), near);
    expect(near.steer).toBeGreaterThan(0.3); // heading right, into the zone
    expect(bot.stats().shortcutApproachTicks).toBe(1);
  });

  it('holds its line through the zone and past it the approach ends', () => {
    const bot = createBot();
    const inZone = blank();
    bot.drive(snapshot(5, [mover(ME, { s: 280, d: 3.3 })]), ME, zoned(), inZone);
    expect(Math.abs(inZone.steer)).toBeLessThan(0.05);
    const past = blank();
    bot.drive(
      snapshot(6, [mover(ME, { s: 290, d: 3.3, road: { edge: 7, s: 5, d: 3.3, h: 0, dir: 1, yaw: 0 } })]),
      ME,
      zoned(),
      past,
    );
    expect(bot.stats().shortcutApproachTicks).toBe(1);
  });

  it('keeps its line on the approach: swings at a rival already in reach, never chases one', () => {
    // A rival alongside, inside the attack window: it swings, but holds the zone line.
    const a = blank();
    const alongside = mover(2, { s: 200.3, d: 2.5 });
    createBot().drive(snapshot(40, [mover(ME, { s: 200, d: 3.3 }), alongside]), ME, zoned(), a);
    expect(a.attack).toBe(true);
    expect(Math.abs(a.steer)).toBeLessThan(0.05);
    expect(a.throttle).toBe(1);
    // A rival 20 m ahead: no chase off the line, no swing.
    const b = blank();
    const ahead = mover(3, { s: 220, d: 1.7 });
    createBot().drive(snapshot(40, [mover(ME, { s: 200, d: 3.3 }), ahead]), ME, zoned(), b);
    expect(b.attack).toBe(false);
    expect(Math.abs(b.steer)).toBeLessThan(0.05);
    expect(b.throttle).toBe(1);
  });

  it('on the approach it follows a car in its line rather than swerving out of the zone', () => {
    const a = blank();
    const car = mover(3, { kind: 'vehicle', s: 225, d: 3.3, speed: 24 });
    createBot().drive(snapshot(5, [mover(ME, { s: 200, d: 3.3 }), car]), ME, zoned(), a);
    expect(a.throttle).toBe(0);
    expect(a.brake).toBeGreaterThan(0);
    expect(a.steer).toBeGreaterThan(-0.05); // not off to the oncoming lane
  });
});
