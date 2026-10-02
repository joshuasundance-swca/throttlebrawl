import { describe, expect, it } from 'vitest';
import { GROUND_SURFACES } from '../core';
import { createRoadNetwork, createRouteProgress, fixtureBranchNetwork } from '../road';
import { createSimWithWorld, SIM_TUNING } from './create';
import {
  GROUND_TUNING,
  groundUnder,
  gripParam,
  OFF_ROAD_PARAM,
  rideLimits,
  speedParam,
  SURFACE_FEEL,
  surfaceFeel,
} from './ground';
import { barrierLimits, BIKE_HALF_WIDTH_M } from './riders';
import { testConfig } from './riders/testing';

// W-Q contracts (interview, 2026-10-02: "Anywhere with ground", "U-turns", "junction choices in
// races"): the ground's tuning, the limits a rider may ride to (off by default: exactly the lanes,
// as since M1), the ground under the wheels, and the snapshot's ground, heading sign and branch.

function branchConfig(surface?: 'dirt') {
  const f = fixtureBranchNetwork();
  const roads = f.roads.map((r) => (r.id === 'cut' && surface ? { ...r, surface } : r));
  const road = createRoadNetwork({ network: f.network, roads });
  const route = createRouteProgress(road, f.route);
  return { ...testConfig({ rivals: 1 }), road, route };
}

describe('ground tuning', () => {
  it('declares the off-road switch (off) and a grip and a speed for every surface, all in SIM_TUNING', () => {
    const ids = new Set(SIM_TUNING.map((d) => d.id));
    const off = GROUND_TUNING.find((d) => d.id === OFF_ROAD_PARAM);
    expect(off).toMatchObject({ default: 0, min: 0, max: 1, step: 1, affectsSim: true });
    for (const g of GROUND_SURFACES) {
      const grip = GROUND_TUNING.find((d) => d.id === gripParam(g));
      const speed = GROUND_TUNING.find((d) => d.id === speedParam(g));
      expect(grip?.default).toBe(SURFACE_FEEL[g].grip);
      expect(speed?.default).toBe(SURFACE_FEEL[g].speed);
    }
    expect(GROUND_TUNING).toHaveLength(1 + 2 * GROUND_SURFACES.length);
    for (const d of GROUND_TUNING) {
      expect(ids.has(d.id), d.id).toBe(true);
      expect(d.affectsSim).toBe(true);
    }
    expect(SURFACE_FEEL.asphalt).toEqual({ grip: 1, speed: 1 });
  });

  it('reads the race tuning for a surface, falls back to the defaults, and is 1 in the air', () => {
    expect(surfaceFeel({}, 'sand')).toEqual(SURFACE_FEEL.sand);
    expect(surfaceFeel({ [gripParam('sand')]: 0.4 }, 'sand')).toEqual({
      grip: 0.4,
      speed: SURFACE_FEEL.sand.speed,
    });
    expect(surfaceFeel({}, null)).toEqual({ grip: 1, speed: 1 });
  });
});

describe('ride limits', () => {
  it("with the switch off, are exactly the riders' M1 barrier limits, everywhere on the track", () => {
    const config = branchConfig();
    let n = 0;
    for (const e of config.road.edges) {
      for (let s = 0; s <= e.length; s += 5) {
        const off = rideLimits(config.road, {}, e.index, s, BIKE_HALF_WIDTH_M);
        expect({ lo: off.lo, hi: off.hi }).toEqual(barrierLimits(config, e.index, s));
        expect([off.loEdge, off.hiEdge, off.loBandM, off.hiBandM]).toEqual(['hard', 'hard', 0, 0]);
        n++;
      }
    }
    expect(n).toBeGreaterThan(200);
    console.log(`[examined] ${n} stations: switch off equals barrierLimits`);
  });

  it("with the switch on, run out to each verge band's outer edge, with its edge kind", () => {
    const config = branchConfig();
    const a = config.road.edgeIndex('a');
    const on = rideLimits(config.road, { [OFF_ROAD_PARAM]: 1 }, a, 50, BIKE_HALF_WIDTH_M);
    const off = rideLimits(config.road, {}, a, 50, BIKE_HALF_WIDTH_M);
    const left = config.road.vergeAt(a, 50, 'left');
    const right = config.road.vergeAt(a, 50, 'right');
    expect(on).toEqual({
      lo: left.dOuter + BIKE_HALF_WIDTH_M,
      hi: right.dOuter - BIKE_HALF_WIDTH_M,
      loEdge: left.edge,
      hiEdge: right.edge,
      loBandM: left.widthM,
      hiBandM: right.widthM,
    });
    // The untagged fixture is palm land: an 8 m sand band each side that just runs on.
    expect(on.lo).toBeCloseTo(off.lo - 8, 9);
    expect(on.hi).toBeCloseTo(off.hi + 8, 9);
    expect(on.hiEdge).toBe('soft');
  });
});

describe('the ground under the wheels', () => {
  it('is the road surface on the lanes, the band past them, nothing past the band or in the air', () => {
    const { road } = branchConfig('dirt');
    const a = road.edgeIndex('a');
    const cut = road.edgeIndex('cut');
    const right = road.vergeAt(a, 50, 'right');
    expect(groundUnder(road, a, 50, 0, 0)).toBe('asphalt');
    expect(groundUnder(road, cut, 50, 0, 0)).toBe('dirt');
    expect(groundUnder(road, a, 50, right.dInner + 1, 0)).toBe('sand');
    expect(groundUnder(road, a, 50, right.dOuter + 1, 0)).toBeNull();
    expect(groundUnder(road, a, 50, 0, 0.5)).toBeNull();
  });
});

describe('the snapshot fields', () => {
  it('fill ground, heading sign and branch for riders: on the grid, on the dirt cut, and turned round', () => {
    const config = branchConfig('dirt');
    const { sim, world } = createSimWithWorld(config);
    const riders = () => sim.snapshot().entities.filter((e) => e.kind === 'rider');
    for (const r of riders()) {
      expect(r.ground === 'asphalt' || r.ground === 'shoulder').toBe(true);
      expect(r.routeDir).toBe(1);
      expect(r.branch).toBeNull();
    }
    const m = world.movers.find((x) => x.kind === 'rider');
    if (!m) throw new Error('no rider');
    m.pos.edge = config.road.edgeIndex('cut');
    m.pos.s = 40;
    m.pos.d = 0;
    let me = riders().find((r) => r.id === m.id);
    expect([me?.ground, me?.routeDir, me?.branch]).toEqual(['dirt', 1, 'cut']);
    // A U-turn: the same edge, travelling against the route.
    m.pos.dir = -1;
    me = riders().find((r) => r.id === m.id);
    expect(me?.routeDir).toBe(-1);
  });
});
