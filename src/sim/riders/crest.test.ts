// Crest launch (the W-O polish run): a bike leaves the ground over a crest when following it needs
// more downward pull than gravity gives (speed² × the crest's vertical curvature × riders.crestLaunch
// > g). Before it, only a ramp lip's one-tick kink could launch, so a smooth hilltop never did: the
// GIS lane's bot never left the ground, even over the Russian Hill crest. The real routes are not in
// the packs yet, so this runs on a hand-made hump, the same 16u²(1−u)² bump the hand-made tracks
// use (road/compile's humpProfile): 60 m long and 3 m high, a sharp hilltop whose top curves at
// about 1/75 m, so plain physics launches a bike from about 27 m/s.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, humpProfile } from '../../road';
import type { SimConfig, SimEvent } from '../types';
import { speedMultiplierOf } from '../world';
import { CREST_MARGIN, crestCurvature, RIDERS_TUNING } from './index';
import { input, riderHarness, testConfig } from './testing';

const HUMP = { centreM: 400, lengthM: 60, heightM: 3 };

/** A straight 800 m road with HUMP baked into its samples (heights and grades), as the compiler does. */
function humpConfig(tuning: Record<string, number> = {}, features: readonly object[] = []): SimConfig {
  const base = testConfig({ edges: [{ id: 'a', lengthM: 800, kappa: 0 }], tuning });
  const bundle = fixtureNetwork([{ id: 'a', lengthM: 800, kappa: 0 }]);
  const road = bundle.roads[0];
  if (!road) throw new Error('no road');
  const data = road.samples.data as Record<string, number[]>;
  const y = data['y'] ?? [];
  const grade = data['grade'] ?? [];
  for (let i = 0; i < y.length; i++) {
    const [hy, hg] = humpProfile([HUMP], i * road.sampleSpacingM);
    y[i] = (y[i] ?? 0) + hy;
    grade[i] = (grade[i] ?? 0) + hg;
  }
  const net = createRoadNetwork({ ...bundle, roads: [{ ...road, features: [...features] } as typeof road] });
  const route = createRouteProgress(net, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 40, dir: 1 },
    finish: { road: 'a', s: 780 },
    mainPath: ['a'],
    allowedRoads: ['a'],
    closed: false,
  });
  return { ...base, road: net, route };
}

/** Rides over the hump at a held speed; returns the jumps, the landings and the flight. */
function ride(speed: number, tuning: Record<string, number> = {}, features: readonly object[] = []) {
  const config = humpConfig(tuning, features);
  const h = riderHarness(config, { s: 250, d: 2, speed });
  const events: SimEvent[] = [];
  const trace: number[] = [];
  let airTicks = 0;
  let peakH = 0;
  for (let t = 0; t < 60 * 10 && h.rider.pos.s < 600; t++) {
    // Hold the speed up to the hump; ease off after, as a rider would.
    const ev = h.step(input(h.rider.mode === 'Road' && h.rider.speed < speed ? 1 : 0.3));
    events.push(...ev);
    if (h.rider.mode === 'Airborne') {
      airTicks++;
      peakH = Math.max(peakH, h.rider.h);
    }
    trace.push(h.rider.pos.s, h.rider.h, h.rider.speed);
  }
  const jumps = events.filter((e) => e.type === 'jump');
  const lands = events.filter((e) => e.type === 'land');
  return { config, jumps, lands, airTicks, peakH, trace };
}

describe('riders: crest launch', () => {
  it('reads the hump top as a crest (curving down) and its feet as dips', () => {
    const config = humpConfig();
    const top = crestCurvature(config, 0, HUMP.centreM);
    // 16u²(1−u)² curves at −16·H/L² at its top (u = ½): −16 × 3 / 3600 ≈ −0.0133 (1/75 m).
    expect(top).toBeLessThan(-0.012);
    expect(top).toBeGreaterThan(-0.0145);
    expect(crestCurvature(config, 0, HUMP.centreM - 27)).toBeGreaterThan(0);
    expect(crestCurvature(config, 0, 100)).toBe(0);
  });

  it('fast over the top, the bike floats off it: one crest jump, then a clean landing past the top', () => {
    const r = ride(35);
    console.log(
      `[examined] crest at 35 m/s: ${r.jumps.length} jump(s) at s ${r.jumps.map((e) => e.data['speed']).join(', ')} m/s, ` +
        `${r.airTicks} ticks in the air, peak ${r.peakH.toFixed(2)} m, landings ${r.lands.map((e) => e.data['quality']).join('/')}`,
    );
    expect(r.jumps).toHaveLength(1);
    expect(r.jumps[0]?.data['crest']).toBe(1);
    expect(r.lands).toHaveLength(1);
    expect(r.lands[0]?.data['quality']).toBe('clean');
    // Real air, not a one-tick hop: over a fifth of a second, a hand's height or more off the road.
    expect(r.airTicks).toBeGreaterThan(12);
    expect(r.peakH).toBeGreaterThan(0.1);
  });

  it('slow over the same top, the bike stays on the road, as it did before', () => {
    const r = ride(18);
    expect(r.jumps).toHaveLength(0);
    expect(r.airTicks).toBe(0);
  });

  it('the launch speed follows physics, sqrt(g (1 + margin) / curvature), with the overall speed scaling', () => {
    const config = humpConfig();
    const g = 9.81 * speedMultiplierOf(config) ** 2;
    const launchAt = Math.sqrt((g * (1 + CREST_MARGIN)) / -crestCurvature(config, 0, HUMP.centreM));
    console.log(`[examined] crest launch speed on the 1/75 m hump: ${launchAt.toFixed(1)} m/s`);
    // Just under it, no launch; a little over it, one.
    expect(ride(launchAt * 0.93).jumps).toHaveLength(0);
    expect(ride(launchAt * 1.08).jumps).toHaveLength(1);
  });

  it('the Crest launch slider: 0 turns it off; at 0.7 a crest needs more speed', () => {
    const decl = RIDERS_TUNING.find((d) => d.id === 'riders.crestLaunch');
    expect(decl).toMatchObject({ default: 1, min: 0, max: 1 });
    expect(ride(35, { 'riders.crestLaunch': 0 }).jumps).toHaveLength(0);
    // 0.7 needs 1/0.7 the pull: about 36 m/s on this hump instead of 30.
    expect(ride(33).jumps).toHaveLength(1);
    expect(ride(33, { 'riders.crestLaunch': 0.7 }).jumps).toHaveLength(0);
    const faster = ride(40, { 'riders.crestLaunch': 0.7 });
    expect(faster.jumps).toHaveLength(1);
    expect(faster.lands).toHaveLength(1);
  });

  it('never hops: one jump per pass at every speed from the threshold to well past top speed', () => {
    const counts: string[] = [];
    for (let v = 26; v <= 50; v += 0.5) {
      const r = ride(v);
      counts.push(`${v}:${r.jumps.length}/${r.airTicks}`);
      expect(r.jumps.length, `${v} m/s`).toBeLessThanOrEqual(1);
      expect(r.lands.length, `${v} m/s`).toBe(r.jumps.length);
      if (r.jumps.length > 0) expect(r.airTicks, `${v} m/s`).toBeGreaterThan(3);
    }
    console.log(`[examined] crest sweep, speed:jumps/air ticks: ${counts.join(' ')}`);
  });

  it('leaves an authored ramp alone: its lip launches by the lip rule, never twice', () => {
    const ramp = { kind: 'ramp', id: 'kicker', s0: 380, s1: 420, d0: -5.5, d1: 5.5 };
    expect(ride(35, {}, [ramp]).jumps).toHaveLength(0);
  });

  it('is deterministic: the same ride twice traces the same flight, bit for bit', () => {
    const a = ride(35).trace;
    const b = ride(35).trace;
    expect(b).toEqual(a);
  });
});
