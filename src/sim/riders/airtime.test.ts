// riders-2 acceptance (docs/milestones/M1.md, "riders-2 · Jumps and airtime"): take-off at the lip
// with a `jump` event and a `land` event on landing, h never negative in flight, a straight landing
// is clean while one with high sideways speed wobbles or crashes, and a scripted jump hashes the same
// every run. The ramp is a fixture road: a flat run-up, a 25 % ramp, then flat ground.
import { describe, expect, it } from 'vitest';
import { createSim } from '../api';
import type { SimEvent } from '../types';
import { RIDERS_TUNING, TAKEOFF_CLEARANCE_M } from './index';
import { input, riderHarness, testConfig } from './testing';

const RAMP = [
  { id: 'runup', lengthM: 200, kappa: 0 },
  { id: 'ramp', lengthM: 16, kappa: 0, grade: 0.25 },
  { id: 'landing', lengthM: 600, kappa: 0 },
];
const LIP_EDGE = 2; // the lip is where 'ramp' (edge 1) ends and 'landing' (edge 2) begins

/** Rides the ramp from the run-up at a speed, holding a steer from `steerFrom` s on the landing. */
function jump(speed: number, opts: { yawInAir?: number; tuning?: Record<string, number>; d?: number } = {}) {
  const config = testConfig({ edges: RAMP, ...(opts.tuning ? { tuning: opts.tuning } : {}) });
  const h = riderHarness(config, { edge: 0, s: 150, d: opts.d ?? 1.7, speed });
  const events: SimEvent[] = [];
  const heights: number[] = [];
  let takeoff: { edge: number; s: number; tick: number } | null = null;
  let airborneTicks = 0;
  for (let t = 0; t < 60 * 8; t++) {
    const wasAir = h.rider.mode === 'Airborne';
    // Hold the speed on the run-up so each case jumps at the speed it names.
    const ev = h.step(input(h.rider.mode === 'Road' && h.rider.speed < speed ? 1 : 0.4));
    events.push(...ev);
    if (!wasAir && h.rider.mode === 'Airborne') {
      takeoff = { edge: h.rider.pos.edge, s: h.rider.pos.s, tick: t };
      if (opts.yawInAir !== undefined) h.rider.yaw = opts.yawInAir; // a crooked flight, as if knocked
    }
    if (h.rider.mode === 'Airborne') {
      airborneTicks++;
      heights.push(h.rider.h);
    }
  }
  return { h, events, heights, takeoff, airborneTicks, config };
}

const types = (events: readonly SimEvent[]) => events.map((e) => e.type);

describe('riders-2: take-off and flight', () => {
  it('takes off at the lip with a jump event, and lands with a land event', () => {
    const r = jump(30);
    expect(r.takeoff).not.toBeNull();
    // Take-off happens on the tick the rider passes the lip: within one tick of travel after it.
    expect(r.takeoff?.edge).toBe(LIP_EDGE);
    expect(r.takeoff?.s).toBeLessThan(30 / 60 + 1e-9);
    const jumps = r.events.filter((e) => e.type === 'jump');
    const lands = r.events.filter((e) => e.type === 'land');
    expect(jumps).toHaveLength(1);
    expect(lands).toHaveLength(1);
    expect(jumps[0]?.actor).toBe(r.h.rider.id);
    expect(Number(jumps[0]?.data['speed'])).toBeGreaterThan(25);
    expect(Number(lands[0]?.data['airTicks'])).toBe(r.airborneTicks);
    expect(r.h.rider.mode).toBe('Road');
    // A 25 % lip at about 28 m/s: vy ≈ 7 m/s, so roughly 1.4 s and 2.5 m up.
    expect(r.airborneTicks).toBeGreaterThan(60);
    expect(r.airborneTicks).toBeLessThan(120);
    expect(Math.max(...r.heights)).toBeGreaterThan(1.5);
    expect(Math.max(...r.heights)).toBeLessThan(4);
  });

  it('never reports a negative h in flight, and h is 0 once grounded', () => {
    for (const speed of [12, 20, 30, 38]) {
      const r = jump(speed);
      expect(r.heights.length).toBeGreaterThan(0);
      for (const hgt of r.heights) {
        expect(hgt).toBeGreaterThan(0);
        expect(Number.isFinite(hgt)).toBe(true);
      }
      expect(r.h.rider.h).toBe(0);
    }
  });

  it('keeps moving along s and d in the air with the take-off speed (air drag only)', () => {
    const r = jump(30);
    const land = r.events.find((e) => e.type === 'land');
    const jumpEv = r.events.find((e) => e.type === 'jump');
    const lost = Number(jumpEv?.data['speed']) - Number(land?.data['speed']);
    expect(lost).toBeGreaterThan(0);
    // Air drag only (accel·v²/top², at most 4.2·(v/38)² m/s² here): no coasting drag or brake.
    const v = Number(jumpEv?.data['speed']);
    expect(lost).toBeLessThanOrEqual(((4.2 * v * v) / (38 * 38)) * (r.airborneTicks / 60) + 1e-9);
  });

  it('does not take off on the flat, over a gentle crest, or crawling off the lip', () => {
    const flat = riderHarness(testConfig(), { s: 10, d: 1.7, speed: 38 });
    const crest = riderHarness(
      testConfig({
        edges: [
          { id: 'up', lengthM: 200, kappa: 0, grade: 0.04 },
          { id: 'top', lengthM: 40, kappa: 0, grade: 0.02 },
          { id: 'down', lengthM: 400, kappa: 0, grade: -0.02 },
        ],
      }),
      { s: 100, d: 1.7, speed: 30 },
    );
    const crawl = riderHarness(testConfig({ edges: RAMP }), { edge: 1, s: 12, d: 1.7, speed: 3 });
    for (const h of [flat, crest, crawl]) {
      const all: SimEvent[] = [];
      for (let t = 0; t < 60 * 12; t++) {
        all.push(...h.step(input(h === crawl ? 0.8 : 1)));
        expect(h.rider.mode).toBe('Road');
      }
      expect(types(all)).not.toContain('jump');
    }
    // The crawl really went over the lip onto the landing road.
    expect(crawl.rider.pos.edge).toBe(LIP_EDGE);
    expect(TAKEOFF_CLEARANCE_M).toBeGreaterThan(0);
  });

  it('does not jump when another system puts the rider down somewhere new (a remount)', () => {
    const config = testConfig({ edges: RAMP });
    const h = riderHarness(config, { edge: 1, s: 12, d: 1.7, speed: 20 });
    for (let t = 0; t < 5; t++) h.step(input(0.5)); // rising on the ramp
    h.rider.pos.edge = 0; // moved to the flat run-up, as tumble-1's hand-back would
    h.rider.pos.s = 50;
    h.world.tick += 3; // and some ticks passed while it was not riding
    const ev = h.step(input(0.5));
    expect(types(ev)).not.toContain('jump');
    expect(h.rider.mode).toBe('Road');
  });
});

describe('riders-2: landing quality', () => {
  it('lands clean when straight', () => {
    const r = jump(30);
    const land = r.events.find((e) => e.type === 'land');
    expect(land?.data['quality']).toBe('clean');
    expect(types(r.events)).not.toContain('wobble');
    expect(types(r.events)).not.toContain('crash');
  });

  it('wobbles with some sideways speed, and crashes with a lot', () => {
    // Crooked flights start in the far lane so the drift across does not reach the barrier.
    const wobbly = jump(30, { yawInAir: 0.1, d: -1.7 }); // about 2.7 m/s sideways
    expect(wobbly.events.find((e) => e.type === 'land')?.data['quality']).toBe('wobble');
    expect(types(wobbly.events)).toContain('wobble');
    expect(types(wobbly.events)).not.toContain('crash');

    const crooked = jump(30, { yawInAir: 0.17, d: -3.5 }); // about 4.6 m/s sideways
    const land = crooked.events.find((e) => e.type === 'land');
    const crash = crooked.events.find((e) => e.type === 'crash');
    expect(land?.data['quality']).toBe('crash');
    expect(crash?.data['cause']).toBe('landing');
    expect(crash?.causeId).toBe(land?.causeId);
    expect(crash?.actor).toBe(crooked.h.rider.id);
    for (const r of [wobbly, crooked]) {
      // No barrier contact muddied the landing: every wobble or crash is the landing's.
      for (const e of r.events.filter((x) => x.type === 'wobble' || x.type === 'crash'))
        expect(e.data['cause']).toBe('landing');
    }
  });

  it('moves the crash line with the tuning panel (non-default value)', () => {
    const tough = jump(30, { yawInAir: 0.17, d: -3.5, tuning: { 'riders.landingCrashMps': 10 } });
    expect(tough.events.find((e) => e.type === 'land')?.data['quality']).toBe('wobble');
    const touchy = jump(30, { yawInAir: 0.1, d: -1.7, tuning: { 'riders.landingCrashMps': 1.5 } });
    expect(touchy.events.find((e) => e.type === 'land')?.data['quality']).toBe('crash');
    expect(RIDERS_TUNING.map((d) => d.id)).toContain('riders.landingCrashMps');
  });
});

describe('riders-2: determinism and the snapshot', () => {
  it('gives the same hash every run for a scripted jump, and reports Airborne with h above the road', () => {
    const run = () => {
      const config = testConfig({ edges: RAMP, start: { road: 'runup', s: 120, dir: 1 } });
      const sim = createSim(config);
      const hashes: number[] = [];
      let airborne = 0;
      let minH = Infinity;
      for (let t = 0; t < 60 * 10; t++) {
        const steer = t > 300 && t < 330 ? 0.3 : 0;
        sim.step([input(1, 0, steer)]);
        hashes.push(sim.hash());
        const me = sim.snapshot().entities.find((e) => e.slot === 0);
        if (me?.mode === 'Airborne') {
          airborne++;
          minH = Math.min(minH, me.road.h);
          expect(me.grounded).toBe(false);
        }
      }
      return { hashes, airborne, minH };
    };
    const a = run();
    const b = run();
    expect(b.hashes).toEqual(a.hashes);
    expect(a.airborne).toBeGreaterThan(30);
    expect(a.minH).toBeGreaterThan(0);
  });
});
