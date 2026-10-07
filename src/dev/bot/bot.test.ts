import { describe, expect, it } from 'vitest';
import type { ActionState } from '../../app';
import kickPack from '../../../packs/base/weapons/kick.json';
import type { EntitySnapshot, LaneInfo, RouteQueries, SimSnapshot } from '../../sim/api';
import {
  KICK_LEAD_TICKS,
  KICK_OFFSET_M,
  KICK_REPEAT_TICKS,
  REMOUNT_OWN_SIDE_TICKS,
  RETREAT_HEALTH,
  STUCK_TICKS,
  createBot,
} from './index';

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

  it('kicks (one press edge, aimed at the rival) with a rival alongside in reach, then waits out the kick', () => {
    const bot = createBot();
    const rival = mover(1, { s: 100.3, d: 0.6 });
    const kicks: number[] = [];
    const presses: number[] = [];
    let side = 0;
    for (let t = 0; t < KICK_REPEAT_TICKS + 2; t++) {
      const a = blank();
      bot.drive(snapshot(t, [mover(ME, { d: 1.7 }), rival]), ME, route(), a);
      if (a.attack) presses.push(t);
      if (a.attack && a.kick) {
        kicks.push(t);
        side = a.attackSide;
      }
    }
    // A kick on the first tick, aimed left (the rival is 1.1 m to its left), and the next kick only
    // after the kick's whole cycle, with no press in between (a kick leaves no room for a punch).
    expect(kicks).toEqual([0, KICK_REPEAT_TICKS]);
    expect(side).toBe(-1);
    expect(presses).toEqual(kicks);
    expect(bot.stats().kickPresses).toBe(2);
    expect(bot.stats().attackPresses).toBe(2);
  });

  it('models the kick as packs/base/weapons/kick.json has it: it leads by the wind-up and repeats as the leg returns', () => {
    const ticks = (s: number) => Math.max(1, Math.round(s * 60));
    const cycle = ticks(kickPack.windupS) + ticks(kickPack.activeS) + ticks(kickPack.recoveryS);
    const hitStop = Math.round((kickPack.hitStopMs * 60) / 1000);
    expect(KICK_LEAD_TICKS).toBe(ticks(kickPack.windupS));
    // Never before the leg is back (a press into the recovery is the sim's buffer, not a new kick),
    // and no later than the hit-stop and a few ticks of margin past it (a bot that idles through a
    // gap lands fewer kicks than the same rider does).
    expect(KICK_REPEAT_TICKS).toBeGreaterThanOrEqual(cycle + hitStop);
    expect(KICK_REPEAT_TICKS).toBeLessThanOrEqual(cycle + hitStop + 4);
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

  it("boxed in at a standstill, it follows a car going its way off the line at that car's pace", () => {
    // Dense traffic on Bridge City (the never-stuck lane): stopped with no lane free, the bot braked
    // whatever the car in its line did, so a queue moving at 9 m/s held it still for 941 ticks.
    const oncoming = mover(6, { kind: 'vehicle', s: 180, d: -1.7, speed: 9 });
    oncoming.road = { ...oncoming.road, dir: -1 };
    const moving = mover(5, { kind: 'vehicle', s: 125, d: 1.7, speed: 9 });
    const a = blank();
    createBot().drive(snapshot(5, [mover(ME, { speed: 0 }), moving, oncoming]), ME, route(), a);
    expect(a.throttle).toBe(1);
    expect(a.brake).toBe(0);
    // Up to that pace it holds it (no throttle, no brake); a stopped car, or one 3 m ahead, stops it.
    const farther = mover(5, { kind: 'vehicle', s: 130, d: 1.7, speed: 9 });
    const b = blank();
    createBot().drive(snapshot(5, [mover(ME, { speed: 9 }), farther, oncoming]), ME, route(), b);
    expect(b.throttle).toBe(0);
    expect(b.brake).toBe(0);
    const stopped = mover(5, { kind: 'vehicle', s: 125, d: 1.7, speed: 0 });
    const c = blank();
    createBot().drive(snapshot(5, [mover(ME, { speed: 9 }), stopped, oncoming]), ME, route(), c);
    expect(c.throttle).toBe(0);
    expect(c.brake).toBeGreaterThan(0);
    const close = mover(5, { kind: 'vehicle', s: 103, d: 1.7, speed: 9 });
    const d = blank();
    createBot().drive(snapshot(5, [mover(ME, { speed: 9 }), close, oncoming]), ME, route(), d);
    expect(d.brake).toBeGreaterThan(0);
  });

  it("follows a car by where a long vehicle's tail could be: it never rides up inside one", () => {
    // The snapshot gives a vehicle's middle, not its length, so a gap is judged against the longest
    // vehicle a race carries (a 16 m semi or log truck: its tail is 8 m behind its middle). Stopped
    // 4 m behind a middle, the bot was inside an 8.5 m cable car's box: San Francisco's runaway cable
    // car shoved it back down Hyde Street with the queue, and the race never ended (career-headless-sf,
    // the meter: 720 s of a 368 s limit).
    // Boxed in: a car coming the other way closes the pass.
    const oncoming = mover(6, { kind: 'vehicle', s: 180, d: -1.7, speed: 9 });
    oncoming.road = { ...oncoming.road, dir: -1 };
    const pullingAway = mover(5, { kind: 'vehicle', s: 109, d: 1.7, speed: 9 });
    const a = blank();
    createBot().drive(snapshot(5, [mover(ME, { speed: 0 }), pullingAway, oncoming]), ME, route(), a);
    expect(a.throttle).toBe(0); // its middle 9 m ahead: a semi's tail would be 1 m off the bike
    // The negative control: the same car with room behind its tail is followed off the line.
    const roomy = mover(5, { kind: 'vehicle', s: 125, d: 1.7, speed: 9 });
    const b = blank();
    createBot().drive(snapshot(5, [mover(ME, { speed: 0 }), roomy, oncoming]), ME, route(), b);
    expect(b.throttle).toBe(1);
  });

  it('stopped behind a vehicle that stays stopped, with the pass closed, it filters past on its own shoulder', () => {
    // San Francisco's runaway cable car (career-headless-sf, the meter): it rolled back down Hyde
    // Street, stopped in the lane for good, and the queue behind it with it. Cars came up the other
    // side often enough to keep the pass closed, and the bot stood behind the queue for the rest of
    // the race (2,351 ticks still at a stretch; 720 s of a 368 s limit).
    const oncoming = mover(6, { kind: 'vehicle', s: 180, d: -1.7, speed: 9 });
    oncoming.road = { ...oncoming.road, dir: -1 };
    const stopped = mover(5, { kind: 'vehicle', s: 114, d: 1.7, speed: 0 });
    const bot = createBot();
    const at = (tick: number, ahead: EntitySnapshot, me = mover(ME, { speed: 0 })) => {
      const a = blank();
      bot.drive(snapshot(tick, [me, ahead, oncoming]), ME, route(), a);
      return a;
    };
    // At first it waits: a queue that has just stopped may move off again.
    const first = at(1, stopped);
    expect(first.throttle).toBe(0);
    expect(Math.abs(first.steer)).toBeLessThan(0.05);
    let a = first;
    for (let t = 2; t <= STUCK_TICKS + 1; t++) a = at(t, stopped);
    expect(a.steer).toBeGreaterThan(0.3); // toward its shoulder (d 4.15)
    expect(a.throttle).toBe(1);
    // On the shoulder, alongside the queue, it rides on past it at a walking pace.
    const along = at(STUCK_TICKS + 2, stopped, mover(ME, { s: 108, d: 4.15, speed: 3 }));
    expect(along.throttle).toBe(1);
    expect(along.steer).toBeLessThan(0.05);
    const brisk = at(STUCK_TICKS + 3, stopped, mover(ME, { s: 110, d: 4.15, speed: 12 }));
    expect(brisk.throttle).toBe(0);
    // The negative control: behind a queue that is moving, however slowly, it never leaves its lane.
    const crawling = mover(5, { kind: 'vehicle', s: 114, d: 1.7, speed: 1 });
    const other = createBot();
    let c = blank();
    for (let t = 1; t <= STUCK_TICKS + 1; t++) {
      c = blank();
      other.drive(snapshot(t, [mover(ME, { speed: 0 }), crawling, oncoming]), ME, route(), c);
    }
    expect(Math.abs(c.steer)).toBeLessThan(0.05);
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

describe('bot: fighting a rival down (dev-4 part 2)', () => {
  // A wider road: two lanes each way, so the bot has room on both sides of a rival.
  const WIDE: LaneInfo[] = [
    { id: 'L1', dCenterM: -5.1, widthM: 3.4, direction: -1, kind: 'drive' },
    { id: 'L0', dCenterM: -1.7, widthM: 3.4, direction: -1, kind: 'drive' },
    { id: 'R0', dCenterM: 1.7, widthM: 3.4, direction: 1, kind: 'drive' },
    { id: 'R1', dCenterM: 5.1, widthM: 3.4, direction: 1, kind: 'drive' },
  ];

  it('kicks when the rival will be in reach as the wind-up ends, not on where it is now', () => {
    // Level now, but faster by the speed that puts it 0.9 m ahead by the time a kick goes active
    // (past the 0.8 m window). Hold the press.
    const dv = (0.9 * 60) / KICK_LEAD_TICKS;
    const a = blank();
    const bot = createBot();
    bot.drive(
      snapshot(5, [mover(ME, { d: 1.7, speed: 30 }), mover(1, { s: 100, d: 0.5, speed: 30 + dv })]),
      ME,
      route(),
      a,
    );
    expect(a.kick).toBe(false);
    // 0.9 m behind and closing at that speed: level as the kick goes active. Kick now.
    const b = blank();
    const lead = (dv * KICK_LEAD_TICKS) / 60;
    createBot().drive(
      snapshot(5, [mover(ME, { d: 1.7, speed: 30 }), mover(1, { s: 100 - lead, d: 0.5, speed: 30 + dv })]),
      ME,
      route(),
      b,
    );
    expect(b.attack && b.kick).toBe(true);
  });

  it('steers into the rival through the kick wind-up (the momentum kick), and holds the kick flag', () => {
    const bot = createBot();
    const rival = mover(1, { s: 100, d: 0.5 });
    const first = blank();
    bot.drive(snapshot(10, [mover(ME, { d: 1.7 }), rival]), ME, route(), first);
    expect(first.attack && first.kick).toBe(true);
    // Mid wind-up, still 1.2 m to its right: it steers left into the rival, kick flag held.
    const mid = blank();
    bot.drive(snapshot(16, [mover(ME, { d: 1.7 }), rival]), ME, route(), mid);
    expect(mid.attack).toBe(false);
    expect(mid.kick).toBe(true);
    expect(mid.steer).toBeLessThan(-0.4);
    // After the wind-up it lines up at the kick offset again, not on top of the rival.
    const after = blank();
    bot.drive(
      snapshot(10 + KICK_LEAD_TICKS + 10, [mover(ME, { d: 0.5 + KICK_OFFSET_M }), rival]),
      ME,
      route(),
      after,
    );
    expect(after.kick).toBe(false);
    expect(Math.abs(after.steer)).toBeLessThan(0.05);
  });

  it('lines up on the side that kicks the rival toward a car beside it', () => {
    // A rival in the middle of the bot's two lanes (d 3.4), a car 20 m ahead in the outer lane:
    // the bot sits on the inner side, so its kick shoves the rival outward, into the car's lane.
    const rival = mover(1, { s: 110, d: 3.4 });
    const car = mover(7, { kind: 'vehicle', s: 130, d: 5.6, speed: 20 });
    const a = blank();
    createBot().drive(snapshot(5, [mover(ME, { s: 100, d: 3.4 }), rival, car]), ME, route(WIDE), a);
    expect(a.steer).toBeLessThan(-0.3); // toward d = 3.4 - offset
    // The same with a car on the inner side (clear of the bot's own line): the bot goes outside.
    const inner = mover(7, { kind: 'vehicle', s: 130, d: -0.6, speed: 20 });
    const b = blank();
    createBot().drive(snapshot(5, [mover(ME, { s: 100, d: 3.4 }), rival, inner]), ME, route(WIDE), b);
    expect(b.steer).toBeGreaterThan(0.3);
  });

  it('counts a kick aimed into danger', () => {
    const bot = createBot();
    const rival = mover(1, { s: 100.2, d: 4.6 });
    const car = mover(7, { kind: 'vehicle', s: 120, d: 6.6, speed: 20 });
    const a = blank();
    bot.drive(snapshot(5, [mover(ME, { s: 100, d: 3.4 }), rival, car]), ME, route(WIDE), a);
    expect(a.attack && a.kick).toBe(true);
    expect(a.attackSide).toBe(1);
    expect(bot.stats().dangerKicks).toBe(1);
  });

  it('goes after the weaker of two rivals, and waits for one just behind it', () => {
    // A healthy rival 10 m ahead in the left lane, a hurt one 25 m ahead in the right lane.
    const strong = mover(1, { s: 110, d: -1.7, health: 100 });
    const weak = mover(2, { s: 125, d: 4.6, health: 20 });
    const a = blank();
    createBot().drive(snapshot(5, [mover(ME, { s: 100, d: 1.7 }), strong, weak]), ME, route(WIDE), a);
    expect(a.steer).toBeGreaterThan(0.3); // to the right, toward the weak one
    // A rival 20 m behind, as fast as the bot: it eases off to let it come alongside.
    const b = blank();
    createBot().drive(
      snapshot(5, [mover(ME, { s: 100, d: 1.7, speed: 40 }), mover(3, { s: 80, d: 1.7, speed: 40 })]),
      ME,
      route(WIDE),
      b,
    );
    expect(b.throttle).toBe(0);
  });

  it("stops fighting while hurt, and keeps out of a rival's kick reach", () => {
    const bot = createBot();
    const rival = mover(1, { s: 100.2, d: 0.6 });
    const a = blank();
    bot.drive(snapshot(5, [mover(ME, { d: 1.7, health: RETREAT_HEALTH - 1 }), rival]), ME, route(WIDE), a);
    expect(a.attack).toBe(false);
    expect(a.steer).toBeGreaterThan(0.3); // away from the rival on its left
    expect(bot.stats().engagements).toBe(0);
  });
});

describe('bot: a split zone across the oncoming lanes, and a remount', () => {
  // Bridge City's cut leaves from the oncoming side: the zone's line (d -3.3) is in the lane that
  // runs the other way. A bot back on the bike (it went down in the approach, and got up at the
  // spot it fell) keeps its own side: it rode into those lanes at a walking pace, in front of
  // cars closing at 25 m/s, again and again in one race (playtest 4, the respawn lane's finding).
  const zone = { edge: 0, s0: 260, s1: 300, d0: -4.9, d1: -2.4, toEdge: 6, gainM: 54 };
  const zoned = (): RouteQueries => ({ ...route(), shortcuts: [zone] }) as RouteQueries;
  /** The bot goes down at `downS`, then rides again from `upS` at a pace of 8 m/s. */
  function remounted(downS: number, upS: number) {
    const bot = createBot();
    bot.drive(snapshot(1, [mover(ME, { mode: 'Tumble', s: downS, d: 0.5, speed: 0 })]), ME, zoned(), blank());
    bot.drive(snapshot(2, [mover(ME, { mode: 'OnFoot', s: downS, d: 0.5, speed: 0 })]), ME, zoned(), blank());
    const a = blank();
    bot.drive(snapshot(3, [mover(ME, { s: upS, d: 0.5, speed: 8 })]), ME, zoned(), a);
    return { bot, a };
  }

  it('a bot that has not been down heads for the zone across the oncoming lanes (the check can see it)', () => {
    const a = blank();
    createBot().drive(snapshot(3, [mover(ME, { s: 245, d: 0.5, speed: 30 })]), ME, zoned(), a);
    expect(a.steer).toBeLessThan(-0.3);
  });

  it('a car coming the other way in the zone line: it rides on, on its own side, and never stops in its path', () => {
    // Bridge City's Broadway (polish H's punch item 5; seed 23 headless, the bot alone): following
    // that car meant braking to a stop at full lock across the centre line, where the cars coming
    // down the road stop for the bot in turn. It sat there 460 ticks; the live check's, 4,000+.
    const oncoming = mover(6, { kind: 'vehicle', s: 275, d: -1.7, speed: 10 });
    oncoming.road = { ...oncoming.road, dir: -1 };
    const a = blank();
    createBot().drive(snapshot(3, [mover(ME, { s: 245, d: 0.5, speed: 30 }), oncoming]), ME, zoned(), a);
    expect(a.brake).toBe(0);
    expect(a.throttle).toBe(1);
    expect(a.steer).toBeGreaterThan(0); // toward its own lane (d 1.7), not across into the car's
    // Already stopped across the centre line, nose to nose with a car waiting for it: it gets going.
    const stopped = mover(7, { kind: 'vehicle', s: 262, d: -1.7, speed: 0 });
    stopped.road = { ...stopped.road, dir: -1 };
    const b = blank();
    createBot().drive(snapshot(3, [mover(ME, { s: 250, d: -0.3, speed: 0 }), stopped]), ME, zoned(), b);
    expect(b.brake).toBe(0);
    expect(b.throttle).toBeGreaterThan(0);
    expect(b.steer).toBeGreaterThan(0);
    // A car going its own way in the zone line is still followed, as on road-2's ramp (the check
    // can see a stop): the bot holds the zone behind it.
    const ahead = mover(8, { kind: 'vehicle', s: 275, d: -3.3, speed: 20 });
    const c = blank();
    createBot().drive(snapshot(3, [mover(ME, { s: 255, d: -3.3, speed: 30 }), ahead]), ME, zoned(), c);
    expect(c.throttle).toBe(0);
    expect(c.brake).toBeGreaterThan(0);
  });

  it('a car coming the other way beside the zone line, not in it, keeps it on the zone and riding (the Mangrove Boardwalk)', () => {
    // The Keys' boardwalk leaves across the oncoming lane too (zone d -3 to -5.5, line -3.9), but
    // the cars in that lane run 1.9 m from the line: clear of a bike on it even for the widest
    // vehicle (2.6 m). Kept off the zone for every car within 2.5 m, the bot rode past the split in
    // 13 of 16 seeds (road-boardwalk-rejoin); and it never brakes for them either (main's bot did,
    // and a stopped bike holds a wide car at its nose).
    const beside = { ...zone, d0: -3.2, d1: -5.7 }; // its line at d -4.1
    const r = { ...route(), shortcuts: [beside] } as RouteQueries;
    const car = mover(6, { kind: 'vehicle', s: 275, d: -2.2, speed: 20 });
    car.road = { ...car.road, dir: -1 };
    const a = blank();
    createBot().drive(snapshot(3, [mover(ME, { s: 245, d: 0.5, speed: 30 }), car]), ME, r, a);
    expect(a.steer).toBeLessThan(-0.3); // toward the zone
    const b = blank();
    createBot().drive(snapshot(3, [mover(ME, { s: 255, d: -4.1, speed: 30 }), car]), ME, r, b);
    expect(b.brake).toBe(0);
    expect(b.throttle).toBe(1);
    // The negative control: the same car in the line (d -3.4, 0.7 m off it) still keeps it off.
    const inLine = mover(7, { kind: 'vehicle', s: 275, d: -3.4, speed: 20 });
    inLine.road = { ...inLine.road, dir: -1 };
    const c = blank();
    createBot().drive(snapshot(3, [mover(ME, { s: 245, d: 0.5, speed: 30 }), inLine]), ME, r, c);
    expect(c.steer).toBeGreaterThan(0);
  });

  it('a remount inside the approach keeps to its own side, and does not go back for the zone', () => {
    const { bot, a } = remounted(245, 245);
    expect(a.steer).toBeGreaterThan(0); // toward its own lane (d 1.7), not the oncoming one
    // Later, still short of the zone and up to speed: it has given the zone up.
    const later = blank();
    bot.drive(snapshot(40, [mover(ME, { s: 255, d: 1.7, speed: 30 })]), ME, zoned(), later);
    expect(Math.abs(later.steer)).toBeLessThan(0.05);
    expect(bot.stats().shortcutApproachTicks).toBe(0);
  });

  it('a fall well before the approach does not cost it the zone', () => {
    const { bot, a } = remounted(20, 20);
    expect(a.steer).toBeGreaterThan(0); // far from the zone: just back to its own lane
    const near = blank();
    bot.drive(snapshot(40, [mover(ME, { s: 200, d: 1.7, speed: 30 })]), ME, zoned(), near);
    expect(near.steer).toBeLessThan(-0.3);
    expect(bot.stats().shortcutApproachTicks).toBe(1);
  });

  it('a zone on its own side is still taken after a remount (the road-2 ramp)', () => {
    const own = { ...zone, d0: 2.4, d1: 4.9 };
    const ownRoute = { ...route(), shortcuts: [own] } as RouteQueries;
    const bot = createBot();
    bot.drive(snapshot(1, [mover(ME, { mode: 'Tumble', s: 245, d: 1.7, speed: 0 })]), ME, ownRoute, blank());
    const a = blank();
    bot.drive(snapshot(3, [mover(ME, { s: 245, d: 0.5, speed: 8 })]), ME, ownRoute, a);
    expect(a.steer).toBeGreaterThan(0.3);
  });
});

describe('bot: a remount keeps to its own side (playtest 4, run C: 2 of 8 remounts spent 191 and 217 of 240 ticks in the far oncoming lane)', () => {
  // Bridge City's four-lane road: two lanes each way, the oncoming ones at negative d for dir +1.
  const FOUR: LaneInfo[] = [
    { id: 'L2', dCenterM: -6, widthM: 4, direction: -1, kind: 'drive' },
    { id: 'L1', dCenterM: -2, widthM: 4, direction: -1, kind: 'drive' },
    { id: 'R1', dCenterM: 2, widthM: 4, direction: 1, kind: 'drive' },
    { id: 'R2', dCenterM: 6, widthM: 4, direction: 1, kind: 'drive' },
  ];
  /** A slow car in the inner own lane 30 m ahead, as traffic is when a rider gets up at a walking pace. */
  const car = () => mover(5, { kind: 'vehicle', s: 130, d: 2, speed: 20 });
  /** A slow car in the outer own lane, so no lane on its own side is free. */
  const outerCar = () => mover(6, { kind: 'vehicle', s: 125, d: 6, speed: 20 });
  /** Down on tick 1, up on tick 3 (the way a remount reaches the bot), then `later` ticks on. */
  function remounted(over: { d: number }, later: number, others: EntitySnapshot[]) {
    const bot = createBot();
    const r = route(FOUR);
    bot.drive(snapshot(1, [mover(ME, { mode: 'Tumble', speed: 0, ...over })]), ME, r, blank());
    bot.drive(snapshot(2, [mover(ME, { mode: 'OnFoot', speed: 0, ...over })]), ME, r, blank());
    const up = snapshot(3, [mover(ME, { speed: 8, ...over }), ...others]);
    const a = blank();
    bot.drive(up, ME, r, a); // the remount
    if (later === 0) return { bot, a };
    const b = blank();
    bot.drive({ ...up, tick: 3 + later }, ME, r, b);
    return { bot, a: b };
  }

  it('a car ahead sends it to the free lane on its own side, not across the centre line (the check can see it)', () => {
    const a = blank();
    createBot().drive(snapshot(5, [mover(ME, { d: 1.2, speed: 25 }), car()]), ME, route(FOUR), a);
    expect(a.steer).toBeGreaterThan(0.3); // the outer own lane (d 6), though the oncoming one is nearer
    expect(a.throttle).toBe(1);
  });

  it('with every lane on its own side blocked, a bot that has not been down passes in the oncoming lane (the check can see it)', () => {
    const a = blank();
    createBot().drive(snapshot(5, [mover(ME, { d: 2, speed: 25 }), car(), outerCar()]), ME, route(FOUR), a);
    expect(a.steer).toBeLessThan(-0.3);
  });

  it('a remounted bot does not pass in the oncoming lane while it gets back up to speed: it follows', () => {
    // The tick of the remount, and the last tick of the window.
    for (const later of [0, REMOUNT_OWN_SIDE_TICKS - 3]) {
      const { a } = remounted({ d: 2 }, later, [car(), outerCar()]);
      expect(a.steer, `${later} ticks on`).toBeGreaterThan(-0.05); // never toward the oncoming lane (d -2)
      // Follows at the blocker's pace: from 8 m/s it rides up to the car's 20 m/s behind it, in its
      // own lane (it braked whatever the car did until the never-stuck lane).
      expect(a.throttle, `${later} ticks on`).toBe(1);
      expect(a.brake, `${later} ticks on`).toBe(0);
    }
  });

  it('then it rides normally: the pass is back once the window is over', () => {
    const { a } = remounted({ d: 2 }, REMOUNT_OWN_SIDE_TICKS + 5, [car(), outerCar()]);
    expect(a.steer).toBeLessThan(-0.3);
  });

  it('a remount that gets up in the oncoming lane steers back to its own side', () => {
    const { a } = remounted({ d: -2 }, 0, []);
    expect(a.steer).toBeGreaterThan(0.3);
  });

  it('a remounted bot lines up on a rival from its own side, not across the centre line', () => {
    // A rival 20 m ahead on the near edge of its own lane. From the left of it (d -0.5) the kick
    // spot is in the oncoming lane (d -0.9).
    const rival = mover(1, { s: 120, d: 0.3, speed: 30 });
    const { a } = remounted({ d: -0.5 }, 0, [rival]);
    expect(a.steer).toBeGreaterThan(0.1);
    // The check can see it: a bot that has not been down lines up where the kick spot is.
    const b = blank();
    createBot().drive(snapshot(5, [mover(ME, { d: -0.5, speed: 30 }), rival]), ME, route(FOUR), b);
    expect(b.steer).toBeLessThan(0);
  });
});
