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

  // The integration skeptic (playtest 1c): the punch used to come in only past 90 % throttle, and the
  // phone's default touch stick is scaled (throttle = the thumb's travel over 60 px), so a thumb
  // held at 85 % still took 7.9 s to 60 mph. The punch now scales smoothly with the throttle.
  const OLD = { 'riders.launchGain': 1 };
  it('a partial thumb gets a punchy launch: 0.85, 0.7 and 0.5 throttle are each much quicker than before', () => {
    const now85 = launch(starterConfig(), [30, 60], 0.85);
    const old85 = launch(starterConfig({ tuning: OLD }), [30, 60], 0.85);
    const now70 = launch(starterConfig(), [30, 60], 0.7);
    const old70 = launch(starterConfig({ tuning: OLD }), [30, 60], 0.7);
    const now50 = launch(starterConfig(), [30], 0.5);
    const old50 = launch(starterConfig({ tuning: OLD }), [30], 0.5);
    console.log(
      `[launch] 0.85: ${fmt(now85)} (was ${fmt(old85)}); 0.7: ${fmt(now70)} (was ${fmt(old70)}); 0.5: ${fmt(now50)} (was ${fmt(old50)})`,
    );
    expect(old85[60]).toBeGreaterThan(7.5); // the skeptic's 7.87 s
    expect(now85[60]).toBeLessThan(4.5);
    expect(old70[60]).toBeGreaterThan(10); // the skeptic's 10.50 s
    expect(now70[60]).toBeLessThan(6);
    expect(old50[30]).toBeGreaterThan(6);
    expect(now50[30]).toBeLessThan(3);
  });

  it('the launch rises smoothly with the throttle: more throttle is never slower, with no step anywhere', () => {
    let prev = Infinity;
    for (let k = 40; k <= 100; k += 5) {
      const t = launch(starterConfig(), [30], k / 100)[30] ?? Infinity;
      expect(t).toBeLessThanOrEqual(prev);
      // No cliff: 5 % more throttle never buys more than a third off the time (the old gate at 90 %
      // took 0-30 from 3.4 s at 0.9 to 1.1 s at full).
      if (Number.isFinite(prev)) expect(t).toBeGreaterThan(prev * 0.67);
      prev = t;
    }
  });

  it('an AI rival at a partial throttle (0.8) rides exactly as before, so its speed holds are unchanged', () => {
    // The AI holds a speed with a partial feed-forward throttle; its punch still comes in only past
    // 90 % throttle (AI_LAUNCH_THROTTLE). The cop has no punch at all (above).
    const old = launch(riddenBy(starterConfig({ tuning: OLD }), 'rival'), [20, 40, 60], 0.8);
    expect(launch(riddenBy(starterConfig(), 'rival'), [20, 40, 60], 0.8)).toEqual(old);
  });

  it("the auto-throttle option (the slot's assist) gets the whole punch, like full throttle", () => {
    const auto = { ...starterConfig(), slots: [{ assists: { steer: 'off' as const, autoThrottle: true } }] };
    expect(launch(auto, [30, 60], 0)).toEqual(launch(starterConfig(), [30, 60], 1));
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
