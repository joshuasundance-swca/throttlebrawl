// Street furniture met by a rider (playtest 4, the maintainer, 2026-10-05: "solid but maybe forgiving
// to sides, brushes, etc"). A downtown sidewalk on a straight fixture road stands its lamps, planters
// and the rest where road/furniture.ts plans them; a rider aimed at one meets it by the one rule for a
// heavy thing (the closing speed along the contact's normal against traffic.solidHitMps, #552): square
// on at speed is a crash, a glance off its side a wobble that slides the rider past, a crawl a wobble.
// A light piece (a board, a scooter) is ridden through with a smashable's wobble, never a crash. Each
// rule has its control: the same rides with `riders.furniture` off pass through untouched.
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  createRouteProgress,
  fixtureNetwork,
  planStreetFurniture,
  type BakedTag,
  type FurnitureKind,
  type StreetFurniture,
} from '../../road';
import { KIND_SPEC } from '../smash';
import { trafficHitMps } from '../traffic/contact-rule';
import type { SimConfig, SimEvent } from '../types';
import {
  BIKE_RADIUS_M,
  BIKE_SPINE_HALF_M,
  closingMps,
  FURNITURE_KEY,
  LIGHT_KICK,
  LIGHT_SCRUB,
  slideAlong,
  spineAt,
  spineGap,
} from './furniture';
import { riderState } from './index';
import { input, riderHarness, testConfig } from './testing';
import { RIDER_CONTACT_HALF_WIDTH_M, RIDER_HALF_LENGTH_M } from './contact';

const TOWERS: BakedTag = { s0: 0, s1: 3000, side: 'right', tag: 'towers' };

/** A straight road with a downtown sidewalk on its right (a 4 m kerb band, render's towers). */
function downtown(on = true): SimConfig {
  const base = testConfig({ tuning: { 'ground.offRoad': 1, [FURNITURE_KEY]: on ? 1 : 0 } });
  const bundle = fixtureNetwork([{ id: 'a', lengthM: 3000, kappa: 0 }]);
  const road0 = bundle.roads[0];
  if (!road0) throw new Error('no road');
  const road = createRoadNetwork({ ...bundle, roads: [{ ...road0, tags: [TOWERS] }] });
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

/** The first piece of a kind past s 30 with nothing else within 12 m before it on its line. */
function pieceOf(config: SimConfig, kind: FurnitureKind): StreetFurniture {
  const items = planStreetFurniture(config.road, config.seed).items;
  const it = items.find(
    (p) =>
      p.kind === kind &&
      p.s > 30 &&
      !items.some((q) => q !== p && q.s < p.s && q.s > p.s - 14 && Math.abs(q.shape.d - p.shape.d) < 2),
  );
  if (!it) throw new Error(`no ${kind} in the plan`);
  return it;
}

/**
 * Rides straight along the road at `speed` (held: throttle below it, off above), from 14 m before the
 * piece at its footprint's d plus `offset`, until a crash or 5 m past it (before the next piece on the
 * sidewalk: a lamp's planter stands 15 m on).
 */
function rideAt(config: SimConfig, piece: StreetFurniture, speed: number, offset: number, ticks = 60 * 4) {
  const h = riderHarness(config, { s: piece.shape.s - 14, d: piece.shape.d + offset, speed });
  const events: SimEvent[] = [];
  const trace: { s: number; d: number }[] = [];
  for (let t = 0; t < ticks; t++) {
    events.push(...h.step(input(h.rider.speed < speed ? 0.3 : 0)));
    trace.push({ s: h.rider.pos.s, d: h.rider.pos.d });
    if (events.some((e) => e.type === 'crash') || h.rider.pos.s > piece.shape.s + 5) break;
  }
  const met = events.filter(
    (e) => e.data['furniture'] === String(piece.id) || e.data['furniture'] === piece.id,
  );
  return { events, met, trace, h };
}

/** How deep the bike's capsule got into a piece's footprint over a ride, m (0 when it never did). */
function deepest(piece: StreetFurniture, trace: readonly { s: number; d: number }[]): number {
  let worst = 0;
  for (const p of trace) {
    const g = spineGap(piece.shape, spineAt(p.s, p.d, 1, 0));
    worst = Math.max(worst, BIKE_RADIUS_M - g.dist);
  }
  return worst;
}

describe('the contact geometry (sim/riders/furniture.ts)', () => {
  it('the bike is the rider box with round ends: 2.0 by 0.8 m', () => {
    expect(BIKE_SPINE_HALF_M + BIKE_RADIUS_M).toBe(RIDER_HALF_LENGTH_M);
    expect(BIKE_RADIUS_M).toBe(RIDER_CONTACT_HALF_WIDTH_M);
  });

  it('square on, the whole speed closes; off the round of the front, only the part along the normal', () => {
    const pole = { s: 10, d: 0, r: 0.1, hu: 0, hv: 0, us: 1, ud: 0, reachS: 0.1, reachD: 0.1 };
    // The bike's front touching it head on: the normal is the heading.
    const square = spineGap(pole, spineAt(10 - BIKE_SPINE_HALF_M - 0.5, 0, 1, 0));
    expect(square.dist).toBeCloseTo(0.5 - 0.1, 6);
    expect(square.ns).toBeCloseTo(-1, 6);
    expect(closingMps(20, 1, 0, square.ns, square.nd)).toBeCloseTo(20, 6);
    // Off to its side by 0.45 m: the normal leans over, and less of the speed closes.
    const glance = spineGap(pole, spineAt(10 - BIKE_SPINE_HALF_M - 0.2, 0.45, 1, 0));
    const c = closingMps(20, 1, 0, glance.ns, glance.nd);
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThan(20 * 0.6);
    // Alongside it, moving parallel: nothing closes.
    const side = spineGap(pole, spineAt(10, 0.6, 1, 0));
    expect(side.nd).toBeCloseTo(1, 6);
    expect(closingMps(20, 1, 0, side.ns, side.nd)).toBeCloseTo(0, 6);
  });

  it('a slide keeps the speed along the piece and loses the speed into it; it never turns the bike back', () => {
    const along = slideAlong(20, 1, 0.2, 0, -1); // a wall on the right, the bike angled into it
    expect(along.speed).toBeCloseTo(20 * Math.cos(0.2), 3);
    expect(along.yaw).toBeCloseTo(0, 6);
    const head = slideAlong(20, 1, 0, -1, 0); // square on: stopped
    expect(head.speed).toBeCloseTo(0, 6);
    const away = slideAlong(20, 1, 0.2, 0, 1); // moving away from it: untouched
    expect(away).toEqual({ speed: 20, yaw: 0.2 });
  });

  it("a light piece is ridden through as a smashable parking meter is (sim/smash's own numbers)", () => {
    expect(LIGHT_SCRUB).toBe(KIND_SPEC['parking-meter'].scrub);
    expect(LIGHT_KICK).toBe(KIND_SPEC['parking-meter'].kick);
  });
});

describe('street furniture: solid but forgiving (playtest 4)', () => {
  const config = downtown();
  const lamp = pieceOf(config, 'dt-lamp');
  const line = trafficHitMps(config.tuning);

  it('the crash line is the one for every heavy thing (#552)', () => {
    expect(line).toBe(10);
    expect(lamp.cls).toBe('solid');
  });

  it('square on at speed (20 m/s into a lamp post) is a crash, named, and the bike never gets into it', () => {
    const r = rideAt(config, lamp, 20, 0);
    const crash = r.events.find((e) => e.type === 'crash');
    expect(crash?.data).toMatchObject({ cause: 'barrier', object: 'dt-lamp', furniture: String(lamp.id) });
    expect(Number(crash?.data['impactMps'])).toBeGreaterThan(line);
    expect(deepest(lamp, r.trace)).toBeLessThan(0.02);
    // Control: with the furniture off the same ride passes through it, as every ride did before.
    const off = rideAt(downtown(false), lamp, 20, 0);
    expect(off.met).toEqual([]);
    expect(off.events.filter((e) => e.type === 'crash')).toEqual([]);
    expect(off.h.rider.pos.s).toBeGreaterThan(lamp.s + 5);
  });

  it('a glance off its side (the bike 0.47 m off its line) wobbles and slides on past it', () => {
    for (const side of [1, -1]) {
      const r = rideAt(config, lamp, 20, side * 0.47);
      expect(r.met.filter((e) => e.type === 'crash')).toEqual([]);
      const wobble = r.met.find((e) => e.type === 'wobble');
      expect(wobble?.data).toMatchObject({ cause: 'barrier', object: 'dt-lamp' });
      expect(Number(wobble?.data['impactMps'])).toBeLessThan(line);
      expect(r.h.rider.pos.s).toBeGreaterThan(lamp.s + 3);
      expect(deepest(lamp, r.trace)).toBeLessThan(0.02);
    }
  });

  it('across its width the outcome goes from crash (square) to wobble (glancing) to nothing (clear)', () => {
    const outcomes: string[] = [];
    // The lamp is 0.2 m across and the bike 0.8 m: they touch within 0.5 m of each other's line, and an
    // overlap of under GRAZE_M (0.3 m), 0.2 m off its line or more, is a graze (#552's rule).
    for (const offset of [0, 0.1, 0.18, 0.25, 0.45, 0.6]) {
      const r = rideAt(config, lamp, 20, offset);
      outcomes.push(
        r.met.some((e) => e.type === 'crash')
          ? 'crash'
          : r.met.some((e) => e.type === 'wobble')
            ? 'wobble'
            : 'none',
      );
    }
    expect(outcomes).toEqual(['crash', 'crash', 'crash', 'wobble', 'wobble', 'none']);
  });

  it('square on at a crawl (8 m/s) wobbles and stops against it', () => {
    const r = rideAt(config, lamp, 8, 0, 60 * 8);
    expect(r.events.filter((e) => e.type === 'crash')).toEqual([]);
    expect(r.met.some((e) => e.type === 'wobble')).toBe(true);
    expect(r.h.rider.pos.s).toBeLessThan(lamp.shape.s);
    expect(deepest(lamp, r.trace)).toBeLessThan(0.02);
  });

  it('a bench is a box: riding along its back with the bars into it holds the rider off and slides him on', () => {
    // The plaza's bench needs a plaza; a planter (a 1.8 m box) on the sidewalk is the same rule.
    const planter = planStreetFurniture(config.road, config.seed).items.find((p) => p.kind === 'dt-planter');
    if (!planter) throw new Error('no planter');
    const h = riderHarness(config, {
      s: planter.shape.s - planter.shape.reachS - 2,
      d: planter.shape.d - planter.shape.reachD - BIKE_RADIUS_M - 0.05,
      speed: 15,
      yaw: 0.06,
    });
    const events: SimEvent[] = [];
    let worst = 0;
    for (let t = 0; t < 120 && h.rider.pos.s < planter.shape.s + 5; t++) {
      events.push(...h.step(input(0.4)));
      worst = Math.max(
        worst,
        BIKE_RADIUS_M - spineGap(planter.shape, spineAt(h.rider.pos.s, h.rider.pos.d, 1, h.rider.yaw)).dist,
      );
    }
    expect(events.filter((e) => e.type === 'crash')).toEqual([]);
    expect(events.filter((e) => e.type === 'wobble' && e.data['object'] === 'dt-planter')).toHaveLength(1);
    expect(worst).toBeLessThan(0.05);
    expect(h.rider.pos.s).toBeGreaterThan(planter.shape.s + planter.shape.reachS);
  });

  it('flying into it below its top is the same rule (a crash at speed); over its top the bike flies on', () => {
    const hydrant = pieceOf(config, 'hydrant');
    for (const [lift, crashes] of [
      [0.3, true],
      [3, false],
    ] as const) {
      const h = riderHarness(config, { s: hydrant.shape.s - 6, d: hydrant.shape.d, speed: 20 });
      const st = riderState(h.world);
      h.rider.mode = 'Airborne';
      h.rider.h = lift;
      st.yAbs[h.rider.id] = config.road.surfaceHeight(0, hydrant.shape.s - 6, hydrant.shape.d) + lift;
      st.vy[h.rider.id] = lift > 1 ? 4 : 0;
      st.lastTick[h.rider.id] = -2;
      const events: SimEvent[] = [];
      for (let t = 0; t < 30; t++) events.push(...h.step(input(1)));
      const crash = events.find((e) => e.type === 'crash');
      if (crashes) expect(crash?.data).toMatchObject({ object: 'hydrant', furniture: String(hydrant.id) });
      else expect(crash).toBeUndefined();
    }
  });
});

describe('light street furniture: ridden through with a wobble, never a crash', () => {
  const config = downtown();
  const items = planStreetFurniture(config.road, config.seed).items;
  const light = items.find((p) => p.cls === 'light' && p.s > 30);

  it('a board or a scooter at full speed: one smashable wobble, a little speed, no crash', () => {
    if (!light) throw new Error('no light piece on this sidewalk');
    const r = rideAt(config, light, 30, 0, 60 * 2);
    expect(r.events.filter((e) => e.type === 'crash')).toEqual([]);
    const wobbles = r.met.filter((e) => e.type === 'wobble');
    expect(wobbles).toHaveLength(1);
    expect(wobbles[0]?.data).toMatchObject({ cause: 'smash', object: light.kind });
    expect(r.h.rider.pos.s).toBeGreaterThan(light.s + 3);
    // Control: with the furniture off it is a ghost, as before.
    expect(rideAt(downtown(false), light, 30, 0, 60 * 2).met).toEqual([]);
  });
});
