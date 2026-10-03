// Solid road hazards (run W-U, the pitch deck's #12: the ferry deck's parked pickups and coffee cart,
// the clear-cut's stumps, the festival's chainsaw bears). A `hazard` feature with `params.solid` is a
// wall box for a riding rider: head on it stops him (a crash when fast, a wobble at a crawl), from
// the side it holds him beside it, and flying into it below its top is a crash. One without `solid`
// is what every hazard was before: nothing the sim reads.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type BakedFeature } from '../../road';
import type { SimConfig, SimEvent } from '../types';
import { HAZARD_REACH_D_M, HAZARD_REACH_S_M, hazardTop, solidHazardAt } from './features';
import { riderState } from './index';
import { input, riderHarness, testConfig } from './testing';

const PICKUP: BakedFeature = {
  kind: 'hazard',
  id: 'deck-pickup-1',
  s0: 600,
  s1: 605.4,
  d0: 2.4,
  d1: 4.5,
  params: { solid: true, object: 'pickup', heightM: 1.9 },
};

function withHazards(features: readonly BakedFeature[]): SimConfig {
  const base = testConfig();
  const bundle = fixtureNetwork([{ id: 'a', lengthM: 3000, kappa: 0 }]);
  const road0 = bundle.roads[0];
  if (!road0) throw new Error('no road');
  const road = createRoadNetwork({ ...bundle, roads: [{ ...road0, features: [...features] }] });
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

/** Rides along d from s 580 at a held speed (throttle below it, off above), until a crash or `ticks`. */
function rideInto(config: SimConfig, speed: number, d = 3.4, ticks = 60 * 6) {
  const h = riderHarness(config, { s: 580, d, speed });
  const events: SimEvent[] = [];
  const trace: { s: number; d: number }[] = [];
  for (let t = 0; t < ticks; t++) {
    events.push(...h.step(input(h.rider.speed < speed ? 0.3 : 0)));
    trace.push({ s: h.rider.pos.s, d: h.rider.pos.d });
    if (events.some((e) => e.type === 'crash')) break;
  }
  return { events, trace, h };
}

const inside = (p: { s: number; d: number }) =>
  p.s > PICKUP.s0 - HAZARD_REACH_S_M + 0.01 &&
  p.s < PICKUP.s1 + HAZARD_REACH_S_M &&
  p.d > PICKUP.d0 - HAZARD_REACH_D_M + 0.01 &&
  p.d < PICKUP.d1 + HAZARD_REACH_D_M - 0.01;

describe('solid road hazards (run W-U)', () => {
  it('finds a solid hazard by its box grown by the bike, and nothing else', () => {
    const config = withHazards([
      PICKUP,
      { ...PICKUP, id: 'decor', s0: 700, s1: 705, params: { object: 'pickup' } },
    ]);
    expect(solidHazardAt(config, 0, 600 - HAZARD_REACH_S_M + 0.05, 3)?.id).toBe('deck-pickup-1');
    expect(solidHazardAt(config, 0, 603, PICKUP.d0 - HAZARD_REACH_D_M + 0.05)?.id).toBe('deck-pickup-1');
    expect(solidHazardAt(config, 0, 603, PICKUP.d0 - HAZARD_REACH_D_M - 0.05)).toBeNull();
    expect(solidHazardAt(config, 0, 702, 3)).toBeNull(); // no `solid`: data the sim never reads
    expect(hazardTop(PICKUP)).toBe(1.9);
  });

  it('head on at speed (20 m/s) is a crash, with what it was and its id; the rider never gets inside', () => {
    const r = rideInto(withHazards([PICKUP]), 20);
    const crash = r.events.find((e) => e.type === 'crash');
    expect(crash?.data).toMatchObject({ cause: 'barrier', object: 'pickup', feature: 'deck-pickup-1' });
    expect(r.trace.some(inside)).toBe(false);
  });

  it('head on at a crawl (3 m/s) only wobbles, and the rider stops short of it', () => {
    const r = rideInto(withHazards([PICKUP]), 3, 3.4, 60 * 12);
    expect(r.events.filter((e) => e.type === 'crash')).toEqual([]);
    expect(r.events.some((e) => e.type === 'wobble' && e.data['object'] === 'pickup')).toBe(true);
    expect(r.trace.some(inside)).toBe(false);
    expect(r.h.rider.pos.s).toBeLessThan(PICKUP.s0);
  });

  it('a rider steering into its side is held beside it and scrapes along, never inside', () => {
    const config = withHazards([{ ...PICKUP, s0: 600, s1: 640 }]);
    const h = riderHarness(config, { s: 605, d: 0.8, speed: 15, yaw: 0.12 });
    const events: SimEvent[] = [];
    const ds: number[] = [];
    for (let t = 0; t < 90; t++) {
      events.push(...h.step(input(0.4, 0, 0.4)));
      ds.push(h.rider.pos.d);
    }
    expect(Math.max(...ds)).toBeLessThan(PICKUP.d0 - HAZARD_REACH_D_M);
    const touch = events.find((e) => e.data['object'] === 'pickup');
    expect(touch?.type).toBe('wobble');
  });

  it('a hazard without `solid` is passed straight through, as every hazard was before', () => {
    const r = rideInto(withHazards([{ ...PICKUP, params: { object: 'pickup' } }]), 20, 3.4, 120);
    expect(r.events.filter((e) => e.type === 'crash' || e.type === 'wobble')).toEqual([]);
    expect(r.h.rider.pos.s).toBeGreaterThan(PICKUP.s1 + 10);
  });

  it('flying into it below its top is a crash; above it the bike flies over', () => {
    for (const [lift, crashes] of [
      [0.6, true],
      [4, false],
    ] as const) {
      const config = withHazards([PICKUP]);
      const h = riderHarness(config, { s: 596, d: 3.4, speed: 20 });
      const st = riderState(h.world);
      h.rider.mode = 'Airborne';
      h.rider.h = lift;
      st.yAbs[h.rider.id] = config.road.surfaceHeight(0, 596, 3.4) + lift;
      st.vy[h.rider.id] = lift > 1 ? 4 : 0;
      st.lastTick[h.rider.id] = -2;
      const events: SimEvent[] = [];
      for (let t = 0; t < 30; t++) events.push(...h.step(input(1)));
      const crash = events.find((e) => e.type === 'crash');
      if (crashes) expect(crash?.data).toMatchObject({ object: 'pickup', feature: 'deck-pickup-1' });
      else expect(crash).toBeUndefined();
    }
  });

  it('a rider put down inside one (a remount) steps out beside it, with no event', () => {
    const h = riderHarness(withHazards([PICKUP]), { s: 602, d: 3.6, speed: 0 });
    const events = h.step(input(0));
    expect(inside({ s: h.rider.pos.s, d: h.rider.pos.d })).toBe(false);
    expect(events.filter((e) => e.type === 'crash' || e.type === 'wobble')).toEqual([]);
  });
});
