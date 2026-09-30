import { describe, expect, it } from 'vitest';
import { spring, stepAngleSpring, stepSpring, wrapAngle } from './spring';

// camera-1 acceptance: "a step change settles without overshoot", for the spring itself, at the
// frame times the loop can hand the camera (120 Hz up to its 0.25 s clamp).
describe('the critically damped spring', () => {
  for (const dt of [1 / 120, 1 / 60, 1 / 30, 0.1, 0.25]) {
    it(`settles a step from rest without overshoot at dt ${dt.toFixed(4)} s`, () => {
      const sp = spring(0);
      let prev = 0;
      let t = 0;
      let settledAt = -1;
      while (t < 3) {
        stepSpring(sp, 10, 6, dt);
        t += dt;
        expect(sp.x).toBeGreaterThanOrEqual(prev - 1e-12);
        expect(sp.x).toBeLessThanOrEqual(10);
        if (settledAt < 0 && 10 - sp.x < 0.1) settledAt = t;
        prev = sp.x;
      }
      expect(settledAt).toBeGreaterThan(0);
      // (1 + ωt)·e^(−ωt) = 0.01 at ωt ≈ 6.64, so about 1.1 s at ω = 6 (one coarse frame of slack).
      expect(settledAt).toBeLessThan(1.11 + dt);
      expect(10 - sp.x).toBeLessThan(1e-3);
    });
  }

  it('lands on the same curve whatever the frame time (exact solution, not an integrator)', () => {
    const fine = spring(0);
    const coarse = spring(0);
    for (let i = 0; i < 60; i++) stepSpring(fine, 4, 5, 1 / 60);
    for (let i = 0; i < 4; i++) stepSpring(coarse, 4, 5, 0.25);
    expect(coarse.x).toBeCloseTo(fine.x, 9);
    expect(coarse.v).toBeCloseTo(fine.v, 9);
  });

  it('ignores a zero, negative or NaN frame time', () => {
    const sp = spring(2);
    for (const dt of [0, -1, Number.NaN]) stepSpring(sp, 9, 6, dt);
    expect(sp).toEqual({ x: 2, v: 0 });
  });

  it('takes the short way round for angles, without overshoot', () => {
    const sp = spring(3);
    const goal = -3; // 0.283 rad away through ±π, not 6 rad the long way
    let travelled = 0;
    let last = sp.x;
    for (let i = 0; i < 180; i++) {
      stepAngleSpring(sp, goal, 6, 1 / 60);
      const step = wrapAngle(sp.x - last);
      expect(step).toBeGreaterThanOrEqual(-1e-12);
      travelled += step;
      last = sp.x;
    }
    expect(travelled).toBeLessThanOrEqual(wrapAngle(goal - 3) + 1e-9);
    expect(Math.abs(wrapAngle(sp.x - goal))).toBeLessThan(1e-3);
  });

  it('wraps angles into (−π, π]', () => {
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(7)).toBeCloseTo(7 - 2 * Math.PI, 12);
    expect(wrapAngle(-7)).toBeCloseTo(-7 + 2 * Math.PI, 12);
  });
});
