// Playtest 1b quick wins ([decided] 2026-09-30): a boost pad gives a short speed boost, and the
// car-carrier ramp truck launches a rider into airtime and lands it, like the boat-ramp jump. Riding
// into the truck's side is a barrier contact. A fixture straight with the two features on it,
// stepped by the riding model alone.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type BakedFeature } from '../../road';
import type { SimConfig, SimEvent } from '../types';
import { deckHeight, RAMP_TRUCK_LENGTH_M, RAMP_TRUCK_LIP_M } from './features';
import { input, riderHarness, testConfig } from './testing';

const PAD: BakedFeature = {
  kind: 'boostPad',
  id: 'pad-1',
  s0: 300,
  s1: 306,
  d0: 0.5,
  d1: 3,
  params: { boostMps: 8, holdS: 1.5 },
};
/** The truck on the fixture's right edge, clear of the travel lane's centre (1.7). */
const TRUCK: BakedFeature = {
  kind: 'rampTruck',
  id: 'carrier-1',
  s0: 600,
  s1: 622,
  d0: 2.4,
  d1: 4.4,
  params: { rampLengthM: RAMP_TRUCK_LENGTH_M, lipHeightM: RAMP_TRUCK_LIP_M },
};

/** testConfig's straight, with the given features on it. */
function withFeatures(features: BakedFeature[]): SimConfig {
  const base = testConfig();
  const bundle = fixtureNetwork([{ id: 'a', lengthM: 3000, kappa: 0 }]);
  const road0 = bundle.roads[0];
  if (!road0) throw new Error('no road');
  const road = createRoadNetwork({ ...bundle, roads: [{ ...road0, features }] });
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 40, dir: 1 },
    finish: { road: 'a', s: 2980 },
    mainPath: ['a'],
    allowedRoads: ['a'],
    closed: false,
  });
  return { ...base, road, route };
}

/** Rides a straight line at d from s at a speed, full throttle, for `ticks`; returns speeds and events. */
function ride(config: SimConfig, at: { s: number; d: number; speed: number }, ticks: number, steer = 0) {
  const h = riderHarness(config, { s: at.s, d: at.d, speed: at.speed });
  const events: SimEvent[] = [];
  const trace: { s: number; d: number; speed: number; h: number; mode: string }[] = [];
  for (let t = 0; t < ticks; t++) {
    events.push(...h.step(input(1, 0, steer)));
    const r = h.rider;
    trace.push({ s: r.pos.s, d: r.pos.d, speed: r.speed, h: r.h, mode: r.mode });
  }
  return { h, events, trace };
}

describe('boost pads', () => {
  it('a rider who rides over a pad gains speed past its top speed for a while, with one boost event', () => {
    const top = testConfig().riders[0]?.bike.topSpeedMps ?? 38;
    const on = ride(withFeatures([PAD]), { s: 200, d: 1.7, speed: top }, 60 * 5);
    const off = ride(withFeatures([]), { s: 200, d: 1.7, speed: top }, 60 * 5);
    const boosts = on.events.filter((e) => e.type === 'boost');
    expect(boosts).toHaveLength(1);
    expect(boosts[0]?.data).toMatchObject({ feature: 'pad-1', holdS: 1.5 });
    const peakOn = Math.max(...on.trace.map((p) => p.speed));
    const peakOff = Math.max(...off.trace.map((p) => p.speed));
    console.log(
      `boost pad: peak ${peakOn.toFixed(1)} m/s with the pad, ${peakOff.toFixed(1)} without (top ${top})`,
    );
    expect(peakOff).toBeLessThanOrEqual(top + 1e-9);
    expect(peakOn).toBeGreaterThan(top + 5);
    expect(peakOn).toBeLessThanOrEqual(top + 8 + 1e-9);
    // It wears off: after the hold, drag eases the bike back toward its own top speed.
    const last = on.trace[on.trace.length - 1]?.speed ?? 0;
    const secondBefore = on.trace[on.trace.length - 61]?.speed ?? 0;
    expect(last).toBeLessThan(peakOn - 1);
    expect(last).toBeLessThan(secondBefore);
  });

  it('the boost shows on the rider state for its hold time, then ends', () => {
    const config = withFeatures([PAD]);
    const h = riderHarness(config, { s: 290, d: 1.7, speed: 30 });
    let seen = 0;
    for (let t = 0; t < 60 * 4; t++) {
      h.step(input(1));
      const st = (h.world.systems['riders'] as { boost: number[] }).boost[h.rider.id] ?? 0;
      if (st > 0) seen++;
    }
    expect(seen).toBeGreaterThan(80); // about 1.5 s of 60 ticks
    expect(seen).toBeLessThanOrEqual(91);
  });

  it('a rider beside the pad gets nothing', () => {
    const r = ride(withFeatures([PAD]), { s: 200, d: -1.7, speed: 30 }, 60 * 5);
    expect(r.events.filter((e) => e.type === 'boost')).toHaveLength(0);
  });
});

describe('the ramp truck', () => {
  it('has a 13.7° deck to a 2.8 m lip, level to the front', () => {
    const config = withFeatures([TRUCK]);
    expect(deckHeight(config, 0, 600, 3.4)).toBe(0);
    expect(deckHeight(config, 0, 600 + RAMP_TRUCK_LENGTH_M / 2, 3.4)).toBeCloseTo(1.4, 9);
    expect(deckHeight(config, 0, 615, 3.4)).toBeCloseTo(2.8, 9);
    expect(deckHeight(config, 0, 615, 1.7)).toBe(0); // beside it
    expect(deckHeight(config, 0, 630, 3.4)).toBe(0); // past its front
    const deg = (Math.atan(RAMP_TRUCK_LIP_M / RAMP_TRUCK_LENGTH_M) * 180) / Math.PI;
    expect(deg).toBeCloseTo(13.7, 1);
  });

  it('launches a rider riding up its ramp into airtime, and lands it clean down the road', () => {
    const r = ride(withFeatures([TRUCK]), { s: 450, d: 3.4, speed: 40 }, 60 * 8);
    const jump = r.events.find((e) => e.type === 'jump');
    const land = r.events.find((e) => e.type === 'land');
    const air = r.trace.filter((p) => p.mode === 'Airborne');
    const onDeck = r.trace.filter((p) => p.mode === 'Road' && p.s > 600 && p.s < 611);
    const landAt = r.trace.find((p, i) => i > 0 && p.mode === 'Road' && r.trace[i - 1]?.mode === 'Airborne');
    console.log(
      `ramp truck: ${air.length} ticks airborne, peak h ${Math.max(...air.map((p) => p.h)).toFixed(2)} m, ` +
        `landed at s ${landAt?.s.toFixed(1)} (${land?.data['quality']})`,
    );
    expect(jump).toBeDefined();
    expect(land?.data['quality']).toBe('clean');
    expect(air.length).toBeGreaterThan(60); // a second or more in the air
    expect(Math.max(...air.map((p) => p.h))).toBeGreaterThan(RAMP_TRUCK_LIP_M);
    expect(landAt?.s ?? 0).toBeGreaterThan(TRUCK.s1 + 40);
    // Riding up the deck, the rider stands on it: h is the deck's height above the road.
    expect(onDeck.length).toBeGreaterThan(5);
    for (const p of onDeck) expect(p.h).toBeCloseTo(deckHeight(withFeatures([TRUCK]), 0, p.s, p.d), 6);
    expect(r.events.filter((e) => e.type === 'crash' || e.type === 'wobble')).toHaveLength(0);
  });

  it('lands clean at the starter bike’s 100 mph (44.7 m/s), the fastest it meets the truck unboosted', () => {
    const config = withFeatures([TRUCK]);
    const fast = {
      ...config,
      riders: config.riders.map((r) => ({ ...r, bike: { ...r.bike, topSpeedMps: 44.7 } })),
    };
    const r = ride(fast, { s: 450, d: 3.4, speed: 44.7 }, 60 * 8);
    expect(r.events.find((e) => e.type === 'jump')).toBeDefined();
    expect(r.events.find((e) => e.type === 'land')?.data['quality']).toBe('clean');
  });

  it('is solid from the side: steering into it mid-deck is a barrier contact, never a climb', () => {
    const r = ride(withFeatures([TRUCK]), { s: 590, d: 1.2, speed: 30 }, 60, 1);
    const hits = r.events.filter(
      (e) => (e.type === 'wobble' || e.type === 'crash') && e.data['object'] === 'rampTruck',
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]?.data).toMatchObject({ cause: 'barrier', feature: 'carrier-1' });
    expect(Math.max(...r.trace.map((p) => p.h))).toBeLessThan(1);
  });
});
