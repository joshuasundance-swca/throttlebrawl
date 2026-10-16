// Render-only fitting to the same Float32 authored faces the simulation meets. Undefined keeps
// legacy/road rendering; null means authored coverage has no supporting land, so draw no mark.
import { courseAt, terrainAt, type RoadNetwork, type StructurePlan } from '../road';

const EMPTY_STRUCTURES: StructurePlan = { items: [], cellM: 16, cells: new Map() };
const REACH_M = 0.3;

export interface TerrainFit {
  y: number;
  nx: number;
  ny: number;
  nz: number;
  scale: number;
}

export function fitTerrain(
  road: RoadNetwork | null,
  x: number,
  y: number,
  z: number,
  heading = 0,
  lengthM = 0,
  widthM = 0,
): TerrainFit | null | undefined {
  if (!road?.terrain) return undefined;
  const pos = road.project(x, z);
  const world = road.toWorld(pos.edge, pos.s, pos.d, 0);
  // A projected point beyond an endpoint is clamped: it must not invent that road under the mark.
  // courseAt checks every nearby pass (including another pass of a looping edge) and its height.
  if (Math.hypot(world.x - x, world.z - z) < 0.05) {
    const support = courseAt(road, EMPTY_STRUCTURES, pos, y);
    if (support.kind === 'road') return undefined;
  }
  const hit = terrainAt(road.terrain, x, z, y + REACH_M);
  if (!hit || hit.surface === 'water') return null;
  const { normal: n } = hit;
  if (lengthM === 0 && widthM === 0) return { y: hit.y, nx: n.x, ny: n.y, nz: n.z, scale: 1 };

  // Match the actual face, rather than averaging across a ridge, cliff or uncovered hole. Check
  // the perimeter and interior of the mark's bounding rectangle; shrink at an edge, else omit it.
  const fx = -Math.sin(heading),
    fz = -Math.cos(heading);
  const rx = Math.cos(heading),
    rz = -Math.sin(heading);
  for (const scale of [1, 0.7, 0.45]) {
    let fits = true;
    for (let i = -2; i <= 2 && fits; i++) {
      for (let j = -2; j <= 2; j++) {
        const along = (lengthM * scale * i) / 4;
        const across = (widthM * scale * j) / 4;
        const dx = along * fx + across * rx;
        const dz = along * fz + across * rz;
        const expected = hit.y + hit.dyDx * dx + hit.dyDz * dz;
        const sample = terrainAt(road.terrain, x + dx, z + dz, expected + REACH_M);
        if (!sample || sample.surface === 'water' || Math.abs(sample.y - expected) > 0.02) {
          fits = false;
          break;
        }
      }
    }
    if (fits) return { y: hit.y, nx: n.x, ny: n.y, nz: n.z, scale };
  }
  return null;
}
