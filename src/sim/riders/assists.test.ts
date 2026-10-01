// riders-4 acceptance, unit tier (docs/milestones/M2.md, "riders-4 · Assists and lower overall
// speed"): the steering assist nudges a drifting rider off the shoulder at `strong` and leaves the
// middle of the road alone; auto-throttle holds the gas for its human slot only; the lower-overall-
// speed multiplier m scales speeds by m and accelerations (gravity included) by m², so a jump keeps
// its shape and only takes 1/m as long. Every setting is tested at a non-default value.
import { describe, expect, it } from 'vitest';
import type { SimAssists, SimConfig, SimEvent, SimRiderDef } from '../types';
import { SPEED_MULTIPLIER_MIN } from './index';
import { input, riderHarness, testConfig, type TestConfigOptions } from './testing';

const TOP = 38;
/** The fixture road's travel lanes span d = −3.4..3.4; its shoulders lie outside that. */
const TRAVEL_EDGE = 3.4;

function withSlot(assists: Partial<SimAssists>, opts: TestConfigOptions = {}): SimConfig {
  return { ...testConfig(opts), slots: [{ assists: { steer: 'off', autoThrottle: false, ...assists } }] };
}

function withSpeed(m: number, opts: TestConfigOptions = {}): SimConfig {
  return { ...testConfig(opts), speedMultiplier: m };
}

/** The same config with the harness's rider (the last one) driven by the AI instead of slot 0. */
function asAi(config: SimConfig): SimConfig {
  const riders = config.riders.map((r, i): SimRiderDef =>
    i === config.riders.length - 1 ? { ...r, controller: { kind: 'ai', style: 'racer' } } : r,
  );
  return { ...config, riders };
}

describe('riders-4: steering assist', () => {
  /** A slow drift toward one side's rail: a light steer held for four seconds. */
  function drift(config: SimConfig, dir: 1 | -1, side: 1 | -1) {
    const h = riderHarness(config, { s: dir === 1 ? 100 : 2800, d: 1.7 * side, dir, speed: 28 });
    // Steering right moves toward +d riding with s and toward −d riding against it.
    const steer = 0.3 * side * dir;
    let maxOut = 0;
    let touched = false;
    const events: SimEvent[] = [];
    for (let t = 0; t < 240; t++) {
      events.push(...h.step(input(0.8, 0, steer)));
      maxOut = Math.max(maxOut, h.rider.pos.d * side);
      if (h.rider.pos.d * side > TRAVEL_EDGE) touched = true;
    }
    return { maxOut, touched, events };
  }

  it('strong keeps a drift toward the rail off the shoulder; off lets it touch (both sides, both directions)', () => {
    for (const dir of [1, -1] as const) {
      for (const side of [1, -1] as const) {
        const off = drift(withSlot({ steer: 'off' }), dir, side);
        const light = drift(withSlot({ steer: 'light' }), dir, side);
        const strong = drift(withSlot({ steer: 'strong' }), dir, side);
        const where = `dir ${dir}, side ${side}`;
        expect(off.touched, where).toBe(true);
        expect(
          off.events.some((e) => e.type === 'wobble' || e.type === 'crash'),
          where,
        ).toBe(true);
        expect(strong.touched, where).toBe(false);
        expect(strong.events, where).toEqual([]);
        expect(light.maxOut, where).toBeLessThan(off.maxOut);
        expect(strong.maxOut, where).toBeLessThanOrEqual(light.maxOut);
      }
    }
  });

  it('never steers a rider in the middle of the road onto a line (no nudge away from the edges)', () => {
    const run = (config: SimConfig) => {
      const h = riderHarness(config, { s: 100, d: -1, speed: 25 });
      const path: number[] = [];
      for (let t = 0; t < 90; t++) {
        h.step(input(0.7, 0, t < 30 ? 0.3 : t < 60 ? -0.3 : 0));
        path.push(h.rider.pos.d, h.rider.yaw);
      }
      return path;
    };
    expect(run(withSlot({ steer: 'strong' }))).toEqual(run(withSlot({ steer: 'off' })));
  });

  it('still lets a determined rider onto the shoulder at strong (it nudges, it is not a rail)', () => {
    const h = riderHarness(withSlot({ steer: 'strong' }), { s: 100, d: 1.7, speed: 20 });
    let reached = false;
    for (let t = 0; t < 240; t++) {
      h.step(input(0.6, 0, 1));
      if (h.rider.pos.d > TRAVEL_EDGE) reached = true;
    }
    expect(reached).toBe(true);
  });

  it('is ignored by an AI rider, whatever slot 0 asks for', () => {
    const run = (config: SimConfig) => {
      const h = riderHarness(config, { s: 100, d: 1.7, speed: 28 });
      for (let t = 0; t < 180; t++) h.step(input(0.8, 0, 0.3));
      return [h.rider.pos.d, h.rider.speed, h.rider.yaw];
    };
    expect(run(asAi(withSlot({ steer: 'strong' })))).toEqual(run(asAi(withSlot({ steer: 'off' }))));
    expect(run(withSlot({ steer: 'strong' }))).not.toEqual(run(withSlot({ steer: 'off' })));
  });
});

describe('riders-4: auto-throttle', () => {
  it('holds full throttle with the throttle input released, for its human slot', () => {
    const auto = riderHarness(withSlot({ autoThrottle: true }), { s: 10, d: 1.7 });
    const manual = riderHarness(withSlot({ autoThrottle: false }), { s: 10, d: 1.7 });
    for (let t = 0; t < 60 * 40; t++) {
      auto.step(input(0));
      manual.step(input(0));
    }
    expect(auto.rider.speed).toBeGreaterThan(TOP - 0.5);
    expect(manual.rider.speed).toBe(0);
  });

  it('lets the brake win: full brake stops an auto-throttle bike', () => {
    const h = riderHarness(withSlot({ autoThrottle: true }), { s: 10, d: 1.7, speed: 30 });
    for (let t = 0; t < 60 * 6; t++) h.step(input(0, 1));
    expect(h.rider.speed).toBe(0);
  });

  it('is ignored by an AI rider', () => {
    const h = riderHarness(asAi(withSlot({ autoThrottle: true })), { s: 10, d: 1.7 });
    for (let t = 0; t < 600; t++) h.step(input(0));
    expect(h.rider.speed).toBe(0);
  });
});

describe('riders-4: lower overall speed', () => {
  it('scales top speed by m (0.8)', () => {
    const h = riderHarness(withSpeed(0.8), { s: 10, d: 1.7 });
    let max = 0;
    for (let t = 0; t < 60 * 60; t++) {
      h.step(input(1));
      max = Math.max(max, h.rider.speed);
    }
    expect(h.rider.speed).toBeGreaterThan(TOP * 0.8 - 0.5);
    expect(max).toBeLessThanOrEqual(TOP * 0.8);
  });

  it('keeps the path: a run-up reaches the same fraction of top speed at the same place, in 1/m the time', () => {
    const at = (m: number) => {
      const h = riderHarness(withSpeed(m), { s: 10, d: 1.7 });
      let ticks = 0;
      while (h.rider.speed < 0.75 * TOP * m && ticks < 60 * 60) {
        h.step(input(1));
        ticks++;
      }
      return { s: h.rider.pos.s, ticks };
    };
    const full = at(1);
    const slow = at(0.8);
    expect(slow.s).toBeCloseTo(full.s, -0.3); // within about a metre over ~150 m
    expect(slow.ticks / full.ticks).toBeCloseTo(1 / 0.8, 1);
  });

  it('keeps the braking distance and stretches the stop by 1/m', () => {
    const stop = (m: number) => {
      const h = riderHarness(withSpeed(m), { s: 10, d: 1.7, speed: 30 * m });
      let ticks = 0;
      while (h.rider.speed > 0 && ticks < 60 * 20) {
        h.step(input(0, 1));
        ticks++;
      }
      return { dist: h.rider.pos.s - 10, ticks };
    };
    const full = stop(1);
    const slow = stop(0.7);
    expect(Math.abs(slow.dist - full.dist) / full.dist).toBeLessThan(0.03);
    expect(slow.ticks / full.ticks).toBeCloseTo(1 / 0.7, 1);
  });

  it('scales gravity by m², so a jump keeps its arc and flies 1/m as long, at the minimum multiplier', () => {
    const RAMP = [
      { id: 'runup', lengthM: 200, kappa: 0 },
      { id: 'ramp', lengthM: 16, kappa: 0, grade: 0.25 },
      { id: 'landing', lengthM: 600, kappa: 0 },
    ];
    // One flight's peak swings by up to half with where the lip falls inside a tick (the take-off is
    // a one-tick event), so each figure is the median over eight starts spread across one tick's
    // travel; the launch punch's extra push (playtest 1c) moved the single start off its lucky phase.
    const flyFrom = (m: number, s: number) => {
      const h = riderHarness(withSpeed(m, { edges: RAMP }), { edge: 0, s, d: 1.7, speed: 30 * m });
      let peak = 0;
      let takeoffS = -1;
      let landS = -1;
      let quality = '';
      let airTicks = 0;
      for (let t = 0; t < 60 * 10 && landS < 0; t++) {
        const wasAir = h.rider.mode === 'Airborne';
        for (const e of h.step(input(0.4))) {
          if (e.type === 'land') {
            quality = String(e.data['quality']);
            airTicks = Number(e.data['airTicks']);
            landS = h.rider.pos.s;
          }
        }
        if (!wasAir && h.rider.mode === 'Airborne') takeoffS = h.rider.pos.s;
        if (h.rider.mode === 'Airborne') peak = Math.max(peak, h.rider.h);
      }
      return { peak, flight: landS - takeoffS, quality, airTicks };
    };
    const fly = (m: number) => {
      const runs = Array.from({ length: 8 }, (_v, i) => flyFrom(m, 150 + (i * 0.5 * m) / 8));
      // The median: a start whose lip lands late in a tick takes off a tick late and flies low.
      const median = (f: (r: (typeof runs)[number]) => number) => {
        const v = runs.map(f).sort((a, b) => a - b);
        return ((v[3] ?? 0) + (v[4] ?? 0)) / 2;
      };
      const quality = runs.every((r) => r.quality === 'clean')
        ? 'clean'
        : runs.map((r) => r.quality).join(',');
      return {
        peak: median((r) => r.peak),
        flight: median((r) => r.flight),
        quality,
        airTicks: median((r) => r.airTicks),
      };
    };
    const full = fly(1);
    const slow = fly(SPEED_MULTIPLIER_MIN);
    expect(full.quality).toBe('clean');
    expect(slow.quality).toBe('clean');
    expect(Math.abs(slow.peak - full.peak) / full.peak).toBeLessThan(0.03);
    expect(Math.abs(slow.flight - full.flight) / full.flight).toBeLessThan(0.03);
    expect(slow.airTicks / full.airTicks).toBeCloseTo(1 / SPEED_MULTIPLIER_MIN, 1);
  });

  it('changes nothing at m = 1 or with the field absent', () => {
    const run = (config: SimConfig) => {
      const h = riderHarness(config, { s: 10, d: 1.7 });
      for (let t = 0; t < 300; t++) h.step(input(t < 200 ? 1 : 0, t > 250 ? 1 : 0, t % 90 < 45 ? 0.2 : -0.2));
      return [h.rider.pos.s, h.rider.pos.d, h.rider.speed, h.rider.yaw];
    };
    expect(run(withSpeed(1))).toEqual(run(testConfig()));
  });
});
