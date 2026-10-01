/// <reference types="vite/client" />
// Playtest 1c, item 1 ([decided] 2026-09-30: "It also feels like the bikes accelerate slowly"): the
// launch is punchy. Measured through the real riding model with the base pack's starter bike, from
// a standstill at full throttle on a flat straight. Before this change the starter took 6.3 s to
// 60 mph and 13.4 s to 90 mph at the default (Full) game speed. The overall-speed multiplier m was
// not the cause at Full (m = 1); at a lower game speed every time stretches by 1/m, by design.
import { describe, expect, it } from 'vitest';
import { basePackFiles, buildRegistry, lookup } from '../../src/content';
import type { SimConfig } from '../../src/sim/api';
import { COAST_DECEL } from '../../src/sim/riders';
import { input, riderHarness, testConfig, TEST_BIKE } from '../../src/sim/riders/testing';

const MPH = 0.44704;
const starter = lookup(buildRegistry(basePackFiles()).bikes, 'rustbucket-400').handling;

function starterConfig(opts: { tuning?: Record<string, number>; speedMultiplier?: number } = {}): SimConfig {
  const base = testConfig({ tuning: opts.tuning ?? {} });
  const player = base.riders[0];
  if (!player) throw new Error('no rider');
  const bike = { ...TEST_BIKE, topSpeedMps: starter.topSpeedMps, accelMps2: starter.accelMps2 };
  return {
    ...base,
    riders: [{ ...player, bike }],
    ...(opts.speedMultiplier === undefined ? {} : { speedMultiplier: opts.speedMultiplier }),
  };
}

/** The same bike ridden by someone else: an AI rival, or the cop (law faction). */
function riddenBy(config: SimConfig, who: 'rival' | 'cop'): SimConfig {
  const me = config.riders[0];
  if (!me) throw new Error('no rider');
  const def =
    who === 'rival'
      ? { ...me, role: 'rival' as const, controller: { kind: 'ai' as const, style: 'racer' as const } }
      : { ...me, role: 'cop' as const, faction: 'law' as const, controller: { kind: 'cop' as const } };
  return { ...config, riders: [def] };
}

/** Seconds from a standstill to each speed (mph) at a throttle; Infinity if not reached in 40 s. */
function launch(config: SimConfig, marks: readonly number[], throttle = 1): Record<number, number> {
  const h = riderHarness(config, { s: 50, d: 1.7 });
  const out: Record<number, number> = {};
  for (let t = 1; t <= 40 * 60; t++) {
    h.step(input(throttle));
    for (const mph of marks) if (out[mph] === undefined && h.rider.speed >= mph * MPH) out[mph] = t / 60;
  }
  for (const mph of marks) out[mph] ??= Infinity;
  return out;
}

const fmt = (r: Record<number, number>) =>
  Object.entries(r)
    .map(([k, v]) => `0-${k} ${Number.isFinite(v) ? v.toFixed(2) + ' s' : 'never'}`)
    .join(', ');

describe('playtest 1c: a punchy launch', () => {
  it('prints the launch at every game speed (what the maintainer feels)', () => {
    for (const m of [1, 0.9, 0.8, 0.7, 0.6]) {
      console.log(
        `[launch] game speed ${m}: ${fmt(launch(starterConfig({ speedMultiplier: m }), [30, 60, 80, 90]))}`,
      );
    }
    console.log(
      `[launch] launch punch 1 (the old model): ${fmt(launch(starterConfig({ tuning: { 'riders.launchGain': 1 } }), [30, 60, 80, 90]))}`,
    );
  });

  it('at the defaults the starter does 0-60 mph in under 3.5 s and 0-90 in under 10 s', () => {
    const r = launch(starterConfig(), [60, 90]);
    expect(r[60]).toBeLessThan(3.5);
    expect(r[90]).toBeLessThan(10);
  });

  it('a launch punch of 1 (a non-default value) gives back the old launch, about 6.3 s to 60 mph', () => {
    const r = launch(starterConfig({ tuning: { 'riders.launchGain': 1 } }), [60]);
    expect(r[60]).toBeGreaterThan(6);
    expect(r[60]).toBeLessThan(6.6);
  });

  it('rivals scale with the starter: an AI rival on the same bike launches exactly like the player', () => {
    expect(launch(riddenBy(starterConfig(), 'rival'), [30, 60, 90])).toEqual(
      launch(starterConfig(), [30, 60, 90]),
    );
  });

  it('the cop rides as before (playtest 1 item 7 keeps cop difficulty): about 6.3 s to 60 mph', () => {
    const old = launch(starterConfig({ tuning: { 'riders.launchGain': 1 } }), [30, 60]);
    expect(launch(riddenBy(starterConfig(), 'cop'), [30, 60])).toEqual(old);
  });

  it('a partial throttle (0.8) behaves exactly as before, so the AI and cop speed holds are unchanged', () => {
    const old = launch(starterConfig({ tuning: { 'riders.launchGain': 1 } }), [20, 40, 60], 0.8);
    expect(launch(starterConfig(), [20, 40, 60], 0.8)).toEqual(old);
  });

  it('top speed is unchanged: about 100 mph flat out, never past it', () => {
    const h = riderHarness(starterConfig(), { s: 50, d: 1.7 });
    let max = 0;
    for (let t = 0; t < 40 * 60; t++) {
      h.step(input(1));
      max = Math.max(max, h.rider.speed);
    }
    expect(max).toBeLessThanOrEqual(starter.topSpeedMps);
    expect(max / MPH).toBeGreaterThan(97);
  });

  it('letting go at top speed slows the bike exactly as before (the punch adds no engine braking)', () => {
    const h = riderHarness(starterConfig(), { s: 50, d: 1.7, speed: starter.topSpeedMps });
    h.step(input(0));
    const decel = (starter.topSpeedMps - h.rider.speed) * 60;
    expect(decel).toBeCloseTo(starter.accelMps2 + COAST_DECEL, 6);
  });

  it('at a lower game speed m the launch takes 1/m as long to the same share of top speed', () => {
    const full = launch(starterConfig(), [60])[60] ?? NaN;
    const m = 0.8;
    const slow = launch(starterConfig({ speedMultiplier: m }), [60 * m])[60 * m] ?? NaN;
    expect(slow).toBeGreaterThan(full / m - 0.05);
    expect(slow).toBeLessThan(full / m + 0.05);
  });
});
