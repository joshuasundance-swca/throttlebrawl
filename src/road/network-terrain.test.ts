import { describe, expect, it } from 'vitest';
import { fixtureNetwork } from './fixture';
import { createRoadNetwork } from './network';
import type { BakedTerrain } from './types';
import { courseAt, roadBandHeight } from './course';
import { DRAWN_VERGE_M } from './furniture';

describe('road network terrain exposure', () => {
  it('supports the drawn traffic fill out to its outer edge without inventing ground beyond it', () => {
    const bundle = fixtureNetwork([{ id: 'road', lengthM: 100, kappa: 0 }]);
    const road = createRoadNetwork({ ...bundle, network: { ...bundle.network, terrain: { patches: [] } } });
    const edge = road.edges[0]!;
    edge.isTrafficOnly = true;
    for (const side of [-1, 1] as const) {
      const outer = side < 0 ? edge.dMin - DRAWN_VERGE_M : edge.dMax + DRAWN_VERGE_M;
      expect(roadBandHeight(road, 0, 30, outer - side * 0.1)).toBe(0);
      expect(roadBandHeight(road, 0, 30, outer + side * 0.1)).toBeNull();
    }
  });

  it('does not invent a solid road across a missing span of an authored network', () => {
    const bundle = fixtureNetwork([{ id: 'road', lengthM: 100, kappa: 0 }]);
    const road = createRoadNetwork({
      network: { ...bundle.network, terrain: { patches: [] } },
      roads: bundle.roads.map((r) => ({
        ...r,
        features: [{ id: 'hole', kind: 'gap' as const, s0: 40, s1: 60, d0: -5, d1: 5 }],
      })),
    });
    const plan = { items: [], cellM: 32, cells: new Map() };
    expect(roadBandHeight(road, 0, 30, 0)).toBe(0);
    expect(courseAt(road, plan, { edge: 0, s: 30, d: 0 }, 0).kind).toBe('road');
    expect(roadBandHeight(road, 0, 50, 0)).toBeNull();
    expect(courseAt(road, plan, { edge: 0, s: 50, d: 0 }, 0).kind).toBe('out');
  });

  it('retains exact readonly authored data without independently rounding or copying it', () => {
    const bundle = fixtureNetwork([{ id: 'road', lengthM: 100, kappa: 0 }]);
    const terrain: BakedTerrain = {
      patches: [
        {
          surface: 'grass',
          vertices: [
            [0, 2, 0],
            [0, 3.1, 10],
            [10, 4, 0],
          ],
          triangles: [[0, 1, 2]],
        },
      ],
    };
    const road = createRoadNetwork({ ...bundle, network: { ...bundle.network, terrain } });
    expect(road.terrain).toBe(terrain);
    expect(road.terrain?.patches[0]?.vertices[1]?.[1]).toBe(3.1);
    expect(road.terrain?.patches[0]?.vertices[1]?.[1]).not.toBe(Math.fround(3.1));
  });

  it('adds no terrain property when the baked network omits coverage', () => {
    const road = createRoadNetwork(fixtureNetwork([{ id: 'road', lengthM: 100, kappa: 0 }]));
    expect(road.terrain).toBeUndefined();
    expect(road).not.toHaveProperty('terrain');
  });
});
