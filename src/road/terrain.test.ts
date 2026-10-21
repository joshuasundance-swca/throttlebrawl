import { describe, expect, it } from 'vitest';
import { terrainAt } from './terrain';
import type { BakedTerrain, BakedTerrainPatch } from './types';

const slope = (): BakedTerrainPatch => ({
  surface: 'grass',
  vertices: [
    [0, 0, 0],
    [0, 0, 10],
    [10, 5, 0],
    [10, 5, 10],
  ],
  triangles: [
    [0, 1, 2],
    [2, 1, 3],
  ],
});

function rectangle(x0: number, z0: number, x1: number, z1: number, y = 2): BakedTerrainPatch {
  return {
    surface: 'water',
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

describe('authored physical terrain faces', () => {
  it('refuses a direct source whose face collapses at rendered precision instead of returning a non-finite floor', () => {
    const terrain: BakedTerrain = {
      patches: [
        {
          surface: 'grass',
          vertices: [
            [1e8, 2, 0],
            [1e8, 3, 1],
            [1e8 + 1, 4, 0],
          ],
          triangles: [[0, 1, 2]],
        },
      ],
    };
    expect(() => terrainAt(terrain, 1e8, 0)).toThrow(RangeError);
    expect(terrainAt({ patches: [slope()] }, 4, 3)?.y).toBe(2);
  });

  it('samples the actual sloped face height and upward normal, including its shared diagonal', () => {
    const terrain = { patches: [slope()] };
    for (const [x, z] of [
      [4, 3],
      [4, 6],
      [4, 8],
    ]) {
      const hit = terrainAt(terrain, x!, z!);
      expect(hit).not.toBeNull();
      expect(hit!.y).toBeCloseTo(2, 10);
      expect(hit!.dyDx).toBeCloseTo(0.5, 10);
      expect(hit!.dyDz).toBeCloseTo(0, 10);
      expect(hit!.normal.x).toBeCloseTo(-1 / Math.sqrt(5), 10);
      expect(hit!.normal.y).toBeCloseTo(2 / Math.sqrt(5), 10);
      expect(hit!.normal.z).toBeCloseTo(0, 10);
      expect(hit!.surface).toBe('grass');
    }
    expect(terrainAt(terrain, 4, 3, 1.99)).toBeNull();
    expect(terrainAt(terrain, -0.01, 3)).toBeNull();
  });

  it('has no invented surface across water holes, outside coverage or absent terrain', () => {
    const terrain = {
      patches: [
        rectangle(-3, -3, 3, -1),
        rectangle(-3, 1, 3, 3),
        rectangle(-3, -1, -1, 1),
        rectangle(1, -1, 3, 1),
      ],
    };
    for (const [x, z] of [
      [-2, 0],
      [2, 0],
      [0, -2],
      [0, 2],
      [-1, 0],
    ]) {
      expect(terrainAt(terrain, x!, z!)?.surface).toBe('water');
    }
    expect(terrainAt(terrain, 0, 0)).toBeNull();
    expect(terrainAt(terrain, 4, 0)).toBeNull();
    expect(terrainAt(undefined, 0, 0)).toBeNull();
    expect(terrainAt({ patches: [] }, 0, 0)).toBeNull();
  });

  it('selects height and surface independently, with stable authored order on ties', () => {
    const terrain = { patches: [slope(), rectangle(0, 0, 10, 10), rectangle(0, 0, 10, 10, 4)] };
    expect(terrainAt(terrain, 2, 2)?.y).toBe(4);
    expect(terrainAt(terrain, 2, 2, 3)?.y).toBe(2);
    expect(terrainAt(terrain, 2, 2, Infinity, 'land')?.y).toBe(1);
    expect(terrainAt(terrain, 2, 2, Infinity, 'water')?.y).toBe(4);
    expect(terrainAt(terrain, 4, 3, 3)?.patch).toBe(0);
    expect(terrainAt({ patches: [slope()] }, 4, 3, Infinity, 'water')).toBeNull();
  });

  it('uses rendered Float32 vertices, and cache warm-up never mutates data or changes a result', () => {
    const terrain: BakedTerrain = {
      patches: [
        {
          surface: 'grass',
          vertices: [
            [0, 2.0000001, 0],
            [0, 2.0000001, 10],
            [10, 2.0000001, 0],
          ],
          triangles: [[0, 1, 2]],
        },
      ],
    };
    const before = JSON.stringify(terrain);
    const cold = terrainAt(terrain, 2, 2);
    expect(cold?.y).toBe(Math.fround(2.0000001));
    for (const [x, z] of [
      [9, 9],
      [0, 0],
      [3, 2],
      [2, 2],
    ])
      terrainAt(terrain, x!, z!);
    expect(terrainAt(terrain, 2, 2)).toEqual(cold);
    expect(terrainAt(structuredClone(terrain), 2, 2)).toEqual(cold);
    expect(JSON.stringify(terrain)).toBe(before);
  });

  it('handles geographically large faces without a world-sized cell allocation', () => {
    const terrain = { patches: [rectangle(-1e8, -1e8, 1e8, 1e8)] };
    expect(terrainAt(terrain, 0, 0)?.y).toBe(2);
    expect(terrainAt(terrain, 1e8 + 100, 0)).toBeNull();
  });

  it('keeps separated terrain areas and their gaps distinct in a larger scene', () => {
    const patches = [-60, -20, 20, 60].flatMap((z) =>
      [-60, -20, 20, 60].map((x) => rectangle(x, z, x + 8, z + 8, 2 + (x + z) / 20)),
    );
    const terrain = { patches };
    for (const patch of [...patches].reverse()) {
      const [x, y, z] = patch.vertices[0]!;
      expect(terrainAt(terrain, x + 4, z + 4)?.y).toBe(y);
      expect(terrainAt(terrain, x + 10, z + 4)).toBeNull();
    }
  });

  it('samples both gradient axes away from the origin', () => {
    const terrain: BakedTerrain = {
      patches: [
        {
          surface: 'dirt',
          vertices: [
            [10, 7, 20],
            [10, 11, 30],
            [20, 13, 20],
          ],
          triangles: [[0, 1, 2]],
        },
      ],
    };
    const hit = terrainAt(terrain, 14, 23)!;
    expect(hit.y).toBeCloseTo(7 + 4 * 0.6 + 3 * 0.4, 10);
    expect(hit.dyDx).toBeCloseTo(0.6, 10);
    expect(hit.dyDz).toBeCloseTo(0.4, 10);
    expect(hit.surface).toBe('dirt');
  });
});
