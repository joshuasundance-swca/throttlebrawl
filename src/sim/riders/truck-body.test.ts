// The integration skeptic's finding F2 (playtest 1c): past the lip the sim held a level 2.8 m deck
// to the truck's front, while the model has a car parked on its top deck (roof 0.7 to 1.16 m above
// that deck) and then the cab, so a slow rider rolled along the deck inside that car and floated
// past the cab. Now the truck past a short lip platform is its body: solid, never landed on. A slow
// rider who rolls up the ramp bumps the parked car and is thrown off (a crash, then tumble's usual
// hand-back), one too slow off the lip to clear the truck hits it, and one fast enough clears it.
// No rider is ever left stuck on or in the truck.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type BakedFeature } from '../../road';
import { createSim, quantizeInput } from '../api';
import type { SimConfig, SimEvent } from '../types';
import {
  deckHeight,
  RAMP_TRUCK_LENGTH_M,
  RAMP_TRUCK_LIP_M,
  TRUCK_PLATFORM_M,
  truckBodyTop,
  truckClearMps,
} from './features';
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
const LIP_S = TRUCK.s0 + RAMP_TRUCK_LENGTH_M;
const BODY_S = LIP_S + TRUCK_PLATFORM_M;

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

/**
 * Rides the truck's line (d 3.4) from s 590 at about `speed` (throttle on below it, off above it),
 * or flat out with `full`, until a crash or `ticks`.
 */
function rideUp(speed: number, full = false, ticks = 60 * 10) {
  const h = riderHarness(withTruck(), { s: 590, d: 3.4, speed });
  const events: { ev: SimEvent; s: number; h: number; mode: string }[] = [];
  const trace: { s: number; h: number; mode: string }[] = [];
  for (let t = 0; t < ticks; t++) {
    const throttle = full || h.rider.speed < speed ? (full ? 1 : 0.3) : 0;
    for (const ev of h.step(input(throttle)))
      events.push({ ev, s: h.rider.pos.s, h: h.rider.h, mode: h.rider.mode });
    trace.push({ s: h.rider.pos.s, h: h.rider.h, mode: h.rider.mode });
    if (events.some((e) => e.ev.type === 'crash')) break;
  }
  return { events, trace };
}

const top = truckBodyTop(TRUCK);

describe("the ramp truck's body (skeptic F2)", () => {
  it('stands on a short lip platform, then is the parked car to the front; the clear speed is about 10 m/s', () => {
    const config = withTruck();
    expect(deckHeight(config, 0, LIP_S + 0.2, 3.4)).toBeCloseTo(RAMP_TRUCK_LIP_M, 9);
    expect(deckHeight(config, 0, BODY_S + 0.01, 3.4)).toBeCloseTo(top, 9);
    expect(deckHeight(config, 0, TRUCK.s1 - 0.1, 3.4)).toBeCloseTo(top, 9);
    expect(top).toBeCloseTo(3.96, 9); // the model's top-deck car roof
    const clear = truckClearMps(TRUCK, 9.81);
    expect(clear).toBeGreaterThan(9.5);
    expect(clear).toBeLessThan(11);
  });

  it('a slow rider rolling up the ramp (4 m/s) bumps the parked car: thrown off (a crash), never on or in it', () => {
    const r = rideUp(4);
    const crash = r.events.find((e) => e.ev.type === 'crash');
    expect(crash?.ev.data).toMatchObject({ cause: 'barrier', object: 'rampTruck', feature: 'carrier-1' });
    // It never rode past the car's rear, and never above the lip.
    for (const p of r.trace) {
      if (p.mode === 'Road') expect(p.s).toBeLessThan(BODY_S);
      expect(p.h).toBeLessThanOrEqual(RAMP_TRUCK_LIP_M + 0.2);
    }
  });

  it('too slow off the lip to clear the truck (8 m/s): it hits the body, it never lands on or in it', () => {
    const r = rideUp(8);
    expect(r.events.some((e) => e.ev.type === 'jump')).toBe(true);
    const crash = r.events.find((e) => e.ev.type === 'crash');
    expect(crash?.ev.data).toMatchObject({ object: 'rampTruck', feature: 'carrier-1' });
    expect(crash?.s ?? 0).toBeGreaterThanOrEqual(BODY_S);
    expect(r.events.filter((e) => e.ev.type === 'land')).toEqual([]);
  });

  it('fast enough to clear it (12 m/s): airborne over the whole truck, landed on the road past its front', () => {
    const r = rideUp(12, true);
    const land = r.events.find((e) => e.ev.type === 'land');
    expect(r.events.some((e) => e.ev.type === 'jump')).toBe(true);
    expect(land?.s ?? 0).toBeGreaterThan(TRUCK.s1);
    expect(land?.h).toBe(0);
    expect(r.events.filter((e) => e.ev.type === 'crash')).toEqual([]);
  });

  it('a rider put down inside the truck (a remount) steps out beside it on the road side', () => {
    const h = riderHarness(withTruck(), { s: TRUCK.s0 + 15, d: 3.4, speed: 0 });
    const events = h.step(input(0));
    expect(h.rider.pos.d).toBeLessThan(TRUCK.d0);
    expect(h.rider.pos.d).toBeGreaterThan(TRUCK.d0 - 0.5);
    expect(h.rider.h).toBe(0);
    expect(events.filter((e) => e.type === 'crash' || e.type === 'wobble')).toEqual([]);
  });

  it('no snag, through the whole sim: crawl up, get thrown off, remount beside the truck and ride on', () => {
    const sim = createSim(withTruck(560));
    let crashes = 0;
    let after = -1;
    let stuckInside = 0;
    let insideTicks = 0;
    for (let t = 0; t < 60 * 60; t++) {
      const me = sim.snapshot().entities[0];
      if (!me) throw new Error('no rider');
      const { d, yaw } = me.road;
      // Crawl the truck's line until thrown off, then ride on in the lane.
      const line = crashes === 0 ? 3.4 : 1.7;
      const slow = crashes === 0 && me.speed > 3;
      const steer = Math.max(-1, Math.min(1, 0.35 * (line - d) - 2.5 * yaw));
      sim.step([quantizeInput({ throttle: slow ? 0 : crashes === 0 ? 0.3 : 1, brake: 0, steer, flags: 0 })]);
      for (const e of sim.events()) if (e.type === 'crash' && e.actor === 0) crashes++;
      const now = sim.snapshot().entities[0];
      // Inside the truck on the road, past the tick tumble put it down there (the riding model steps
      // it out on its next tick).
      const inside =
        !!now && crashes > 0 && now.mode === 'Road' && now.road.s > TRUCK.s0 && now.road.s < TRUCK.s1;
      if (inside && now.road.d > TRUCK.d0 && now.road.d < TRUCK.d1 && now.road.h < 0.5) insideTicks++;
      else insideTicks = 0;
      stuckInside = Math.max(stuckInside, insideTicks);
      if (now && now.road.s > TRUCK.s1 + 50) {
        after = t;
        break;
      }
    }
    expect(crashes).toBeGreaterThanOrEqual(1);
    expect(stuckInside).toBeLessThanOrEqual(1);
    expect(after, 'rode on past the truck within a minute').toBeGreaterThan(0);
  });
});
