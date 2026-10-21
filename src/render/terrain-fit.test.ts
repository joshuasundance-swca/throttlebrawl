import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork, terrainAt, type BakedTerrain } from '../road';
import { fitTerrain } from './terrain-fit';

function source(terrain?: BakedTerrain, grade = 0) {
  const b = fixtureNetwork([{ id: 'road', lengthM: 200, kappa: 0, grade }]);
  return createRoadNetwork({ ...b, network: { ...b.network, ...(terrain ? { terrain } : {}) } });
}

const slope = (x0 = 10, x1 = 40): BakedTerrain => ({
  patches: [
    {
      surface: 'grass',
      vertices: [
        [x0, x0 * 0.2, -150],
        [x0, x0 * 0.2, -50],
        [x1, x1 * 0.2, -150],
        [x1, x1 * 0.2, -50],
      ],
      triangles: [
        [0, 1, 2],
        [2, 1, 3],
      ],
    },
  ],
});

describe('terrain mark fitting', () => {
  it('uses the exact Float32 source height and normal above or below the reference road', () => {
    for (const height of [-10.1234567, 10.1234567]) {
      const terrain = slope();
      const moved: BakedTerrain = {
        patches: terrain.patches.map((p) => ({
          ...p,
          vertices: p.vertices.map(([x, y, z]) => [x, y + height, z]),
        })),
      };
      const r = source(moved);
      const hit = terrainAt(r.terrain, 20, -100)!;
      const fit = fitTerrain(r, 20, hit.y, -100)!;
      expect(fit.y).toBe(hit.y);
      expect([fit.nx, fit.ny, fit.nz]).toEqual([hit.normal.x, hit.normal.y, hit.normal.z]);
    }
  });

  it('keeps actual road and shoulder priority, but an overhead road cannot hide land underneath', () => {
    const terrain = slope(-20, 40);
    const r = source(terrain);
    expect(fitTerrain(r, 0, 0, -100)).toBeUndefined();
    expect(fitTerrain(r, -4.8, 0, -100)).toBeUndefined();
    const elevated = source(terrain, 0.1);
    expect(fitTerrain(elevated, 0, 0, -100)?.ny).toBeCloseTo(1 / Math.sqrt(1.04), 8);
    expect(fitTerrain(elevated, 0, 10, -100)).toBeUndefined();
  });

  it('shrinks a mark at coverage edges and draws none when its smallest footprint would overhang', () => {
    const r = source(slope());
    expect(fitTerrain(r, 10.8, 2.16, -100, 0, 2, 2)?.scale).toBeLessThan(1);
    expect(fitTerrain(r, 10.1, 2.02, -100, 0, 2, 2)).toBeNull();
    expect(fitTerrain(r, 9, 2, -100)).toBeNull();
    expect(fitTerrain(r, 20, 0, -100)).toBeNull();
    expect(fitTerrain(null, 20, 4, -100)).toBeUndefined();
    expect(fitTerrain(source(), 20, 4, -100)).toBeUndefined();
  });

  it('never replaces a missing land face with a water face or an endpoint-clamped road', () => {
    const terrain = slope(-20, 40);
    const water: BakedTerrain = {
      patches: terrain.patches.map((p) => ({
        ...p,
        surface: 'water',
        vertices: p.vertices.map(([x, , z]) => [x, 4, z]),
      })),
    };
    expect(fitTerrain(source(water), 20, 4, -100)).toBeNull();
    expect(fitTerrain(source(slope(-20, 40)), 0, 0, 10)).toBeNull();
  });
});
