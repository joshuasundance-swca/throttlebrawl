// U-turns (interview, 2026-10-02: "Right now there's no way to turn around and go the other way as
// far as I know lol"; round 3 picked "U-turns"). A player slowed under `riders.uturnMps` who holds
// the brake and full lock pivots round, past the normal heading limit; once the heading passes
// square to the road the bike's travel direction flips, so it rides the other way with its world
// heading unbroken. AI rivals and cops never do it, hard braking into a corner above the speed is
// exactly as before, and race progress follows the rider back and forth.
import { describe, expect, it } from 'vitest';
import { cos, HALF_PI, sin } from '../../core';
import { createSim, quantizeInput, type SimConfig } from '../api';
import { input, packHarness, riderHarness, testConfig, type RiderHarness } from './testing';
import { UTURN_DEFAULTS } from './uturn';

/** The rider's world heading as the snapshot computes it (atan-free: a unit vector). */
function headingVec(h: RiderHarness): { x: number; z: number } {
  const m = h.rider;
  const f = h.config.road.frameAt(m.pos.edge, m.pos.s);
  const tx = f.tx * m.pos.dir;
  const tz = f.tz * m.pos.dir;
  const c = cos(m.yaw);
  const s = sin(m.yaw);
  return { x: c * tx - s * tz, z: c * tz + s * tx };
}

/** Steps until `done` or `maxTicks`, returning every event and the largest heading change per tick. */
function ride(
  h: RiderHarness,
  inp: ReturnType<typeof input>,
  maxTicks: number,
  done: () => boolean = () => false,
) {
  const events: string[] = [];
  let maxTurn = 0;
  let maxYaw = 0;
  let ticks = 0;
  for (; ticks < maxTicks && !done(); ticks++) {
    const a = headingVec(h);
    for (const e of h.step(inp)) events.push(e.type);
    const b = headingVec(h);
    // Angle between the two headings, from the cross and dot products (small angles).
    const cross = a.x * b.z - a.z * b.x;
    const dot = a.x * b.x + a.z * b.z;
    maxTurn = Math.max(maxTurn, Math.abs(Math.atan2(cross, dot)));
    maxYaw = Math.max(maxYaw, Math.abs(h.rider.yaw));
  }
  return { events, maxTurn, maxYaw, ticks };
}

const routeDir = (h: RiderHarness) => h.rider.pos.dir * h.config.route.orientation(h.rider.pos.edge);

describe('U-turns (interview, 2026-10-02)', () => {
  it('a slow player holding the brake and full lock turns round, then rides back the other way', () => {
    const h = riderHarness(testConfig(), { s: 400, d: 3, speed: 8 });
    expect(routeDir(h)).toBe(1);
    const turn = ride(h, input(0, 1, -1), 4 * 60, () => h.rider.pos.dir === -1);
    console.log(`U-turn from 8 m/s, right side, full left lock: dir flipped after ${turn.ticks} ticks`);
    expect(h.rider.pos.dir).toBe(-1);
    expect(routeDir(h)).toBe(-1);
    expect(turn.ticks).toBeLessThan(2 * 60);
    expect(turn.events).not.toContain('crash');
    // The world heading never jumps: at most the U-turn rate (plus the road's own turn) per tick.
    expect(turn.maxTurn).toBeLessThanOrEqual(UTURN_DEFAULTS.rateRadS / 60 + 1e-6);
    // Let go of the brake and the bars, and ride away: back toward the start.
    const s0 = h.rider.pos.s;
    const away = ride(h, input(1, 0, 0), 3 * 60);
    expect(away.events).not.toContain('crash');
    expect(h.rider.pos.dir).toBe(-1);
    expect(h.rider.pos.s).toBeLessThan(s0 - 20);
    expect(Math.abs(h.rider.yaw)).toBeLessThan(0.1);
  });

  it('turns either way, and from a standstill pivots on the spot', () => {
    const right = riderHarness(testConfig(), { s: 400, d: -3, speed: 6 });
    ride(right, input(0, 1, 1), 4 * 60, () => right.rider.pos.dir === -1);
    expect(right.rider.pos.dir).toBe(-1);
    const still = riderHarness(testConfig(), { s: 400, d: 0, speed: 0 });
    const spin = ride(still, input(0, 1, -1), 4 * 60, () => still.rider.pos.dir === -1);
    expect(still.rider.pos.dir).toBe(-1);
    expect(spin.ticks).toBeLessThan(2 * 60);
    expect(Math.abs(still.rider.pos.s - 400)).toBeLessThan(0.5);
  });

  it('a second U-turn heads back toward the finish', () => {
    const h = riderHarness(testConfig(), { s: 400, d: 3, speed: 8 });
    ride(h, input(0, 1, -1), 4 * 60, () => h.rider.pos.dir === -1);
    expect(routeDir(h)).toBe(-1);
    // Holding on past the turn does not spin the bike round again.
    ride(h, input(0, 1, -1), 2 * 60);
    expect(routeDir(h)).toBe(-1);
    ride(h, input(0.3, 0, 0), 60);
    // Turn left again (as ridden back, toward +d).
    const again = ride(h, input(0, 1, -1), 4 * 60, () => h.rider.pos.dir === 1);
    expect(routeDir(h)).toBe(1);
    expect(again.events).not.toContain('crash');
  });

  it('full lock with the gas, pulling away slowly (a remount), never turns round', () => {
    const h = riderHarness(testConfig(), { s: 400, d: 0, speed: 0 });
    const run = ride(h, input(1, 0, 1), 3 * 60);
    expect(h.rider.pos.dir).toBe(1);
    expect(run.maxYaw).toBeLessThanOrEqual(1.2);
  });

  it('above riders.uturnMps, hard braking with full lock rides exactly as with U-turns off', () => {
    const trace = (tuning: Record<string, number>) => {
      const h = riderHarness(testConfig({ tuning }), { s: 400, d: 2, speed: 30 });
      const out: number[] = [];
      for (let t = 0; t < 60; t++) {
        h.step(input(0, 1, -1));
        out.push(h.rider.pos.s, h.rider.pos.d, h.rider.yaw, h.rider.speed);
      }
      expect(h.rider.speed).toBeGreaterThan(UTURN_DEFAULTS.maxMps);
      return out;
    };
    expect(trace({})).toEqual(trace({ 'riders.uturnMps': 0 }));
  });

  it('riders.uturnMps 0 turns U-turns off', () => {
    const h = riderHarness(testConfig({ tuning: { 'riders.uturnMps': 0 } }), { s: 400, d: 3, speed: 8 });
    const run = ride(h, input(0, 1, -1), 3 * 60);
    expect(h.rider.pos.dir).toBe(1);
    expect(run.maxYaw).toBeLessThanOrEqual(1.2);
  });

  it('AI riders never turn round, whatever they ask for', () => {
    const config = testConfig({ rivals: 1 });
    const p = packHarness(config, [
      { s: 400, d: 3, speed: 8 },
      { s: 200, d: -3, speed: 0 },
    ]);
    let maxYaw = 0;
    for (let t = 0; t < 3 * 60; t++) {
      p.step([input(0, 1, -1), input(0)]);
      maxYaw = Math.max(maxYaw, Math.abs(p.riders[0]?.yaw ?? 0));
    }
    expect(config.riders[0]?.controller.kind).toBe('ai');
    expect(p.riders[0]?.pos.dir).toBe(1);
    expect(maxYaw).toBeLessThanOrEqual(1.2);
  });

  it('a U-turn into the kerb never crashes the bike', () => {
    // On the left of a 3.4 m lane road at 11 m/s turning left: the wall comes before the turn is done.
    const h = riderHarness(testConfig(), { s: 400, d: -2.5, speed: 11 });
    const run = ride(h, input(0, 1, -1), 3 * 60);
    expect(run.events).not.toContain('crash');
  });

  it('keeps the heading past square to the road only while turning', () => {
    const h = riderHarness(testConfig(), { s: 400, d: 3, speed: 8 });
    // Start the pivot, then let go of everything before it completes.
    ride(h, input(0, 1, -1), 400, () => Math.abs(h.rider.yaw) > 1);
    expect(Math.abs(h.rider.yaw)).toBeLessThan(HALF_PI);
    const after = ride(h, input(0.5, 0, 0), 2 * 60);
    expect(after.events).not.toContain('crash');
    expect(Math.abs(h.rider.yaw)).toBeLessThanOrEqual(1.2);
  });
});

describe('U-turns in a race: progress follows the rider (interview, 2026-10-02)', () => {
  function race(config: SimConfig) {
    const sim = createSim(config);
    const progress = () => sim.snapshot().entities.find((e) => e.slot === 0);
    const step = (throttle: number, brake: number, steer: number, ticks: number) => {
      for (let t = 0; t < ticks; t++) sim.step([quantizeInput({ steer, throttle, brake, flags: 0 })]);
    };
    return { sim, progress, step };
  }

  it('turning round loses progress, turning back regains it, and the race still finishes', () => {
    const config = testConfig({ finish: { road: 'a', s: 900 } });
    const r = race(config);
    r.step(1, 0, 0.05, 6 * 60);
    expect(r.progress()?.routeDir).toBe(1);
    // Brake to a crawl, then turn round.
    r.step(0, 1, 0, 3 * 60);
    r.step(0, 1, -1, 2 * 60);
    const turned = r.progress();
    expect(turned?.routeDir).toBe(-1);
    expect(turned?.progress ?? 0).toBeGreaterThan(100);
    r.step(1, 0, 0, 2 * 60);
    const back = r.progress();
    expect(back?.routeDir).toBe(-1);
    expect(back?.progress ?? 0).toBeLessThan((turned?.progress ?? 0) - 10);
    // And round again, then race to the line.
    r.step(0, 1, 0, 3 * 60);
    r.step(0, 1, 1, 2 * 60);
    expect(r.progress()?.routeDir).toBe(1);
    for (let t = 0; t < 120 * 60 && !r.sim.isOver(); t++) {
      const me = r.progress();
      // Hold the middle of the right lane.
      const steer = me ? Math.max(-1, Math.min(1, (1.7 - me.road.d) * 0.3 - 2 * me.road.yaw)) : 0;
      r.sim.step([quantizeInput({ steer, throttle: 1, brake: 0, flags: 0 })]);
    }
    expect(r.progress()?.finished).toBe(true);
  });

  it('riding back down the race after a U-turn earns no oncoming or near-miss cash', () => {
    const base = testConfig({ finish: { road: 'a', s: 2900 } });
    const style = {
      perNearMissCash: 50,
      perAirtimeCash: 0,
      perOncomingSecondCash: 20,
      perTakedownCash: 0,
      takedownComboScale: 0,
      perStealCash: 0,
    };
    const config: SimConfig = { ...base, event: { ...base.event, style } };
    const r = race(config);
    r.step(1, 0, 0, 20 * 60);
    r.step(0, 1, 0, 5 * 60);
    r.step(0, 1, -1, 2 * 60);
    expect(r.progress()?.routeDir).toBe(-1);
    expect(r.progress()?.progress ?? 0).toBeGreaterThan(400);
    // Back the other way, in the lane whose traffic heads for the finish (+d): "oncoming" as ridden.
    const kinds: string[] = [];
    for (let t = 0; t < 6 * 60; t++) {
      const me = r.progress();
      const steer = me ? Math.max(-1, Math.min(1, -(1.7 - me.road.d) * 0.3 - 2 * me.road.yaw)) : 0;
      r.sim.step([quantizeInput({ steer, throttle: 1, brake: 0, flags: 0 })]);
      for (const e of r.sim.events()) if (e.type === 'style') kinds.push(String(e.data['kind']));
    }
    const me = r.progress();
    expect(me?.routeDir).toBe(-1);
    expect(me?.road.d ?? 0).toBeGreaterThan(0.5);
    expect(me?.speed ?? 0).toBeGreaterThan(20);
    // Then out of that lane, so the stretch ends (that is when an oncoming stretch would score).
    for (let t = 0; t < 2 * 60; t++) {
      const now = r.progress();
      const steer = now ? Math.max(-1, Math.min(1, -(-1.7 - now.road.d) * 0.3 - 2 * now.road.yaw)) : 0;
      r.sim.step([quantizeInput({ steer, throttle: 1, brake: 0, flags: 0 })]);
      for (const e of r.sim.events()) if (e.type === 'style') kinds.push(String(e.data['kind']));
    }
    expect(r.progress()?.road.d ?? 0).toBeLessThan(-0.5);
    expect(kinds).toEqual([]);
  });

  it('is deterministic: the same inputs give the same state hash', () => {
    const run = () => {
      const r = race(testConfig({ finish: { road: 'a', s: 900 } }));
      r.step(1, 0, 0, 3 * 60);
      r.step(0, 1, -1, 3 * 60);
      r.step(1, 0, 0.2, 2 * 60);
      return r.sim.hash();
    };
    expect(run()).toBe(run());
  });
});
