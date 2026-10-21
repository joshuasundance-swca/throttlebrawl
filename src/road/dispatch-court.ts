// A bounded, one-side tag places an original 16 x 8 m kit. It creates no ambient spawn or land.
// This small public layout is shared by the lazy PNW planner and scenery/furniture reservations.
import { atan2, cos, sin } from '../core';
import type { RoadNetwork } from './network';
import type { StructureFoot } from './structures';

export const DISPATCH_COURT_TAG = 'dispatch-court';
export const DISPATCH_COURT_DEPTH_M = 8;
const LENGTH_M = 16;
const VERGE_OVERLAP_M = 0.25;

export interface DispatchCourt {
  readonly rule: string;
  readonly edge: number;
  readonly s: number;
  readonly d: number;
  readonly side: -1 | 1;
  readonly foot: StructureFoot;
}

/** Pure, uncached: tag edits/removal cannot leave stale placement or reservation state. */
export function dispatchCourts(road: RoadNetwork): DispatchCourt[] {
  const out: DispatchCourt[] = [];
  for (const edge of road.edges) {
    const seen = new Set<string>();
    for (const tag of edge.tags) {
      if (tag.tag !== DISPATCH_COURT_TAG || (tag.side !== 'left' && tag.side !== 'right')) continue;
      if (
        !Number.isFinite(tag.s0) ||
        !Number.isFinite(tag.s1) ||
        tag.s0 < 0 ||
        tag.s1 > edge.length ||
        Math.abs(tag.s1 - tag.s0 - LENGTH_M) > 1e-6 ||
        (tag.s0 === 0 && tag.s1 === edge.length)
      )
        continue;
      const rule = `${DISPATCH_COURT_TAG}:${edge.index}:${tag.side}:${tag.s0}`;
      if (seen.has(rule)) continue;
      seen.add(rule);
      const side = tag.side === 'left' ? -1 : 1;
      const s = (tag.s0 + tag.s1) / 2;
      const d =
        road.vergeAt(edge.index, s, tag.side).dOuter + side * (DISPATCH_COURT_DEPTH_M / 2 - VERGE_OVERLAP_M);
      const p = road.toWorld(edge.index, s, d, 0);
      const a = road.toWorld(edge.index, Math.max(0, s - 1), 0, 0);
      const b = road.toWorld(edge.index, Math.min(edge.length, s + 1), 0, 0);
      const yaw = atan2(b.x - a.x, b.z - a.z);
      out.push({
        rule,
        edge: edge.index,
        s,
        d,
        side,
        foot: {
          x: p.x,
          z: p.z,
          ux: cos(yaw),
          uz: -sin(yaw),
          hu: DISPATCH_COURT_DEPTH_M / 2,
          hv: (tag.s1 - tag.s0) / 2,
        },
      });
    }
  }
  return out;
}

/** Exact rectangle/disc separation, including the candidate's full radius. No road-band clearing. */
export function dispatchCourtClear(
  feet: readonly StructureFoot[],
  x: number,
  z: number,
  radius: number,
): boolean {
  for (const f of feet) {
    const dx = x - f.x,
      dz = z - f.z;
    const u = Math.max(0, Math.abs(dx * f.ux + dz * f.uz) - f.hu);
    const v = Math.max(0, Math.abs(-dx * f.uz + dz * f.ux) - f.hv);
    if (u * u + v * v <= radius * radius) return false;
  }
  return true;
}
