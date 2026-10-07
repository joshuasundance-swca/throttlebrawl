// The integration skeptic's finding F2 (playtest 1c): past the lip the sim held a level 2.8 m deck
// to the truck's front, while the model had a car parked on its top deck (roof 0.7 to 1.16 m above
// that deck) and then the cab, so a slow rider rolled along the deck inside that car and floated
// past the cab. The fix then made the car a solid. The live check of 2026-10-07 found that car passed
// through at the lip speeds, and a solid one crashes every carrier jump, so the car is gone (the
// coordinator's [default], vetoable; truck-deck.test.ts): past a short lip platform the truck is an
// empty top deck (a top a rider lands on and rides) and then the cab, its body, solid to its top.
// A slow rider who rolls up the ramp hops onto the deck and meets the cab by the closing-speed rule.
// He can use the existing U-turn to back off. Flights clear the actual roof/hood geometry, or land
// on a top large enough to hold the bike; one who flies into a part below its top hits it. No rider
// is ever left stuck on or in the truck.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type BakedFeature } from '../../road';
import { createSim, quantizeInput } from '../api';
import type { SimConfig, SimEvent } from '../types';
import {
  deckHeight,
  HAZARD_REACH_D_M,
  RAMP_TRUCK_LENGTH_M,
  RAMP_TRUCK_LIP_M,
  TRUCK_PLATFORM_M,
  truckBodyTop,
  truckClearMps,
} from './features';
import { riderState } from './index';
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
/** Where the empty top deck ends and the cab starts: 16.8 m from the ramp foot (where the model's flat deck ends). */
const CAB_S = TRUCK.s0 + 16.8;

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
    const throttle = full || h.rider.speed < speed ? 1 : 0;
    for (const ev of h.step(input(throttle)))
      events.push({ ev, s: h.rider.pos.s, h: h.rider.h, mode: h.rider.mode });
    trace.push({ s: h.rider.pos.s, h: h.rider.h, mode: h.rider.mode });
    if (events.some((e) => e.ev.type === 'crash')) break;
  }
  return { events, trace };
}

const top = truckBodyTop(TRUCK);

describe("the ramp truck's body (skeptic F2)", () => {
  it('stands on a short lip platform, then is an empty deck to the cab, then the cab to the front; the clear speed is about 10 m/s', () => {
    const config = withTruck();
    expect(deckHeight(config, 0, LIP_S + 0.2, 3.4)).toBeCloseTo(RAMP_TRUCK_LIP_M, 9);
    expect(deckHeight(config, 0, BODY_S + 0.01, 3.4)).toBeCloseTo(RAMP_TRUCK_LIP_M, 9);
    expect(deckHeight(config, 0, TRUCK.s0 + 17.5, 3.4)).toBeCloseTo(3.15, 9);
    expect(deckHeight(config, 0, TRUCK.s0 + 20, 3.4)).toBeLessThan(2.05);
    expect(top).toBeCloseTo(3.7, 9); // the stacks' height, only on their own small footprints
    const clear = truckClearMps(TRUCK, 9.81);
    expect(clear).toBeGreaterThan(9.5);
    expect(clear).toBeLessThan(11);
  });

  it('a slow rider rolling up the ramp (4 m/s) meets the cab with a wobble, never inside it', () => {
    const r = rideUp(4);
    const hit = r.events.find((e) => e.ev.type === 'wobble' && e.ev.data['object'] === 'rampTruck');
    expect(hit?.ev.data).toMatchObject({ cause: 'barrier', object: 'rampTruck', feature: 'carrier-1' });
    expect(r.events.some((e) => e.ev.type === 'crash')).toBe(false);
    // It never rode past the cab's front, and never below the deck once past the lip platform.
    for (const p of r.trace) {
      if (p.mode === 'Road') expect(p.s).toBeLessThan(TRUCK.s0 + 17);
      if (p.s > BODY_S + 0.3) expect(p.h).toBeGreaterThanOrEqual(RAMP_TRUCK_LIP_M - 0.01);
    }
  });

  it('too slow off the lip to clear the truck (8 m/s): it comes down on the deck, never inside the truck', () => {
    const r = rideUp(8);
    expect(r.events.some((e) => e.ev.type === 'jump')).toBe(true);
    const land = r.events.find((e) => e.ev.type === 'land');
    expect(land?.ev.data).toMatchObject({ on: 'truck', object: 'rampTruck' });
    expect(land?.s ?? 0).toBeGreaterThanOrEqual(BODY_S);
    expect(land?.s ?? 0).toBeLessThan(CAB_S);
    // Nothing is hit before the cab's front: the crash, rolling on at 8 m/s, is the cab's.
    for (const c of r.events.filter((e) => e.ev.type === 'crash'))
      expect(c.s, 'a crash before the cab').toBeGreaterThan(CAB_S - 1);
  });

  it('a high slow flight clears the cab face and lands on its actual roof, below the old invisible height', () => {
    // At 3.3 m and a beat from the cab's front, at 6 m/s: above its actual 3.15 m roof, below
    // the former 3.96 m invisible body box.
    const h = riderHarness(withTruck(), { s: CAB_S - 0.5, d: 3.4, speed: 6 });
    const st = riderState(h.world);
    h.rider.mode = 'Airborne';
    h.rider.h = 3.3;
    st.yAbs[h.rider.id] = h.config.road.surfaceHeight(0, CAB_S - 0.5, 3.4) + 3.3;
    st.vy[h.rider.id] = 0;
    const events: SimEvent[] = [];
    for (let t = 0; t < 60 && !events.some((e) => e.type === 'crash'); t++) events.push(...h.step(input(0)));
    expect(events.some((e) => e.type === 'crash')).toBe(false);
    expect(events.find((e) => e.type === 'land')?.data).toMatchObject({ on: 'truck' });
  });

  it('physically fast enough to clear it (16 m/s): airborne over the whole truck, landed on the road past its front', () => {
    const r = rideUp(16, true);
    const land = r.events.find((e) => e.ev.type === 'land');
    expect(r.events.some((e) => e.ev.type === 'jump')).toBe(true);
    expect(land?.s ?? 0).toBeGreaterThan(TRUCK.s1);
    expect(land?.h).toBe(0);
    expect(r.events.filter((e) => e.ev.type === 'crash')).toEqual([]);
  });

  it('riding alongside, the bike meets the truck with its side, not its middle (playtest 4 hitbox audit)', () => {
    // The bike's side 0.1 m into the drawn truck: held off by its reach, a scrape against the body.
    const h = riderHarness(withTruck(), { s: TRUCK.s0 + 15, d: TRUCK.d0 - 0.3, speed: 10 });
    const events = h.step(input(0.3));
    expect(events.some((e) => e.data?.['object'] === 'rampTruck')).toBe(true);
    expect(h.rider.pos.d).toBeLessThanOrEqual(TRUCK.d0 - HAZARD_REACH_D_M);
    // The control: a bike whose side is clear of the truck rides by untouched.
    const clear = riderHarness(withTruck(), { s: TRUCK.s0 + 15, d: TRUCK.d0 - 0.6, speed: 10 });
    expect(clear.step(input(0.3)).filter((e) => e.data?.['object'] === 'rampTruck')).toEqual([]);
    expect(clear.rider.pos.d).toBeCloseTo(TRUCK.d0 - 0.6, 6);
  });

  it('a rider put down inside the truck (a remount) steps out beside it on the road side', () => {
    const h = riderHarness(withTruck(), { s: TRUCK.s0 + 15, d: 3.4, speed: 0 });
    const events = h.step(input(0));
    // Beside it by the rider's reach (its bike's side clear of the truck's), and no further than a bike.
    expect(h.rider.pos.d).toBeLessThan(TRUCK.d0 - HAZARD_REACH_D_M);
    expect(h.rider.pos.d).toBeGreaterThan(TRUCK.d0 - 2 * HAZARD_REACH_D_M);
    expect(h.rider.h).toBe(0);
    expect(events.filter((e) => e.type === 'crash' || e.type === 'wobble')).toEqual([]);
  });

  it('no snag through the whole sim: a slow cab contact can U-turn and back off the truck', () => {
    const sim = createSim(withTruck(560));
    let contacts = 0;
    let turnAt = -1;
    let after = -1;
    let stuckInside = 0;
    let insideTicks = 0;
    for (let t = 0; t < 60 * 60; t++) {
      const me = sim.snapshot().entities[0];
      if (!me) throw new Error('no rider');
      const { d, yaw } = me.road;
      // Crawl the truck's line until contact, then use the existing turn gesture and back off.
      const line = contacts === 0 ? 3.4 : 1.7;
      const slow = contacts === 0 && me.speed > 3;
      const steer = Math.max(-1, Math.min(1, me.road.dir * 0.35 * (line - d) - 2.5 * yaw));
      const age = turnAt < 0 ? -1 : t - turnAt;
      const turning = age >= 0 && age < 110;
      const brake = turning && age !== 0 && !(age >= 7 && age < 13) ? 1 : 0;
      sim.step([
        quantizeInput({
          throttle: turning ? 0 : slow ? 0 : contacts === 0 ? 0.3 : 1,
          brake,
          steer: turning ? (age >= 19 ? 1 : 0) : steer,
          flags: 0,
        }),
      ]);
      for (const e of sim.events())
        if ((e.type === 'crash' || e.type === 'wobble') && e.actor === 0 && e.data['object'] === 'rampTruck')
          contacts++;
      if (turnAt < 0 && contacts > 0) turnAt = t + 1;
      const now = sim.snapshot().entities[0];
      // Inside the truck on the road, past the tick tumble put it down there (the riding model steps
      // it out on its next tick).
      const inside =
        !!now && contacts > 0 && now.mode === 'Road' && now.road.s > TRUCK.s0 && now.road.s < TRUCK.s1;
      if (inside && now.road.d > TRUCK.d0 && now.road.d < TRUCK.d1 && now.road.h < 0.5) insideTicks++;
      else insideTicks = 0;
      stuckInside = Math.max(stuckInside, insideTicks);
      if (now && now.road.dir === -1 && now.road.s < TRUCK.s0 - 5 && now.road.h < 0.5) {
        after = t;
        break;
      }
    }
    expect(contacts).toBeGreaterThanOrEqual(1);
    expect(stuckInside).toBeLessThanOrEqual(1);
    expect(after, 'turned back and rode off the truck within a minute').toBeGreaterThan(0);
  });
});
