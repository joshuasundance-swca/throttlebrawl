// Bend room (playtest 4, the maintainer on the Gorge: "the first couple turns are very very prone to
// crashing"). Faster than full lock can hold a bend, the riding model carries the bike wide whatever
// the rider does; a rider it carries onto the bend's outer barrier while holding the bars into the
// bend crashes only from `riders.bendEdgeForgive` (3) times the barrier crash speed, a scrape and
// a wobble below it. Hands off, or steering away from the bend, the old rule.
import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../types';
import { input, riderHarness, testConfig } from './testing';

/** A 25 m right-hand bend: full lock holds it to √(4 · 5.5 · 25) ≈ 23.5 m/s on the test bike. */
const BEND = [{ id: 'a', lengthM: 3000, kappa: 1 / 25 }];

const barrier = (events: readonly SimEvent[]) =>
  events.filter((e) => (e.type === 'wobble' || e.type === 'crash') && e.data['cause'] === 'barrier');

/** The first barrier event of a rider at 38 m/s on the bend with these bars, or undefined. */
function wallHit(tuning: Record<string, number>, steer: number): SimEvent | undefined {
  const h = riderHarness(testConfig({ edges: BEND, tuning }), { s: 100, d: 0, speed: 38 });
  for (let t = 0; t < 240; t++) {
    const hit = barrier(h.step(input(1, 0, steer)))[0];
    if (hit) return hit;
  }
  return undefined;
}

describe('bend room: the outer edge forgives a rider the bend carries wide (playtest 4)', () => {
  it('full lock into the bend wobbles where the old rule crashed; hands off or the wrong way still crashes', () => {
    const held = wallHit({ 'riders.bendEdgeForgive': 1 }, 1);
    // The bend carries it onto the outer (left) wall, holding full right lock.
    expect(held?.data['side']).toBe(-1);
    const impact = Number(held?.data['impactMps']);
    const handsOff = Number(wallHit({ 'riders.bendEdgeForgive': 1 }, 0)?.data['impactMps']);
    console.log(
      `[examined] 38 m/s on a 25 m bend (holds 23.5 m/s): into the outer wall at ${impact.toFixed(1)} m/s ` +
        `at full lock into the bend, ${handsOff.toFixed(1)} m/s hands off`,
    );
    // Crash speed set just under the held hit: no room crashes it, the room turns it to a wobble.
    const tuned = { 'riders.crashImpactMps': impact / 1.5 };
    expect(wallHit({ ...tuned, 'riders.bendEdgeForgive': 1 }, 1)?.type).toBe('crash');
    expect(wallHit({ ...tuned, 'riders.bendEdgeForgive': 3 }, 1)?.type).toBe('wobble');
    expect(wallHit({ ...tuned }, 1)?.type).toBe('wobble'); // the default is the room (3)
    // Not holding the bend, no room: hands off, and full lock the other way, crash as before.
    expect(wallHit({ ...tuned, 'riders.bendEdgeForgive': 3 }, 0)?.type).toBe('crash');
    expect(wallHit({ ...tuned, 'riders.bendEdgeForgive': 3 }, -1)?.type).toBe('crash');
  });

  it('a rider holding the bend into its inner wall gets no room', () => {
    // Slow enough to hold the bend, swerving into the inner (right) wall at full right lock: the bend
    // does not carry it there, its own bars do.
    const hit = (tuning: Record<string, number>) => {
      const h = riderHarness(testConfig({ edges: BEND, tuning }), { s: 100, d: 1, speed: 10, yaw: 0.5 });
      for (let t = 0; t < 240; t++) {
        const e = barrier(h.step(input(1, 0, 1)))[0];
        if (e) return e;
      }
      return undefined;
    };
    const base = hit({});
    expect(base?.data['side']).toBe(1);
    const tuned = { 'riders.crashImpactMps': Number(base?.data['impactMps']) / 1.5 };
    expect(hit({ ...tuned, 'riders.bendEdgeForgive': 3 })?.type).toBe('crash');
  });
});
