// The car carrier's top deck is empty (the maintainer, 2026-10-06, [decided]: "consistent physics and
// gameplay is important here so players know what to expect"; land on and ride any solid top big enough
// to hold a bike; a road race in a physical world with honest edges: what is drawn is what is met, nothing
// is a ghost, nothing is an invisible wall). The live check of 2026-10-07 (polish P, mustFix 3) found the car
// on the carrier's top deck passed through: Causeway Sprint seed 1, 28 ticks inside it below its 3.96 m roof
// at 19 m/s. Making the car solid by height would crash every carrier jump, because from the lip a rider
// meets the car about 1 m below its roof at every speed from 8 to 40 m/s (23 trucks, the Seven Mile hop, the
// ramp-truck cuts). So the car is gone [default, the coordinator's call, vetoable by the maintainer]: not
// drawn (tools/blender/props/tow_truck.py), and not in the sim. What is past the lip is the carrier's deck, a
// top a rider lands on and rides, then the cab, which stays solid as it was.
//
// This file is the sim's half: the deck is the one empty-topped thing, the lip speeds that cleared still
// clear, the ones that did not now land on the deck, and what the car was is open air. The drawn half (what
// stands where, against this sim) is scripts/carrier-hitboxes.test.ts.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type BakedFeature } from '../../road';
import type { SimConfig, SimEvent } from '../types';
import {
  deckHeight,
  RAMP_TRUCK_LENGTH_M,
  RAMP_TRUCK_LIP_M,
  TRUCK_CAB_FROM_FOOT_M,
  TRUCK_PLATFORM_M,
  truckBodyAt,
  truckBodyTop,
  truckClearMps,
} from './features';
import { riderState } from './index';
import { supportKeyOf } from './supports';
import { input, riderHarness, testConfig, type RiderHarness } from './testing';

const TRUCK: BakedFeature = {
  kind: 'rampTruck',
  id: 'carrier-1',
  s0: 600,
  s1: 621.1,
  d0: 2.4,
  d1: 4.4,
  params: { rampLengthM: RAMP_TRUCK_LENGTH_M, lipHeightM: RAMP_TRUCK_LIP_M },
};
const LIP_S = TRUCK.s0 + RAMP_TRUCK_LENGTH_M;
/** Where the lip platform ends and the top deck starts, and where the deck ends and the cab starts. */
const DECK_S = LIP_S + TRUCK_PLATFORM_M;
/** Where the top deck ends and the cab starts: 16.8 m from the ramp foot (the model's UPPER_DECK_END, tools/blender/props/tow_truck.py). */
const CAB_S = TRUCK.s0 + 16.8;
const LIP = RAMP_TRUCK_LIP_M;
const CAB_TOP = truckBodyTop(TRUCK);
/** The rider's line across the carrier, and a beat past its front. */
const D = 3.4;

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

interface Tick {
  s: number;
  h: number;
  mode: string;
  speed: number;
  events: SimEvent[];
}

/** Steps `h` until `stop` says so (or `ticks`), recording each tick. */
function run(
  h: RiderHarness,
  drive: (h: RiderHarness) => ReturnType<typeof input>,
  stop: (t: Tick) => boolean = () => false,
  ticks = 60 * 12,
): Tick[] {
  const out: Tick[] = [];
  for (let n = 0; n < ticks; n++) {
    const events = h.step(drive(h));
    const t = { s: h.rider.pos.s, h: h.rider.h, mode: h.rider.mode, speed: h.rider.speed, events };
    out.push(t);
    if (stop(t)) break;
  }
  return out;
}

/**
 * Rides the carrier's line from `from` m before its lip holding `speed` (flat out below it, coasting
 * above it, the ramp's pull included): the speed at the lip is the speed asked for, to a few tenths.
 */
function rideUp(speed: number, ticks = 60 * 12, from = 20): Tick[] {
  const h = riderHarness(withTruck(), { s: LIP_S - from, d: D, speed });
  return run(
    h,
    () => input(h.rider.speed < speed ? 1 : 0),
    (t) => t.events.some((e) => e.type === 'crash'),
    ticks,
  );
}

/** A rider put in the air at (s, D) `above` m over the road, moving `speed`, falling at `vy`. */
function inAir(s: number, above: number, speed: number, vy = 0, d = D): RiderHarness {
  const h = riderHarness(withTruck(), { s, d, speed });
  const st = riderState(h.world);
  h.rider.mode = 'Airborne';
  h.rider.h = above;
  const surface = h.config.road.surfaceHeight(0, s, d);
  st.yAbs[h.rider.id] = surface + above;
  st.vy[h.rider.id] = vy;
  st.airTicks[h.rider.id] = 0;
  return h;
}

const events = (ts: readonly Tick[], type: string) =>
  ts.flatMap((t) => t.events).filter((e) => e.type === type);

describe('what the sim holds on a carrier past its lip', () => {
  it('the platform, then an empty deck at the lip height up to the cab, then the cab (the body) to the front', () => {
    const config = withTruck();
    expect(TRUCK_CAB_FROM_FOOT_M).toBe(16.8);
    // The deck: a top at the lip height, no body (the car that stood on it is gone).
    for (const s of [DECK_S + 0.01, DECK_S + 2, CAB_S - 0.01]) {
      expect(deckHeight(config, 0, s, D), `deck at ${s}`).toBeCloseTo(LIP, 9);
      expect(truckBodyAt(config, 0, s, D), `body at ${s}`).toBeNull();
    }
    // The cab and the hood: the body, solid to its top, as it was.
    for (const s of [CAB_S + 0.01, TRUCK.s1 - 0.1]) {
      expect(deckHeight(config, 0, s, D), `cab at ${s}`).toBeCloseTo(CAB_TOP, 9);
      expect(truckBodyAt(config, 0, s, D)?.id, `body at ${s}`).toBe('carrier-1');
    }
    expect(CAB_TOP).toBeCloseTo(3.96, 9);
  });

  it('what the car was is open air: a rider above the deck, inside the old car, meets nothing and lands on the deck', () => {
    // 6 m/s is under the 9.65 m/s that clears the truck; at 3.5 m the old car (roof 3.96 m) was a wall.
    const h = inAir(DECK_S + 0.5, 3.5, 6, 0);
    const ts = run(
      h,
      () => input(0),
      (t) => t.events.some((e) => e.type === 'land' || e.type === 'crash'),
    );
    expect(events(ts, 'crash')).toEqual([]);
    const land = events(ts, 'land')[0];
    expect(land?.data).toMatchObject({ on: 'truck', object: 'rampTruck' });
    expect(h.rider.h).toBeCloseTo(LIP, 6);
    expect(supportKeyOf(h.world, h.rider.id)).toBe('d:carrier-1');
  });

  it('a rider below the deck in the air, out over its side, is met by the truck: no fast pass under a drawn deck', () => {
    // 12 m/s clears the truck from its lip, but a rider 1.5 m up beside the deck's line is under it: the
    // frame, the wheels and the lower car are drawn there. It used to pass through at that speed.
    const h = inAir(DECK_S + 1, 1.5, 12, 0);
    const ts = run(
      h,
      () => input(0.3),
      (t) => t.events.some((e) => e.type === 'land' || e.type === 'crash'),
      120,
    );
    const hit = events(ts, 'crash')[0];
    expect(hit?.data).toMatchObject({ object: 'rampTruck', feature: 'carrier-1' });
    expect(events(ts, 'land')).toEqual([]);
  });
});

describe('a slow hop from the lip lands on the deck and rides it', () => {
  it('8 m/s: a jump, a clean landing on the deck 2.8 m up, nothing inside the truck on the way', () => {
    const ts = rideUp(8, 60 * 3);
    expect(events(ts, 'jump').length).toBe(1);
    const land = events(ts, 'land')[0];
    expect(land?.data).toMatchObject({ on: 'truck', object: 'rampTruck' });
    // Over the deck it is never below the deck's height but the first tick's fall off the lip (a few mm;
    // the old car was a solid there).
    for (const t of ts.filter((x) => x.s > DECK_S && x.s < CAB_S))
      expect(t.h, `s ${t.s.toFixed(2)}`).toBeGreaterThanOrEqual(LIP - 0.01);
    // It crashed into nothing before the cab (a crash here, if any, is the cab's front).
    const crash = ts.find((t) => t.events.some((e) => e.type === 'crash'));
    if (crash) expect(crash.s).toBeGreaterThan(CAB_S - 1.5);
  });

  it('braking on the deck stops on it: it holds the bike, with the cab ahead', () => {
    const h = inAir(DECK_S + 0.3, LIP + 0.1, 6, -1);
    const ts = run(
      h,
      () => input(0, 1),
      () => false,
      60 * 4,
    );
    expect(events(ts, 'crash')).toEqual([]);
    expect(h.rider.speed).toBeCloseTo(0, 6);
    expect(h.rider.pos.s).toBeGreaterThan(DECK_S);
    expect(h.rider.pos.s).toBeLessThan(CAB_S);
    expect(supportKeyOf(h.world, h.rider.id)).toBe('d:carrier-1');
    expect(h.rider.h).toBeCloseTo(LIP, 6);
  });

  it('the cab is a wall from the deck at any speed (a rider on a top cannot back off): thrown off, never stuck, and no clearing speed carries it through', () => {
    const at = (speed: number) => {
      const h = inAir(CAB_S - 3, LIP + 0.02, speed, -0.5);
      return run(
        h,
        () => input(0.2),
        (t) => t.events.some((e) => e.type === 'crash'),
        60 * 8,
      );
    };
    // 3 m/s is a crawl; 14 m/s is over the 9.65 m/s that clears the truck from its lip, which rides a
    // rider the deck's length and no further.
    for (const speed of [3, 14]) {
      const ts = at(speed);
      const crash = events(ts, 'crash')[0];
      expect(crash?.data, `${speed} m/s`).toMatchObject({ object: 'rampTruck', feature: 'carrier-1' });
      expect(
        ts.find((t) => t.events.includes(crash as SimEvent))?.s,
        `${speed} m/s: at the cab's front`,
      ).toBeLessThan(CAB_S + 0.01);
    }
  });

  it('lands on the cab roof, a top of its own, and rides off its front', () => {
    const h = inAir(CAB_S + 1.5, CAB_TOP + 0.05, 8, -2);
    const ts = run(
      h,
      () => input(0.3),
      (t) => t.events.some((e) => e.type === 'land') && t.mode === 'Road',
      60,
    );
    expect(events(ts, 'land')[0]?.data).toMatchObject({ on: 'truck', quality: 'clean' });
    expect(supportKeyOf(h.world, h.rider.id)).toBe('t:carrier-1');
  });
});

describe('every lip speed that cleared the truck still clears it', () => {
  // The control: the same sweep on main (a car solid by speed) reads the same: a jump, no crash, down on
  // the road past the front. Below the clear speed the car used to be a wall (a crash at the body's
  // start); the deck now holds the rider instead.
  const SPEEDS = [11, 12, 14, 16, 19.4, 24, 28, 32, 36];

  it(`from 11 to 36 m/s: airborne over the whole truck, down on the road past its front, no crash`, () => {
    const lines: string[] = [];
    for (const v of SPEEDS) {
      const ts = rideUp(v, 60 * 10);
      const land = events(ts, 'land').find((e) => e.data['on'] === undefined);
      const landS = ts.find((t) => t.events.includes(land as SimEvent))?.s ?? 0;
      lines.push(`${v} m/s: land s +${(landS - TRUCK.s0).toFixed(1)} m`);
      expect(events(ts, 'jump').length, `${v} jumps`).toBeGreaterThanOrEqual(1);
      expect(events(ts, 'crash'), `${v} crash`).toEqual([]);
      expect(land, `${v} lands on the road`).toBeDefined();
      expect(landS, `${v} lands past the front`).toBeGreaterThan(TRUCK.s1);
    }
    console.log(`[examined] lip speeds that clear, still clear: ${lines.join('; ')}`);
  });

  it('the narrow band the old car let through on speed alone (the clear speed, 9.65 m/s, to about 10.5) now lands on the deck', () => {
    const clear = truckClearMps(TRUCK, 9.81);
    expect(clear).toBeCloseTo(9.65, 1);
    const lines: string[] = [];
    for (const v of [clear + 0.15, 10.0, 10.3]) {
      const ts = rideUp(v, 60 * 4);
      const land = events(ts, 'land')[0];
      lines.push(`${v.toFixed(2)} m/s: ${land ? `lands on ${String(land.data['on'])}` : 'no landing'}`);
      expect(land?.data['on'], `${v}`).toBe('truck');
    }
    // 10.7 m/s is over the whole deck: down on the road past the front, as it always was.
    const over = events(rideUp(10.8, 60 * 4), 'land')[0];
    lines.push(
      `10.8 m/s: ${over?.data['on'] === undefined ? 'lands on the road' : `lands on ${String(over.data['on'])}`}`,
    );
    expect(over?.data['on']).toBeUndefined();
    console.log(`[examined] the band: ${lines.join('; ')}`);
  });
});
