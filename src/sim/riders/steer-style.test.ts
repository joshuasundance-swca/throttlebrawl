// Playtest 4, P4-8 (the maintainer: "maybe allow true assist off but rename today's default. arcade
// guided good."): a player slot's steering style. Arcade, the default, is the original riding model:
// the stick asks for a heading relative to the road, capped, and letting go lines the bike up again.
// Free is opt-in, a true off with no hidden pull toward the road: held lock keeps turning the bike
// past Arcade's cap, and hands off the bike keeps its heading, going where it points. The AI keeps
// its own model whatever a slot says.
import { describe, expect, it } from 'vitest';
import { highwayLanes } from '../../road';
import type { SimConfig, SimRiderDef, SimSteerStyle } from '../types';
import { input, riderHarness, testConfig, type TestConfigOptions } from './testing';

/** A wide straight (four lanes each way), so a held lock runs a while before any edge squares it up. */
const WIDE: TestConfigOptions = { edges: [{ id: 'a', lengthM: 3000, kappa: 0, lanes: highwayLanes(4) }] };

function withStyle(style: SimSteerStyle | undefined, opts: TestConfigOptions = WIDE): SimConfig {
  return {
    ...testConfig(opts),
    slots: [{ assists: { steer: 'off', autoThrottle: false, ...(style ? { steerStyle: style } : {}) } }],
  };
}

/** The same config with the harness's rider (the last one) driven by the AI instead of slot 0. */
function asAi(config: SimConfig): SimConfig {
  const riders = config.riders.map((r, i): SimRiderDef =>
    i === config.riders.length - 1 ? { ...r, controller: { kind: 'ai', style: 'racer' } } : r,
  );
  return { ...config, riders };
}

/**
 * Full lock toward `side` for `holdTicks`, then hands off for `releaseTicks`, at a steady ~30 m/s.
 * Returns the peak |heading off the road|, the heading when the stick is let go and at the end, and
 * how far sideways it went under lock.
 */
function lockThenRelease(
  config: SimConfig,
  dir: 1 | -1,
  side: 1 | -1,
  holdTicks: number,
  releaseTicks: number,
) {
  const h = riderHarness(config, { s: dir === 1 ? 200 : 2800, d: 0, dir, speed: 30 });
  // Steering right moves toward +d riding with s and toward −d riding against it.
  const steer = side * dir;
  let peak = 0;
  for (let t = 0; t < holdTicks; t++) {
    h.step(input(0.75, 0, steer));
    peak = Math.max(peak, Math.abs(h.rider.yaw));
  }
  const sideways = h.rider.pos.d * side;
  const released = Math.abs(h.rider.yaw);
  for (let t = 0; t < releaseTicks; t++) h.step(input(0.75, 0, 0));
  return { peak, released, after: Math.abs(h.rider.yaw), sideways, mode: h.rider.mode };
}

describe('P4-8: the steering style', () => {
  it('Free turns the bike farther under held lock than Arcade (both sides, both directions)', () => {
    for (const dir of [1, -1] as const) {
      for (const side of [1, -1] as const) {
        const where = `dir ${dir}, side ${side}`;
        const arcade = lockThenRelease(withStyle('arcade'), dir, side, 60, 0);
        const free = lockThenRelease(withStyle('free'), dir, side, 60, 0);
        // Arcade holds the heading at its cap; Free keeps turning past it, and so goes farther sideways.
        expect(free.peak, where).toBeGreaterThan(2 * arcade.peak);
        expect(free.sideways, where).toBeGreaterThan(arcade.sideways + 1);
        expect(free.mode, where).toBe('Road');
      }
    }
  });

  it('Free has no hidden pull toward the road: let go on a straight and the bike keeps its heading', () => {
    for (const dir of [1, -1] as const) {
      for (const side of [1, -1] as const) {
        const where = `dir ${dir}, side ${side}`;
        const arcade = lockThenRelease(withStyle('arcade'), dir, side, 30, 30);
        const free = lockThenRelease(withStyle('free'), dir, side, 30, 30);
        // Half a second after letting go: Arcade has lined most of the way up with the road again;
        // Free still points exactly where it did.
        expect(arcade.after, where).toBeLessThan(0.5 * arcade.released);
        expect(free.released, where).toBeGreaterThan(0);
        expect(free.after, where).toBeCloseTo(free.released, 12);
      }
    }
  });

  it('Arcade is the default: no style and an explicit Arcade ride the same path, bit for bit', () => {
    const bend: TestConfigOptions = { edges: [{ id: 'a', lengthM: 3000, kappa: 1 / 150 }] };
    const ride = (config: SimConfig) => {
      const h = riderHarness(config, { s: 100, d: 0, speed: 30 });
      const path: number[] = [];
      for (let t = 0; t < 400; t++) {
        const steer = t < 120 ? 1 : t < 200 ? 0 : t < 320 ? -1 : 0.4;
        h.step(input(0.9, 0, steer));
        path.push(h.rider.pos.s, h.rider.pos.d, h.rider.yaw, h.rider.speed);
      }
      return path;
    };
    expect(ride(withStyle('arcade', bend))).toEqual(ride(withStyle(undefined, bend)));
    expect(ride(withStyle('free', bend))).not.toEqual(ride(withStyle(undefined, bend)));
  });

  it('the AI keeps its own model: a slot set to Free never changes an AI rider', () => {
    const ride = (config: SimConfig) => {
      const h = riderHarness(config, { s: 200, d: 0, speed: 30 });
      const path: number[] = [];
      for (let t = 0; t < 120; t++) {
        h.step(input(0.75, 0, t < 60 ? 1 : 0));
        path.push(h.rider.pos.d, h.rider.yaw);
      }
      return path;
    };
    expect(ride(asAi(withStyle('free')))).toEqual(ride(asAi(withStyle('arcade'))));
  });

  it('Free never turns the heading past the bound every other system keeps (|yaw| ≤ 1.2 rad)', () => {
    for (const side of [1, -1] as const) {
      const h = riderHarness(withStyle('free'), { s: 200, d: 0, speed: 8 });
      let peak = 0;
      for (let t = 0; t < 180; t++) {
        h.step(input(0.5, 0, side));
        peak = Math.max(peak, Math.abs(h.rider.yaw));
      }
      expect(peak, `side ${side}`).toBeLessThanOrEqual(1.2);
      // At this speed held lock reaches the bound: the bike really can point well off the road.
      expect(peak, `side ${side}`).toBeGreaterThan(1);
    }
  });
});
