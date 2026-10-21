import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { terrainAt, type BakedTerrain, type BakedTerrainPatch } from '../road';
import { buildTerrainChunks, buildTerrainGeometry } from './terrain-mesh';

function ray(patch: BakedTerrainPatch, x: number, z: number) {
  const geometry = buildTerrainGeometry(patch);
  const material = new MeshBasicMaterial();
  const mesh = new Mesh(geometry, material);
  mesh.updateMatrixWorld(true);
  const hits = new Raycaster(new Vector3(x, 100, z), new Vector3(0, -1, 0)).intersectObject(mesh);
  geometry.dispose();
  material.dispose();
  return hits;
}

describe('shared authored terrain geometry', () => {
  it('draws the exact physical height and face normal on both slope triangles', () => {
    const patch: BakedTerrainPatch = {
      surface: 'grass',
      vertices: [
        [0, 2, 0],
        [0, 3, 10],
        [10, 5, 0],
        [10, 6, 10],
      ],
      triangles: [
        [0, 1, 2],
        [2, 1, 3],
      ],
    };
    const terrain: BakedTerrain = { patches: [patch] };
    for (const [x, z] of [
      [2, 3],
      [6, 4],
      [8, 7],
    ] as const) {
      const hit = ray(patch, x, z)[0];
      expect(hit).toBeDefined();
      const physical = terrainAt(terrain, x, z)!;
      expect(hit!.point.y).toBeCloseTo(physical.y, 6);
      expect(hit!.face!.normal.x).toBeCloseTo(physical.normal.x, 6);
      expect(hit!.face!.normal.y).toBeCloseTo(physical.normal.y, 6);
      expect(hit!.face!.normal.z).toBeCloseTo(physical.normal.z, 6);
    }
    expect(ray(patch, -1, 3)).toEqual([]);
  });

  it('preserves absent water coverage instead of filling the gap between authored faces', () => {
    const patch: BakedTerrainPatch = {
      surface: 'water',
      vertices: [
        [-3, 4, -3],
        [-3, 4, 3],
        [-1, 4, -3],
        [1, 4, -3],
        [1, 4, 3],
        [3, 4, -3],
      ],
      triangles: [
        [0, 1, 2],
        [3, 4, 5],
      ],
    };
    expect(ray(patch, -2.5, -1).length).toBeGreaterThan(0);
    expect(ray(patch, 1.5, -1).length).toBeGreaterThan(0);
    expect(ray(patch, 0, -1)).toEqual([]);
    expect(terrainAt({ patches: [patch] }, 0, -1)).toBeNull();
  });

  it('keeps source data intact while the drawing uses Float32 vertices', () => {
    const patch: BakedTerrainPatch = {
      surface: 'dirt',
      vertices: [
        [0, 3.1, 0],
        [0, 3.1, 10],
        [10, 3.1, 0],
      ],
      triangles: [[0, 1, 2]],
    };
    const before = JSON.stringify(patch);
    expect(ray(patch, 1, 1)[0]?.point.y).toBeCloseTo(Math.fround(3.1), 10);
    expect(JSON.stringify(patch)).toBe(before);
  });

  it('batches complete supplied faces by surface and centroid without splitting crossing faces or mutating input', () => {
    const patch: BakedTerrainPatch = {
      surface: 'grass',
      vertices: [
        [-50, 3.1, -50],
        [-50, 4.1, 650],
        [650, 5.1, -50],
      ],
      triangles: [[0, 1, 2]],
    };
    const terrain: BakedTerrain = {
      patches: [
        patch,
        { ...patch, surface: 'water', vertices: patch.vertices.map(([x, , z]) => [x, 3.1, z]) },
        { ...patch, vertices: patch.vertices.map(([x, y, z]) => [x + 10000, y, z]) },
      ],
    };
    const before = JSON.stringify(terrain);
    const chunks = buildTerrainChunks(terrain, (x, z) => `${Math.floor(x / 512)},${Math.floor(z / 512)}`);
    try {
      expect(chunks.length).toBe(terrain.patches.length);
      expect(chunks.map((c) => c.surface)).toEqual(terrain.patches.map((p) => p.surface));
      for (const [i, chunk] of chunks.entries()) {
        expect(chunk.geometry.index).toBeNull();
        expect(Array.from(chunk.geometry.getAttribute('position').array)).toEqual(
          terrain.patches[i]!.vertices.flatMap((v) => v.map(Math.fround)),
        );
        expect(chunk.geometry.getAttribute('position').count).toBe(3);
        const bounds = chunk.geometry.boundingBox!;
        expect(bounds.max.x - bounds.min.x).toBe(700);
        expect(bounds.max.z - bounds.min.z).toBe(700);
        const normals = chunk.geometry.getAttribute('normal');
        for (let v = 1; v < normals.count; v++) {
          expect(normals.getX(v)).toBe(normals.getX(0));
          expect(normals.getY(v)).toBe(normals.getY(0));
          expect(normals.getZ(v)).toBe(normals.getZ(0));
        }
      }
      expect(JSON.stringify(terrain)).toBe(before);
    } finally {
      for (const chunk of chunks) chunk.geometry.dispose();
    }
  });
});
