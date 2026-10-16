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

/**
 * Whether the wedge between unequal adjacent land reaches covers another road. Sampling includes
 * both longitudinal endpoints and the wider row's outer boundary; callers provide the physical
 * road-coverage query so this topology rule stays independent of a renderer or road locator.
 */
export function landWidthChangeOverRoad(
  s0M: number,
  s1M: number,
  reach0M: number,
  reach1M: number,
  probeM: number,
  covered: (sM: number, acrossM: number) => boolean,
): boolean {
  if (s1M <= s0M || reach0M <= 0 || reach1M <= 0 || probeM <= 0) return false;
  const common = Math.min(reach0M, reach1M);
  const n = Math.max(1, Math.ceil((s1M - s0M) / probeM));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const s = s0M + (s1M - s0M) * t;
    const far = reach0M + (reach1M - reach0M) * t;
    for (let d = common + probeM; d < far; d += probeM) if (covered(s, d)) return true;
    if (far > common && covered(s, far)) return true;
  }
  return false;
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
