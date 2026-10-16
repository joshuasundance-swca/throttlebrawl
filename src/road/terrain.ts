import type { GroundSurface } from '../core';
import type { BakedTerrain } from './types';

/** One actual authored face, including its upward unit normal and height gradient. */
export interface TerrainSample {
  readonly y: number;
  readonly surface: GroundSurface | 'water';
  readonly normal: { readonly x: number; readonly y: number; readonly z: number };
  readonly dyDx: number;
  readonly dyDz: number;
  readonly patch: number;
  readonly triangle: number;
}

interface Face {
  x0: number;
  y0: number;
  z0: number;
  dx1: number;
  dz1: number;
  dx2: number;
  dz2: number;
  det: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  sample: TerrainSample;
  order: number;
}

interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

type Node = Bounds & ({ faces: readonly Face[] } | { left: Node; right: Node });
const indexes = new WeakMap<BakedTerrain, Node | null>();

function tree(faces: Face[]): Node | null {
  if (!faces.length) return null;
  const box: Bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const face of faces) {
    box.minX = Math.min(box.minX, face.minX);
    box.maxX = Math.max(box.maxX, face.maxX);
    box.minZ = Math.min(box.minZ, face.minZ);
    box.maxZ = Math.max(box.maxZ, face.maxZ);
  }
  // A tree bounds storage by authored face count, even for very large map extents.
  if (faces.length <= 8) return { ...box, faces };
  const x = box.maxX - box.minX >= box.maxZ - box.minZ;
  faces.sort(
    (a, b) =>
      (x ? a.minX + a.maxX - b.minX - b.maxX : a.minZ + a.maxZ - b.minZ - b.maxZ) || a.order - b.order,
  );
  const mid = Math.floor(faces.length / 2);
  return { ...box, left: tree(faces.slice(0, mid))!, right: tree(faces.slice(mid))! };
}

function indexOf(terrain: BakedTerrain): Node | null {
  if (indexes.has(terrain)) return indexes.get(terrain)!;
  const faces: Face[] = [];
  terrain.patches.forEach((patch, p) => {
    const vertices = patch.vertices.map(
      ([x, y, z]) => [Math.fround(x), Math.fround(y), Math.fround(z)] as const,
    );
    patch.triangles.forEach(([a, b, c], t) => {
      const v0 = vertices[a]!;
      const v1 = vertices[b]!;
      const v2 = vertices[c]!;
      const dx1 = v1[0] - v0[0];
      const dy1 = v1[1] - v0[1];
      const dz1 = v1[2] - v0[2];
      const dx2 = v2[0] - v0[0];
      const dy2 = v2[1] - v0[1];
      const dz2 = v2[2] - v0[2];
      const det = dx1 * dz2 - dx2 * dz1;
      // Registry validation catches this for packs. Directly constructed networks must also fail
      // visibly rather than turn a collapsed rendered face into a NaN physical floor.
      if (!(det < 0)) throw new RangeError(`Terrain patch ${p} face ${t} is not upward at Float32 precision`);
      const dyDx = (dy1 * dz2 - dy2 * dz1) / det;
      const dyDz = (dx1 * dy2 - dx2 * dy1) / det;
      const length = Math.sqrt(1 + dyDx * dyDx + dyDz * dyDz);
      faces.push({
        x0: v0[0],
        y0: v0[1],
        z0: v0[2],
        dx1,
        dz1,
        dx2,
        dz2,
        det,
        minX: Math.min(v0[0], v1[0], v2[0]),
        maxX: Math.max(v0[0], v1[0], v2[0]),
        minZ: Math.min(v0[2], v1[2], v2[2]),
        maxZ: Math.max(v0[2], v1[2], v2[2]),
        sample: {
          y: v0[1],
          surface: patch.surface,
          normal: { x: -dyDx / length, y: 1 / length, z: -dyDz / length },
          dyDx,
          dyDz,
          patch: p,
          triangle: t,
        },
        order: faces.length,
      });
    });
  });
  const result = tree(faces);
  indexes.set(terrain, result);
  return result;
}

/** Highest covered face at/below maxY; boundaries included, authored order wins ties. */
export function terrainAt(
  terrain: BakedTerrain | undefined,
  x: number,
  z: number,
  maxY = Infinity,
  kind: 'any' | 'land' | 'water' = 'any',
): TerrainSample | null {
  if (!terrain || !Number.isFinite(x) || !Number.isFinite(z) || Number.isNaN(maxY)) return null;
  const root = indexOf(terrain);
  if (!root) return null;
  const pending = [root];
  let best: Face | null = null;
  let y = -Infinity;
  while (pending.length) {
    const node = pending.pop()!;
    if (x < node.minX || x > node.maxX || z < node.minZ || z > node.maxZ) continue;
    if (!('faces' in node)) {
      pending.push(node.right, node.left);
      continue;
    }
    for (const face of node.faces) {
      const water = face.sample.surface === 'water';
      if ((kind === 'land' && water) || (kind === 'water' && !water)) continue;
      const dx = x - face.x0;
      const dz = z - face.z0;
      const u = (dx * face.dz2 - face.dx2 * dz) / face.det;
      const v = (face.dx1 * dz - dx * face.dz1) / face.det;
      if (u < -1e-8 || v < -1e-8 || u + v > 1 + 1e-8) continue;
      const height = face.y0 + face.sample.dyDx * dx + face.sample.dyDz * dz;
      if (height > maxY || height < y || (height === y && best && face.order >= best.order)) continue;
      best = face;
      y = height;
    }
  }
  return best ? { ...best.sample, normal: { ...best.sample.normal }, y } : null;
}
