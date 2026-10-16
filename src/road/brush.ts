// The same deterministic brush clumps end the drawn verge and the rider's ground band.
import type { RoadNetwork } from './network';
import { lanesNear } from './course';

/** A clump represents this interval along a brush edge; its centre is jittered inside it. */
export const BRUSH_STEP_M = 3.5;

export function hedged(
  tags: readonly { s0: number; s1: number; side?: string; tag: string }[],
  side: -1 | 1,
  s: number,
): boolean {
  return tags.some(
    (t) =>
      t.tag === 'gardens' &&
      s >= t.s0 &&
      s <= t.s1 &&
      (t.side === undefined || t.side === 'both' || t.side === (side < 0 ? 'left' : 'right')),
  );
}

function hash(edge: number, s: number, side: number): number {
  let h = (edge * 374761393 + Math.round(s * 10) * 668265263 + side * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A surviving clump at its nominal station, or null when no brush is drawn for that interval. */
export function brushClumpAt(road: RoadNetwork, edge: number, s: number, side: -1 | 1) {
  const e = road.edges[edge];
  if (!e || s < BRUSH_STEP_M / 2 || s >= e.length) return null;
  const v = road.vergeAt(edge, s, side < 0 ? 'left' : 'right');
  if (v.widthM < 0.05 || v.edge !== 'brush' || hedged(e.tags, side, s)) return null;
  const k = hash(edge, s, side);
  const at = road.toWorld(edge, s + (k - 0.5) * 1.2, v.dOuter + side * (0.25 + k * 0.5), -0.05);
  const size = 0.75 + hash(edge, s, side * 3) * 0.6;
  if (lanesNear(road, at.x, at.z, edge, 0.9 * size)) return null;
  return { ...at, size, turn: k };
}
