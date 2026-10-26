import { describe, expect, it } from 'vitest';
import type { ActionState } from '../../src/app';
import type { EntitySnapshot, SimSnapshot } from '../../src/sim/api';
import { riderHarness, testConfig, type RiderHarness } from '../../src/sim/riders/testing';
import { botInput, createBot, WRONG_WAY_TICKS } from '../../src/dev/bot';

// The bot facing away from the finish turns round with the game's own U-turn gesture, the way a
// player does (sim/riders/uturn.ts: a double tap of the brake, the second press held at full lock).
// Seen on Eagle Point (2026-10-26): a jump off a Serpentine hairpin lands the rider on the leg below,
// facing back down it; the bot rode on the wrong way into the oncoming queue and stopped for good.
// Driven against the real rider system on a straight test road; the finish is up the road (+s).

function snap(h: RiderHarness): SimSnapshot {
  const m = h.rider;
  const me: EntitySnapshot = {
    id: m.id,
    kind: 'rider',
    mode: m.mode,
    road: { edge: m.pos.edge, s: m.pos.s, d: m.pos.d, h: m.h, dir: m.pos.dir, yaw: m.yaw },
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    speed: m.speed,
    lean: 0,
    contentId: 'base:player',
    name: 'You',
    faction: 'rider',
    slot: 0,
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
    progress: m.pos.s,
    distanceToFinish: h.config.route.distanceToFinish(m.pos.edge, m.pos.s),
    place: 1,
    finished: false,
  };
  return {
    tick: h.world.tick,
    timeScale: 1,
    entities: [me],
    race: { over: false, routeLength: 1000, finishOrder: [] },
  };
}

const blank = (): ActionState => ({
  throttle: 0,
  brake: 0,
  steer: 0,
  attack: false,
  attackSide: 0,
  kick: false,
  lookBack: false,
  skipRunBack: false,
});

/** Rides the bot for up to `ticks`, returning the tick the rider first faced the finish (or -1). */
function ride(h: RiderHarness, ticks: number): { turnedAt: number; crashes: number } {
  const bot = createBot();
  let turnedAt = -1;
  let crashes = 0;
  for (let t = 0; t < ticks; t++) {
    const a = blank();
    bot.drive(snap(h), h.rider.id, h.config.route, a);
    for (const e of h.step(botInput(a))) if (e.type === 'crash') crashes++;
    if (turnedAt < 0 && h.rider.pos.dir === 1) turnedAt = t;
  }
  return { turnedAt, crashes };
}

describe('bot: facing away from the finish', () => {
  it.each([
    ['at a standstill', 0],
    ['rolling the wrong way', 9],
    ['at speed the wrong way', 25],
  ])('turns round with the U-turn gesture %s, then rides toward the finish', (_label, speed) => {
    const h = riderHarness(testConfig(), { s: 1500, d: 0, dir: -1, speed });
    const before = h.config.route.distanceToFinish(0, 1500);
    const { turnedAt, crashes } = ride(h, 8 * 60);
    expect(turnedAt, 'faced the finish').toBeGreaterThanOrEqual(WRONG_WAY_TICKS);
    expect(turnedAt).toBeLessThan(5 * 60);
    expect(crashes).toBe(0);
    expect(h.rider.pos.dir).toBe(1);
    // It rides on toward the finish afterwards, not back round again.
    expect(h.config.route.distanceToFinish(h.rider.pos.edge, h.rider.pos.s)).toBeLessThan(before);
  });

  it('never turns round while it faces the finish (negative control)', () => {
    const h = riderHarness(testConfig(), { s: 1500, d: 0, dir: 1, speed: 0 });
    const { turnedAt } = ride(h, 8 * 60);
    expect(turnedAt).toBe(0);
    expect(h.rider.pos.dir).toBe(1);
    expect(h.rider.pos.s).toBeGreaterThan(1600);
  });
});
