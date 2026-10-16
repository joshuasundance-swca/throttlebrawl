import { BufferGeometry, Float32BufferAttribute } from 'three';
import type { BakedTerrainPatch } from '../road';

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
