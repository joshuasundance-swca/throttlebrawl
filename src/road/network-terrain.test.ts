import { describe, expect, it } from 'vitest';
import { fixtureNetwork } from './fixture';
import { createRoadNetwork } from './network';
import type { BakedTerrain } from './types';

describe('road network terrain exposure', () => {
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
