import { describe, expect, it, vi } from 'vitest';
import { groundUnderOf, uncachedGroundUnderOf } from './drawn-ground';
import { fixtureNetwork } from './fixture';
import { createRoadNetwork, type RoadNetwork } from './network';
import type { BakedTerrain, BakedTerrainPatch } from './types';

function patch(y: number, surface: BakedTerrainPatch['surface'] = 'grass'): BakedTerrainPatch {
  return {
    surface,
    vertices: [
      [-40, y, -160],
      [-40, y, 0],
      [40, y, -160],
      [40, y, 0],
    ],
    triangles: [
      [0, 1, 2],
      [2, 1, 3],
    ],
  };
}

function fixture(curved = false, terrain?: BakedTerrain, gap = false) {
  const bundle = fixtureNetwork([
    { id: 'a', lengthM: 160, kappa: curved ? 1 / 160 : 0, grade: curved ? 0.01 : 0 },
  ]);
  return createRoadNetwork({
    ...bundle,
    network: { ...bundle.network, ...(terrain ? { terrain } : {}) },
    roads: bundle.roads.map((r) => ({
      ...r,
      barriers: [],
      tags: [{ s0: 0, s1: 160, tag: 'row-houses', side: 'both' as const }],
      features: [
        { kind: 'roadsideZone' as const, id: 'people', s0: 40, s1: 100, d0: 6, d1: 9 },
        ...(gap ? [{ kind: 'gap' as const, id: 'hole', s0: 50, s1: 70, d0: -5, d1: 5 }] : []),
      ],
    })),
  });
}

function compare(road: RoadNetwork) {
  const cached = groundUnderOf(road),
    direct = uncachedGroundUnderOf(road);
  let supported = 0,
    missing = 0;
  for (const s of [0, 31.999, 64, 80, 159.9])
    for (const d of [-35, -6, 0, 7, 30]) {
      const point = road.toWorld(0, s, d, 0);
      for (const top of [-Infinity, -1, 0, 3, Infinity, NaN])
        for (const own of [undefined, { edge: 0, s }, { edge: 0, s: s + 3 }]) {
          const expected = cached(point.x, point.z, top, own);
          expect(Object.is(direct(point.x, point.z, top, own), expected)).toBe(true);
          // Interleaving another point and warming either path cannot affect this result.
          direct(point.x + 0.25, point.z - 0.25, top, own);
          expect(Object.is(direct(point.x, point.z, top, own), expected)).toBe(true);
          if (expected === null) missing++;
          else supported++;
        }
    }
  expect(supported).toBeGreaterThan(0);
  expect(missing).toBeGreaterThan(0);
}

describe('uncached physical ground query', () => {
  it('retains exact legacy answers on straight and curved ground across ceilings, own sections and cell boundaries', () => {
    compare(fixture());
    compare(fixture(true));
  });

  it('retains source terrain, water filtering, stacked floors, empty support and gaps', () => {
    const terrain = { patches: [patch(-2.1), patch(3.2), patch(7, 'water')] };
    const road = fixture(false, terrain, true),
      direct = uncachedGroundUnderOf(road);
    compare(road);
    compare(fixture(false, { patches: [] }, true));
    expect(direct(0, -40, 1)).toBe(0);
    expect(direct(0, -40, -1)).toBe(Math.fround(-2.1));
    expect(direct(0, -60, 1)).toBe(Math.fround(-2.1));
    expect(direct(0, -40, Infinity)).toBe(Math.fround(3.2));
    expect(direct(0, -40, -3)).toBeNull();
  });

  it('keeps signed-zero and nonfinite queries equivalent after opposite-sign warming', () => {
    const road = fixture(false, { patches: [patch(-0)] });
    const cached = groundUnderOf(road),
      direct = uncachedGroundUnderOf(road);
    for (const x of [0, -0, Infinity, -Infinity, NaN])
      for (const z of [-0, 0, -40, Infinity, NaN]) {
        cached(-x, -z, Infinity);
        for (const top of [0, -0, Infinity, -Infinity, NaN])
          expect(Object.is(direct(x, z, top), cached(x, z, top))).toBe(true);
      }
  });

  it('keeps reducers local when a nested query occurs during projection', () => {
    const road = fixture(true),
      cached = groundUnderOf(road),
      direct = uncachedGroundUnderOf(road);
    const p = road.toWorld(0, 80, 7, 0),
      expected = cached(p.x, p.z, Infinity);
    const frame = road.frameAt.bind(road);
    let nested = false;
    const spy = vi.spyOn(road, 'frameAt').mockImplementation((...args) => {
      if (!nested) {
        nested = true;
        direct(p.x + 20, p.z + 20, -1);
      }
      return frame(...args);
    });
    try {
      expect(Object.is(direct(p.x, p.z, Infinity), expected)).toBe(true);
      expect(nested).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
