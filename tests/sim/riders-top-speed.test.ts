/// <reference types="vite/client" />
// Playtest 1, item 10 (2026-09-30, "faster + stronger cues"): the starter bike tops out at about
// 100 mph, and the top-speed scale slider (riders.speedScale) still changes it: at 0.85 the same bike
// gives back M1's 85 mph. Stepped through the real riding model on a straight.
import { describe, expect, it } from 'vitest';
import { basePackFiles, buildRegistry, lookup } from '../../src/content';
import { input, riderHarness, testConfig, TEST_BIKE } from '../../src/sim/riders/testing';

const MPH = 0.44704;
const starter = lookup(buildRegistry(basePackFiles()).bikes, 'rustbucket-400').handling;

/** Top speed reached after 40 s of full throttle from a standstill, with this speed scale. */
function topAfterFullThrottle(speedScale: number): number {
  const base = testConfig({ tuning: { 'riders.speedScale': speedScale } });
  const player = base.riders[0];
  if (!player) throw new Error('no rider');
  const bike = { ...TEST_BIKE, topSpeedMps: starter.topSpeedMps, accelMps2: starter.accelMps2 };
  const config = { ...base, riders: [{ ...player, bike }] };
  const h = riderHarness(config, { s: 50, d: 1.7 });
  let top = 0;
  for (let t = 0; t < 40 * 60; t++) {
    h.step(input(1));
    top = Math.max(top, h.rider.speed);
  }
  return top;
}

describe('the starter bike’s top speed (playtest 1, item 10)', () => {
  it('is about 100 mph in the base pack', () => {
    expect(starter.topSpeedMps / MPH).toBeGreaterThan(98);
    expect(starter.topSpeedMps / MPH).toBeLessThan(102);
  });

  it('reaches about 100 mph flat out at the default speed scale', () => {
    expect(topAfterFullThrottle(1) / MPH).toBeGreaterThan(97);
  });

  it('the top-speed slider at 0.85 (a non-default value) gives back M1’s 85 mph', () => {
    const top = topAfterFullThrottle(0.85) / MPH;
    expect(top).toBeGreaterThan(82);
    expect(top).toBeLessThan(86);
  });
});
