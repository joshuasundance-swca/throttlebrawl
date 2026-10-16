import { keptSamples, type Point3Like } from '../core';

export { keptSamples } from '../core';
export type { Point3Like } from '../core';

/** A land-width change larger than this is closed at the reach shared by both rows. */
export const LAND_COMMON_REACH_DELTA_M = 2;

export type LandIntervalPlan =
  | { kind: 'absent' }
  | { kind: 'joined'; reach0M: number; reach1M: number }
  | { kind: 'common'; reachM: number; narrow: 0 | 1 };

/**
 * How adjacent roadside-land rows join. `commonEligible` is explicit because a lake-bank interval
 * has its own wall and shore topology and must keep that canonical join.
 */
export function landIntervalPlan(
  reach0M: number,
  reach1M: number,
  commonEligible: boolean,
): LandIntervalPlan {
  if (reach0M <= 0 || reach1M <= 0) return { kind: 'absent' };
  if (commonEligible && Math.abs(reach0M - reach1M) > LAND_COMMON_REACH_DELTA_M)
    return { kind: 'common', reachM: Math.min(reach0M, reach1M), narrow: reach0M < reach1M ? 0 : 1 };
  return { kind: 'joined', reach0M, reach1M };
}

export type TerrainProfileRow<P extends Point3Like = Point3Like> = readonly [P, P, P, P] | null;

export interface TerrainFan {
  from: number;
  to: number;
  mid: number;
}

export interface TerrainProfilePlan {
  kept: boolean[];
  fans: TerrainFan[];
}

const distinct = (a: Point3Like, b: Point3Like) => a.x !== b.x || a.y !== b.y || a.z !== b.z;

/**
 * Shared row-selection and fan topology for a four-point terrain profile. Null rows and
 * `breakBefore[i]` split runs. A flat band's presence transition keeps both adjacent rows so a
 * consumer cannot bridge over a shelf that begins or ends.
 */
export function terrainProfilePlan<P extends Point3Like>(
  rows: readonly TerrainProfileRow<P>[],
  breakBefore: readonly boolean[],
  tolM: number,
  maxSpanM: number,
): TerrainProfilePlan {
  const kept = rows.map(() => false);
  const fans: TerrainFan[] = [];
  let start = 0;
  while (start < rows.length) {
    while (start < rows.length && !rows[start]) start++;
    if (start >= rows.length) break;
    let end = start + 1;
    while (end < rows.length && rows[end] && !breakBefore[end]) end++;
    const run = rows.slice(start, end) as readonly (readonly P[])[];
    const selected = new Set(keptSamples(run, tolM, maxSpanM).map((i) => start + i));
    for (let i = start; i < end; i++) {
      const row = rows[i]!;
      const flat = distinct(row[1], row[2]);
      const before = i > start ? distinct(rows[i - 1]![1], rows[i - 1]![2]) : flat;
      const after = i + 1 < end ? distinct(rows[i + 1]![1], rows[i + 1]![2]) : flat;
      if (flat !== before || flat !== after) selected.add(i);
    }
    const ordered = [...selected].sort((a, b) => a - b);
    for (const i of ordered) kept[i] = true;
    for (let i = 1; i < ordered.length; i++) {
      const from = ordered[i - 1]!;
      const to = ordered[i]!;
      fans.push({ from, to, mid: Math.floor((from + to) / 2) });
    }
    start = end;
  }
  return { kept, fans };
}
