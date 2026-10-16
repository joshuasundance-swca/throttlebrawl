import { describe, expect, it } from 'vitest';
import { beyondAt } from './beyond';
import { groundUnderOf, landEdgeOf, landReachOf, sectionGroundOf, shelfOf, skirtOf } from './drawn-ground';
import { fixtureNetwork } from './fixture';
import { DRAWN_VERGE_M } from './furniture';
import { createRoadNetwork } from './network';
import { terrainAt } from './terrain';
import type { BakedFeature, BakedTerrain, BakedTerrainPatch } from './types';
import { lakeWaterAt, waterAt } from './water';

function rectangle(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  surface: BakedTerrainPatch['surface'] = 'grass',
): BakedTerrainPatch {
  return {
    surface,
    vertices: [
      [x0, y, z0],
      [x0, y, z1],
      [x1, y, z0],
      [x1, y, z1],
    ],
    triangles: [
      [0, 1, 2],
      [2, 1, 3],
    ],
  };
}

function fixture(
  terrain?: BakedTerrain,
  features: readonly BakedFeature[] = [],
  id = 'authored-fixture',
  tag = 'forest',
) {
  const bundle = fixtureNetwork([{ id: 'road', lengthM: 120, kappa: 0 }], id);
  return createRoadNetwork({
    ...bundle,
    network: { ...bundle.network, ...(terrain ? { terrain } : {}) },
    roads: bundle.roads.map((r) => ({
      ...r,
      tags: [{ s0: 0, s1: 120, side: 'both', tag }],
      barriers: [],
      features,
    })),
  });
}

function beside(road: ReturnType<typeof fixture>, x: number, s = 60) {
  const from = road.vergeAt(0, s, 'right').dOuter;
  return beyondAt(road, 0, s, 'right', x - from);
}

describe('authored ground query opt-in', () => {
  it('keeps legacy ground and water controls when terrain is omitted and disables synthetic strips for authored terrain', () => {
    const legacy = fixture();
    expect(landReachOf(legacy)(0, 1, 60)).toBeGreaterThan(0);
    expect(landEdgeOf(legacy)(0, 1, 60)).toBeGreaterThan(0);
    expect(skirtOf(legacy)(0, 1, 60)).not.toBeNull();
    expect(shelfOf(fixture(undefined, [], 'legacy-shelf', 'palms'))(0, 1, 60)).not.toBeNull();
    expect(sectionGroundOf(legacy)(0, 60, 12)).not.toBeNull();
    const empty = fixture({ patches: [] });
    expect(landReachOf(empty)(0, 1, 60)).toBe(0);
    expect(landEdgeOf(empty)(0, 1, 60)).toBe(0);
    expect(landEdgeOf(empty, 4)(0, 1, 60)).toBe(0);
    expect(skirtOf(empty)(0, 1, 60)).toBeNull();
    expect(shelfOf(empty)(0, 1, 60)).toBeNull();
    expect(sectionGroundOf(empty)(0, 60, 12)).toBeNull();
    expect(groundUnderOf(empty)(12, -60, Infinity)).toBeNull();
  });

  it('keeps position-aware legacy lake semantics but uses exact authored water levels and dry holes', () => {
    const legacy = fixture(undefined, [], 'osm-pnw-samish');
    expect(lakeWaterAt(legacy.id, -1000, -650)).not.toBeNull();
    expect(waterAt(legacy, -1000, -650)).toBe(lakeWaterAt(legacy.id, -1000, -650));
    expect(waterAt(legacy, 5000, 5000)).toBe(0);
    const road = fixture(
      { patches: [rectangle(10, -120, 30, -70, 4.1, 'water'), rectangle(10, -50, 30, 0, 9.2, 'water')] },
      [],
      'osm-pnw-samish',
    );
    expect(waterAt(road, 20, -90)).toBe(Math.fround(4.1));
    expect(waterAt(road, 20, -30)).toBe(Math.fround(9.2));
    expect(waterAt(road, 20, -60)).toBeNull();
    expect(waterAt(road, -1000, -650)).toBeNull();
    expect(waterAt(road, 20, -90, 4)).toBeNull();
  });

  it('uses actual Float32 source slopes at off-road points and far outside the nearby-road grid', () => {
    const terrain: BakedTerrain = {
      patches: [
        {
          surface: 'dirt',
          vertices: [
            [10, 2.1, -120],
            [10, 4.2, 0],
            [40, 6.3, -120],
            [40, 9.4, 0],
          ],
          triangles: [
            [0, 1, 2],
            [2, 1, 3],
          ],
        },
        rectangle(10000, 10000, 10020, 10020, 12.3),
      ],
    };
    const road = fixture(terrain);
    for (const [x, z] of [
      [13, -90],
      [25, -60],
      [38, -10],
    ]) {
      const point = road.toWorld(0, -z!, x!, 0);
      const expected = terrainAt(terrain, point.x, point.z)!.y;
      expect(sectionGroundOf(road)(0, -z!, x!)).toBe(expected);
      expect(groundUnderOf(road)(point.x, point.z, Infinity, { edge: 0, s: -z! })).toBe(expected);
      expect(beside(road, x!, -z!)).toEqual({ past: 'ground', floorY: expected });
      expect(sectionGroundOf(road)(0, -z!, x!, { x: x!, z: z! })).toBe(terrainAt(terrain, x!, z!)!.y);
    }
    expect(groundUnderOf(road)(10010, 10010, Infinity)).toBe(Math.fround(12.3));
  });

  it('chooses the highest eligible real road or source land without allowing an upper face to mask a lower floor', () => {
    const road = fixture({ patches: [rectangle(-8, -120, 8, 0, -2.1), rectangle(-8, -120, 8, 0, 3.2)] });
    const under = groundUnderOf(road);
    expect(sectionGroundOf(road)(0, 60, 0)).toBe(Math.fround(3.2));
    expect(under(0, -60, Infinity)).toBe(Math.fround(3.2));
    expect(under(0, -60, 1)).toBe(0);
    expect(under(0, -60, -1)).toBe(Math.fround(-2.1));
    expect(under(0, -60, 1, { edge: 0, s: 60 })).toBe(Math.fround(-2.1));
    expect(under(0, -60, -3)).toBeNull();
    const lower = fixture({ patches: [rectangle(-8, -120, 8, 0, -2.1)] });
    expect(sectionGroundOf(lower)(0, 60, 0)).toBe(0);
  });

  it('retains actual road and drawn shoulder coverage but not a gap or an invented roadside-zone floor', () => {
    const features: BakedFeature[] = [
      { id: 'missing-deck', kind: 'gap', s0: 50, s1: 70, d0: -5, d1: 5 },
      { id: 'zone', kind: 'roadsideZone', s0: 10, s1: 30, d0: 5, d1: 9 },
    ];
    const road = fixture({ patches: [] }, features);
    const section = sectionGroundOf(road);
    const edge = road.edges[0]!;
    expect(section(0, 40, 0)).toBe(0);
    expect(section(0, 40, edge.dMax + DRAWN_VERGE_M - 0.01)).toBe(0);
    expect(section(0, 40, edge.dMax + DRAWN_VERGE_M + 0.01)).toBeNull();
    expect(section(0, 60, 0)).toBeNull();
    expect(section(0, 20, 10)).toBeNull();
    expect(groundUnderOf(road)(10, -20, Infinity)).toBeNull();
    const groundBelowGap = fixture({ patches: [rectangle(-8, -120, 8, 0, -4.2)] }, features);
    expect(sectionGroundOf(groundBelowGap)(0, 60, 0)).toBe(Math.fround(-4.2));
    expect(groundUnderOf(groundBelowGap)(0, -60, Infinity)).toBe(Math.fround(-4.2));
  });

  it('reports source water at its own height, a source land island, and a dry hole regardless of old water tags', () => {
    const bundle = fixtureNetwork([{ id: 'road', lengthM: 120, kappa: 0 }]);
    const road = createRoadNetwork({
      ...bundle,
      network: {
        ...bundle.network,
        terrain: {
          patches: [
            rectangle(10, -120, 30, -80, 4.1, 'water'),
            rectangle(10, -40, 30, 0, 9.2, 'water'),
            rectangle(10, -70, 30, -50, 2.3),
          ],
        },
      },
      roads: bundle.roads.map((r) => ({ ...r, tags: [{ s0: 0, s1: 120, side: 'both', tag: 'water-open' }] })),
    });
    expect(beside(road, 20, 100)).toEqual({ past: 'water', floorY: Math.fround(4.1) });
    expect(beside(road, 20, 20)).toEqual({ past: 'water', floorY: Math.fround(9.2) });
    expect(beside(road, 20, 60)).toEqual({ past: 'ground', floorY: Math.fround(2.3) });
    expect(beside(road, 20, 75)).toEqual({ past: 'drop', floorY: 0 });
    expect(sectionGroundOf(road)(0, 100, 20)).toBeNull();
    expect(groundUnderOf(road)(20, -100, Infinity)).toBeNull();
  });

  it('keeps a real neighboring road in an authored coverage hole and respects its missing span', () => {
    const a = fixtureNetwork([{ id: 'a', lengthM: 120, kappa: 0 }]);
    const b = fixtureNetwork([{ id: 'b', lengthM: 120, kappa: 0 }]);
    const second = b.roads[0]!;
    const road = createRoadNetwork({
      network: {
        ...a.network,
        terrain: { patches: [] },
        roads: ['a', 'b'],
        junctions: [
          ...a.network.junctions,
          ...b.network.junctions.map((j) => ({ ...j, id: `b-${j.id}`, x: j.x + 20, y: j.y + 2 })),
        ],
      },
      roads: [
        a.roads[0]!,
        {
          ...second,
          from: `b-${second.from}`,
          to: `b-${second.to}`,
          samples: {
            ...second.samples,
            data: {
              ...second.samples.data,
              x: second.samples.data['x']!.map((x) => x + 20),
              y: second.samples.data['y']!.map((y) => y + 2),
            },
          },
          features: [{ id: 'missing-neighbor-deck', kind: 'gap', s0: 70, s1: 90, d0: -5, d1: 5 }],
        },
      ],
    });
    expect(groundUnderOf(road)(20, -60, Infinity, { edge: 0, s: 60 })).toBe(2);
    expect(beside(road, 20, 60)).toEqual({ past: 'ground', floorY: 2 });
    expect(groundUnderOf(road)(20, -80, Infinity, { edge: 0, s: 80 })).toBeNull();
    expect(beside(road, 20, 80)).toEqual({ past: 'drop', floorY: 0 });
  });
});
