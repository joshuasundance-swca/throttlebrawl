import { BufferGeometry, Float32BufferAttribute } from 'three';
import type { BakedTerrain, BakedTerrainPatch } from '../road';

/** Draw exactly the authored physical faces; no separate triangulation or smoothing. */
export function buildTerrainGeometry(patch: BakedTerrainPatch): BufferGeometry {
  const positions = new Float32Array(patch.triangles.length * 9);
  let at = 0;
  for (const face of patch.triangles)
    for (const index of face) for (const value of patch.vertices[index]!) positions[at++] = value;
  const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

/** Assign whole faces to spatial chunks; a crossing face keeps all its authored vertices. */
export function buildTerrainChunks(
  terrain: BakedTerrain,
  keyAt: (x: number, z: number) => string,
): { key: string; surface: BakedTerrainPatch['surface']; geometry: BufferGeometry }[] {
  const chunks = new Map<
    string,
    {
      key: string;
      surface: BakedTerrainPatch['surface'];
      vertices: BakedTerrainPatch['vertices'][number][];
      triangles: [number, number, number][];
    }
  >();
  for (const patch of terrain.patches) {
    for (const face of patch.triangles) {
      const vertices = face.map((i) => patch.vertices[i]!);
      const key = keyAt(
        vertices.reduce((n, v) => n + Math.fround(v[0]), 0) / 3,
        vertices.reduce((n, v) => n + Math.fround(v[2]), 0) / 3,
      );
      const id = `${patch.surface}:${key}`;
      let chunk = chunks.get(id);
      if (!chunk) {
        chunk = { key, surface: patch.surface, vertices: [], triangles: [] };
        chunks.set(id, chunk);
      }
      const start = chunk.vertices.length;
      chunk.vertices.push(...vertices);
      chunk.triangles.push([start, start + 1, start + 2]);
    }
  }
  return [...chunks.values()].map((chunk) => ({
    key: chunk.key,
    surface: chunk.surface,
    geometry: buildTerrainGeometry(chunk),
  }));
}
