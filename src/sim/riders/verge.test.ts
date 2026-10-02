// Off-road riding (run W-R; interview, 2026-10-02: "Anywhere with ground"; off-road as "a ground band
// beside most roads (dirt, sand, grass, gravel, kerbs; water, ferns and kerbs are the real edges;
// some fences smash)", and "remove the invisible wall where ground is drawn"). The riding model on
// a straight fixture road whose verge bands the test sets: past the lanes onto the band, each
// surface's speed and grip, each edge kind's outcome, smashed fences, and the off-road query.
import { describe, expect, it } from 'vitest';
import { quantizeInput } from '../api';
import { createSimWithWorld } from '../create';
import { OFF_ROAD_PARAM, SURFACE_FEEL } from '../ground';
import { wallBand } from '../tumble/body';
import type { SimConfig, SimEvent, SimInput } from '../types';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type BakedVerge } from '../../road';
import { barrierLimits, BIKE_HALF_WIDTH_M, offRoadOf, riderLimits, riderState, vergeState } from './index';
import { input, riderHarness, STRAIGHT, TEST_BIKE, testConfig, type RiderHarness } from './testing';
import { FENCE_GAP_M, FENCE_SMASH_LOSS, FENCE_YARD_M } from './verge';

/** The fixture's lanes end at d ±4.9 (3.4 m drive lanes and 1.5 m shoulders each side). */
const LANE_EDGE = 4.9;

const band = (widthM: number, surface: BakedVerge['surface'], edge: BakedVerge['edge']): BakedVerge => ({
  widthM,
  surface,
  edge,
});

/** The straight fixture with the same verge band on both sides; off-road on unless asked. */
function vergeConfig(
  verge: BakedVerge,
  opts: { offRoad?: boolean; tuning?: Readonly<Record<string, number>>; surface?: 'gravel' } = {},
): SimConfig {
  const bundle = fixtureNetwork(STRAIGHT);
  const roads = bundle.roads.map((r) => ({
    ...r,
    ...(opts.surface ? { surface: opts.surface } : {}),
    laneSections: r.laneSections.map((sec) => ({ ...sec, verges: { left: verge, right: verge } })),
  }));
  const road = createRoadNetwork({ network: bundle.network, roads });
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 40, dir: 1 },
    finish: { road: 'a', s: 2980 },
    mainPath: ['a'],
    allowedRoads: ['a'],
    closed: false,
  });
  const base = testConfig({ tuning: { [OFF_ROAD_PARAM]: opts.offRoad === false ? 0 : 1, ...opts.tuning } });
  return { ...base, road, route };
}

/** Steps until `done` says so (or `max` ticks), collecting the events. */
function ride(h: RiderHarness, inp: SimInput, max: number, done?: (evs: SimEvent[]) => boolean): SimEvent[] {
  const all: SimEvent[] = [];
  for (let t = 0; t < max; t++) {
    const evs = h.step(inp);
    all.push(...evs);
    if (done?.(all)) break;
  }
  return all;
}

const ofType = (evs: readonly SimEvent[], type: string) => evs.filter((e) => e.type === type);

describe('off-road: past the lanes onto the ground band', () => {
  it('rides out onto the sand with no wall at the lanes, and stops at the band, with no event', () => {
    const config = vergeConfig(band(8, 'sand', 'soft'));
    const h = riderHarness(config, { s: 100, d: 2, speed: 25 });
    const evs = ride(h, input(1, 0, 1), 240);
    const hi = LANE_EDGE + 8 - BIKE_HALF_WIDTH_M;
    expect(h.rider.pos.d).toBeCloseTo(hi, 6);
    expect(h.rider.mode).toBe('Road');
    expect(ofType(evs, 'wobble')).toHaveLength(0);
    expect(ofType(evs, 'crash')).toHaveLength(0);
    console.log(`[examined] 240 ticks steering right: ended at d ${h.rider.pos.d.toFixed(2)}, 0 events`);
  });

  it('with the switch off, holds the rider at the lanes as in M1 (the wall rule)', () => {
    const config = vergeConfig(band(8, 'sand', 'soft'), { offRoad: false });
    const h = riderHarness(config, { s: 100, d: 2, speed: 25 });
    const evs = ride(h, input(1, 0, 1), 240);
    expect(h.rider.pos.d).toBeCloseTo(barrierLimits(config, 0, h.rider.pos.s).hi, 6);
    expect(ofType(evs, 'wobble').length + ofType(evs, 'crash').length).toBeGreaterThan(0);
    expect(ofType(evs, 'wobble')[0]?.data['cause'] ?? ofType(evs, 'crash')[0]?.data['cause']).toBe('barrier');
  });

  it("riderLimits are the band's edges with the switch on and exactly barrierLimits off", () => {
    const on = vergeConfig(band(6, 'dirt', 'brush'));
    const off = vergeConfig(band(6, 'dirt', 'brush'), { offRoad: false });
    const h = riderHarness(on, { s: 100, d: 0 });
    const ho = riderHarness(off, { s: 100, d: 0 });
    const lim = riderLimits(h.world, on, 0, 100);
    expect([lim.lo, lim.hi, lim.loEdge, lim.hiEdge]).toEqual([
      -(LANE_EDGE + 6) + BIKE_HALF_WIDTH_M,
      LANE_EDGE + 6 - BIKE_HALF_WIDTH_M,
      'brush',
      'brush',
    ]);
    const limOff = riderLimits(ho.world, off, 0, 100);
    expect({ lo: limOff.lo, hi: limOff.hi }).toEqual(barrierLimits(off, 0, 100));
  });
});

describe('off-road: each surface has its own speed and grip', () => {
  it('full throttle on sand settles at sand speed × top speed', () => {
    const config = vergeConfig(band(8, 'sand', 'soft'));
    const h = riderHarness(config, { s: 100, d: 9, speed: 0 });
    ride(h, input(1), 60 * 25);
    expect(h.rider.pos.d).toBeCloseTo(9, 6);
    const want = TEST_BIKE.topSpeedMps * SURFACE_FEEL.sand.speed;
    expect(h.rider.speed).toBeGreaterThan(want * 0.97);
    expect(h.rider.speed).toBeLessThan(want * 1.001);
    console.log(
      `[examined] 25 s flat out on sand: ${h.rider.speed.toFixed(2)} m/s (sand top ${want.toFixed(2)})`,
    );
  });

  it('a tuned surface speed changes it (the slider is read, not the constant)', () => {
    const config = vergeConfig(band(8, 'sand', 'soft'), { tuning: { 'ground.sand.speed': 0.9 } });
    const h = riderHarness(config, { s: 100, d: 9, speed: 0 });
    ride(h, input(1), 60 * 25);
    expect(h.rider.speed).toBeGreaterThan(TEST_BIKE.topSpeedMps * 0.9 * 0.97);
  });

  it('turns in less on loose sand than on the road at the same speed and steer', () => {
    const yawAfter = (d: number) => {
      const h = riderHarness(vergeConfig(band(8, 'sand', 'soft')), { s: 100, d, speed: 20 });
      ride(h, input(0.5, 0, 1), 10);
      return h.rider.yaw;
    };
    const road = yawAfter(0);
    const sand = yawAfter(9);
    expect(sand).toBeGreaterThan(0);
    expect(sand).toBeLessThan(road * 0.7);
  });

  it('a gravel road keeps its speed but steers looser; the gravel beside it is slower too', () => {
    const run = (surface: 'asphalt' | 'gravel', d: number, steer: number) => {
      const config = vergeConfig(band(8, 'gravel', 'soft'), surface === 'gravel' ? { surface } : {});
      const h = riderHarness(config, { s: 100, d, speed: 0 });
      ride(h, input(1, 0, steer), steer === 0 ? 60 * 25 : 10);
      return h.rider;
    };
    const top = TEST_BIKE.topSpeedMps;
    expect(run('gravel', 1.7, 0).speed).toBeGreaterThan(top * 0.97);
    expect(run('asphalt', 9, 0).speed).toBeLessThan(top * SURFACE_FEEL.gravel.speed * 1.001);
    const yawRoad = run('asphalt', 1.7, 1).yaw;
    const yawGravel = run('gravel', 1.7, 1).yaw;
    expect(yawGravel).toBeLessThan(yawRoad * 0.9);
  });

  it('feels nothing new with the switch off, even on a gravel road', () => {
    const run = (offRoad: boolean) => {
      const h = riderHarness(vergeConfig(band(8, 'sand', 'soft'), { offRoad }), { s: 100, d: 0, speed: 0 });
      ride(h, input(1, 0, 0.2), 120);
      return [h.rider.pos.s, h.rider.pos.d, h.rider.speed, h.rider.yaw];
    };
    // On the asphalt lanes the switch changes nothing at all.
    expect(run(true)).toEqual(run(false));
  });
});

describe("off-road: what a band's outer edge does", () => {
  /** Rides hard into the right edge for `ticks` from just inside the band; the speed lost and the events. */
  function into(verge: BakedVerge, ticks = 40, speed = 30) {
    const config = vergeConfig(verge);
    const h = riderHarness(config, { s: 100, d: LANE_EDGE + verge.widthM - 1.2, speed, yaw: 0.45 });
    const evs = ride(h, input(1, 0, 1), ticks);
    return { h, evs, lost: speed - h.rider.speed };
  }

  it('soft ground: no event, a little slower', () => {
    const { evs, h } = into(band(8, 'sand', 'soft'));
    expect(evs).toHaveLength(0);
    expect(h.rider.pos.d).toBeCloseTo(LANE_EDGE + 8 - BIKE_HALF_WIDTH_M, 6);
  });

  it('ferns and bushes: a wobble that never crashes, and it slows hard', () => {
    const brush = into(band(6, 'dirt', 'brush'));
    const soft = into(band(6, 'dirt', 'soft'));
    expect(ofType(brush.evs, 'crash')).toHaveLength(0);
    const w = ofType(brush.evs, 'wobble');
    expect(w).toHaveLength(1);
    expect(w[0]?.data['cause']).toBe('brush');
    expect(brush.lost).toBeGreaterThan(soft.lost + 4);
    console.log(
      `[examined] 40 ticks into the edge at 30 m/s: brush lost ${brush.lost.toFixed(1)}, soft ${soft.lost.toFixed(1)} m/s`,
    );
  });

  it('water: a splash (a wobble with cause water) that never crashes, and slows hard', () => {
    const water = into(band(3, 'grass', 'water'));
    const soft = into(band(3, 'grass', 'soft'));
    expect(ofType(water.evs, 'crash')).toHaveLength(0);
    expect(ofType(water.evs, 'wobble').map((e) => e.data['cause'])).toEqual(['water']);
    expect(water.lost).toBeGreaterThan(soft.lost + 3);
  });

  it('a building or a cliff: the M1 wall rule, a crash from the crash speed', () => {
    const { evs, h } = into(band(2.5, 'kerb', 'hard'));
    const crash = ofType(evs, 'crash');
    expect(crash).toHaveLength(1);
    expect(crash[0]?.data['cause']).toBe('barrier');
    expect(h.rider.pos.d).toBeLessThanOrEqual(LANE_EDGE + 2.5 - BIKE_HALF_WIDTH_M + 1e-9);
  });

  it('a building at a glancing touch only wobbles, as the M1 barrier', () => {
    const config = vergeConfig(band(2.5, 'kerb', 'hard'));
    const h = riderHarness(config, { s: 100, d: LANE_EDGE + 1.8, speed: 30, yaw: 0.05 });
    const evs = ride(h, input(1, 0, 0.1), 30);
    expect(ofType(evs, 'crash')).toHaveLength(0);
    expect(ofType(evs, 'wobble').map((e) => e.data['cause'])).toEqual(['barrier']);
  });
});

describe('off-road: fences smash', () => {
  it('a hard hit smashes through: boards (one event), a speed cost, and the yard behind', () => {
    const config = vergeConfig(band(6, 'gravel', 'fence'));
    const h = riderHarness(config, { s: 100, d: LANE_EDGE + 4.6, speed: 30, yaw: 0.3 });
    const evs = ride(h, input(1, 0, 0.6), 30, (all) => ofType(all, 'wobble').length > 0);
    const smash = ofType(evs, 'wobble');
    expect(smash).toHaveLength(1);
    expect(smash[0]?.data).toMatchObject({ cause: 'fence', object: 'fence', smashed: true, side: 1 });
    const before = Number(smash[0]?.data['speed']);
    expect(h.rider.speed).toBeCloseTo(before * (1 - FENCE_SMASH_LOSS), 6);
    const fence = LANE_EDGE + 6;
    // It bursts through: next ticks it is past the fence line, out in the yard.
    ride(h, input(0.5, 0, 0.3), 30);
    expect(h.rider.pos.d).toBeGreaterThan(fence);
    expect(h.rider.pos.d).toBeLessThanOrEqual(fence + FENCE_YARD_M - BIKE_HALF_WIDTH_M + 1e-9);
    expect(ofType(evs, 'crash')).toHaveLength(0);
    const gaps = vergeState(h.world).brokenFences;
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.s1 ?? 0).toBeGreaterThan((gaps[0]?.s0 ?? 0) + FENCE_GAP_M - 1e-9);
  });

  it('riding along in the yard keeps breaking the fence, so it never walls the rider back across', () => {
    const config = vergeConfig(band(6, 'gravel', 'fence'));
    const h = riderHarness(config, { s: 100, d: LANE_EDGE + 4.6, speed: 30, yaw: 0.3 });
    ride(h, input(1, 0, 0.6), 30, (all) => ofType(all, 'wobble').length > 0);
    ride(h, input(0.5, 0, 0.3), 20);
    const fence = LANE_EDGE + 6;
    expect(h.rider.pos.d).toBeGreaterThan(fence);
    const s0 = h.rider.pos.s;
    // Straight along behind the fence line for two seconds.
    for (let t = 0; t < 120; t++) {
      h.step(input(1, 0, 0));
      expect(h.rider.pos.d, `tick ${t}`).toBeGreaterThan(fence);
    }
    const gap = vergeState(h.world).brokenFences[0];
    expect(h.rider.pos.s).toBeGreaterThan(s0 + 20);
    expect(gap?.s1 ?? 0).toBeGreaterThanOrEqual(h.rider.pos.s);
  });

  it('a gentle touch holds: a scrape and a wobble that never crash, even while already wobbling', () => {
    const config = vergeConfig(band(6, 'gravel', 'fence'), { tuning: { 'riders.crashImpactMps': 2 } });
    const h = riderHarness(config, { s: 100, d: LANE_EDGE + 5, speed: 30, yaw: 0.06 });
    riderState(h.world).wobble[h.rider.id] = 30;
    const evs = ride(h, input(1, 0, 0.15), 90);
    expect(ofType(evs, 'crash')).toHaveLength(0);
    expect(vergeState(h.world).brokenFences).toHaveLength(0);
    expect(h.rider.pos.d).toBeLessThanOrEqual(LANE_EDGE + 6 - BIKE_HALF_WIDTH_M + 1e-9);
  });

  it('a smashed stretch stays open for the next rider', () => {
    const config = vergeConfig(band(6, 'gravel', 'fence'));
    const h = riderHarness(config, { s: 100, d: LANE_EDGE + 4.6, speed: 30, yaw: 0.3 });
    ride(h, input(1, 0, 0.6), 30, (all) => ofType(all, 'wobble').length > 0);
    const gap = vergeState(h.world).brokenFences[0];
    if (!gap) throw new Error('no gap');
    const mid = (gap.s0 + gap.s1) / 2;
    const lim = riderLimits(h.world, config, 0, mid);
    expect(lim.hiEdge).toBe('soft');
    expect(lim.hi).toBeCloseTo(LANE_EDGE + 6 + FENCE_YARD_M - BIKE_HALF_WIDTH_M, 9);
    // Away from the gap, and on the other side, the fence stands.
    expect(riderLimits(h.world, config, 0, gap.s1 + 20).hiEdge).toBe('fence');
    expect(riderLimits(h.world, config, 0, mid).loEdge).toBe('fence');
  });
});

describe('off-road: the heat meter query', () => {
  it('is true on loose ground (a dirt, gravel, sand or grass band), false on the road, shoulder and kerb', () => {
    const at = (verge: BakedVerge, d: number) => {
      const h = riderHarness(vergeConfig(verge), { s: 100, d });
      return offRoadOf(h.config, h.rider);
    };
    expect(at(band(8, 'sand', 'soft'), 8)).toBe(true);
    expect(at(band(6, 'dirt', 'brush'), -8)).toBe(true);
    expect(at(band(3, 'grass', 'water'), 6)).toBe(true);
    expect(at(band(6, 'gravel', 'fence'), 7)).toBe(true);
    expect(at(band(8, 'sand', 'soft'), 0)).toBe(false);
    expect(at(band(8, 'sand', 'soft'), 4.15)).toBe(false);
    expect(at(band(2.5, 'kerb', 'hard'), 6)).toBe(false);
  });
});

describe('off-road: a crash on the verge tumbles on the verge', () => {
  it("the tumble's wall is the band's edge with the switch on, the lanes' with it off", () => {
    const { road } = vergeConfig(band(8, 'sand', 'soft'));
    expect(wallBand(road, 0)).toEqual(wallBand(road, 0, 100, false));
    const on = wallBand(road, 0, 100, true);
    expect(on.hi).toBeCloseTo(LANE_EDGE + 8 - 0.35, 9);
    expect(on.lo).toBeCloseTo(-(LANE_EDGE + 8) + 0.35, 9);
  });

  it('a rider who crashes into a building front from the verge is not thrown back onto the road', () => {
    const config = vergeConfig(band(6, 'kerb', 'hard'), { tuning: { 'riders.crashImpactMps': 3 } });
    const { sim, world } = createSimWithWorld(config);
    const me = world.movers.find((m) => m.kind === 'rider');
    if (!me) throw new Error('no rider');
    me.pos.d = LANE_EDGE + 3;
    me.speed = 25;
    let tumbled = 0;
    let minD = Infinity;
    for (let t = 0; t < 240; t++) {
      sim.step([quantizeInput({ throttle: 1, brake: 0, steer: tumbled > 0 ? 0 : 1, flags: 0 })]);
      if (me.mode === 'Tumble') {
        tumbled++;
        minD = Math.min(minD, me.pos.d);
      }
    }
    expect(tumbled).toBeGreaterThan(10);
    // The old wall at the lanes would have put it at 4.55 at once.
    expect(minD).toBeGreaterThan(LANE_EDGE + 1);
    console.log(`[examined] ${tumbled} tumble ticks on the verge: nearest the road d ${minD.toFixed(2)}`);
  });
});
