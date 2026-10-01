// The integration skeptic's finding F2 (playtest 1c): past the lip the sim holds a level 2.8 m deck to
// the truck's front, while the model had a car parked on its top deck and its cab below the deck, so
// a slow rider seemed to roll along inside that car and float past the cab. Render now draws that
// level deck with no car on it (#209), so the sim keeps it: a slow rider rolls up the ramp, along
// the deck and off its end, cleanly, and is never stuck on or in the truck.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type BakedFeature } from '../../road';
import { createSim, quantizeInput } from '../api';
import type { SimConfig, SimEvent } from '../types';
import { deckHeight, RAMP_TRUCK_LENGTH_M, RAMP_TRUCK_LIP_M } from './features';
import { input, riderHarness, testConfig } from './testing';

const TRUCK: BakedFeature = {
  kind: 'rampTruck',
  id: 'carrier-1',
  s0: 600,
  s1: 622,
  d0: 2.4,
  d1: 4.4,
  params: { rampLengthM: RAMP_TRUCK_LENGTH_M, lipHeightM: RAMP_TRUCK_LIP_M },
};

function withTruck(startS = 40): SimConfig {
  const base = testConfig();
  const bundle = fixtureNetwork([{ id: 'a', lengthM: 3000, kappa: 0 }]);
  const road0 = bundle.roads[0];
  if (!road0) throw new Error('no road');
  const road = createRoadNetwork({ ...bundle, roads: [{ ...road0, features: [TRUCK] }] });
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: startS, dir: 1 },
    finish: { road: 'a', s: 2980 },
    mainPath: ['a'],
    allowedRoads: ['a'],
    closed: false,
  });
  return { ...base, road, route };
}

/** Rides the truck's line (d 3.4) from s 590 at about `speed` (throttle on below it, off above it). */
function rideUp(speed: number, ticks = 60 * 40) {
  const h = riderHarness(withTruck(), { s: 590, d: 3.4, speed });
  const events: { ev: SimEvent; s: number; h: number }[] = [];
  const trace: { s: number; h: number; mode: string; speed: number }[] = [];
  for (let t = 0; t < ticks && h.rider.pos.s < TRUCK.s1 + 30; t++) {
    const throttle = h.rider.speed < speed ? 0.3 : 0;
    for (const ev of h.step(input(throttle))) events.push({ ev, s: h.rider.pos.s, h: h.rider.h });
    trace.push({ s: h.rider.pos.s, h: h.rider.h, mode: h.rider.mode, speed: h.rider.speed });
  }
  return { h, events, trace };
}

describe("the ramp truck's deck (skeptic F2)", () => {
  for (const speed of [3, 5, 8]) {
    it(`a slow rider (${speed} m/s) rolls up the ramp, along the deck and off its end, cleanly`, () => {
      const r = rideUp(speed);
      // It got past the truck, and never stopped on it.
      expect(r.h.rider.pos.s).toBeGreaterThan(TRUCK.s1 + 30);
      expect(r.trace.filter((p) => p.s > TRUCK.s0 && p.s < TRUCK.s1 && p.speed < 0.5)).toEqual([]);
      // Grounded past the lip, it stands on the deck (h is its 2.8 m), never inside the truck.
      const lip = TRUCK.s0 + RAMP_TRUCK_LENGTH_M;
      const onDeck = r.trace.filter((p) => p.mode === 'Road' && p.s > lip + 1 && p.s < TRUCK.s1);
      for (const p of onDeck) expect(p.h).toBeCloseTo(RAMP_TRUCK_LIP_M, 6);
      // Off the end it dropped to the road, with no crash and no truck contact.
      expect(r.events.filter((e) => e.ev.type === 'land' && e.s > TRUCK.s1).length).toBeGreaterThan(0);
      expect(r.events.filter((e) => e.ev.type === 'crash')).toEqual([]);
      expect(r.events.filter((e) => e.ev.data['object'] === 'rampTruck')).toEqual([]);
      expect(r.h.rider.h).toBe(0);
    });
  }

  it('the deck is level at the lip height from the lip to the front, and nothing past it', () => {
    const config = withTruck();
    for (const s of [TRUCK.s0 + RAMP_TRUCK_LENGTH_M, 615, TRUCK.s1 - 0.1])
      expect(deckHeight(config, 0, s, 3.4)).toBeCloseTo(RAMP_TRUCK_LIP_M, 9);
    expect(deckHeight(config, 0, TRUCK.s1 + 0.5, 3.4)).toBe(0);
  });

  it('a rider put down inside the truck (a remount) steps out beside it on the road side', () => {
    const h = riderHarness(withTruck(), { s: TRUCK.s0 + 15, d: 3.4, speed: 0 });
    const events = h.step(input(0));
    expect(h.rider.pos.d).toBeLessThan(TRUCK.d0);
    expect(h.rider.pos.d).toBeGreaterThan(TRUCK.d0 - 0.5);
    expect(h.rider.h).toBe(0);
    expect(events.filter((e) => e.type === 'crash' || e.type === 'wobble')).toEqual([]);
  });

  it('no snag, through the whole sim: crawl up, roll along the deck, drop off and ride on', () => {
    const sim = createSim(withTruck(560));
    let crashes = 0;
    let after = -1;
    for (let t = 0; t < 60 * 60; t++) {
      const me = sim.snapshot().entities[0];
      if (!me) throw new Error('no rider');
      const { d, yaw } = me.road;
      const crawl = me.road.s < TRUCK.s1;
      const steer = Math.max(-1, Math.min(1, 0.35 * ((crawl ? 3.4 : 1.7) - d) - 2.5 * yaw));
      // A crawl (about 3 m/s) up to and over the truck, then full throttle.
      const throttle = crawl ? (me.speed < 3 ? 0.3 : 0) : 1;
      sim.step([quantizeInput({ throttle, brake: 0, steer, flags: 0 })]);
      for (const e of sim.events()) if (e.type === 'crash' && e.actor === 0) crashes++;
      const now = sim.snapshot().entities[0];
      if (now && now.road.s > TRUCK.s1 + 50) {
        after = t;
        break;
      }
    }
    expect(crashes).toBe(0);
    expect(after, 'rode on past the truck within a minute').toBeGreaterThan(0);
  });
});
