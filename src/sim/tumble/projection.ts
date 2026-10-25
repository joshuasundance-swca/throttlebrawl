import { clamp } from '../../core';
import { gapAt, sRateFactor, type RoadNetwork } from '../../road';
import { drivableBand } from './body';

export interface StationAnchor {
  edge: number;
  s: number;
  d: number;
}
interface Point {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
}

/** A strictly bounded foot, including every Newton iteration and the final lateral offset. */
function near(road: RoadNetwork, edge: number, x: number, z: number, lo: number, hi: number): StationAnchor {
  const e = road.edges[edge]!;
  lo = clamp(lo, 0, e.length);
  hi = clamp(hi, lo, e.length);
  let s = lo;
  let best = Infinity;
  const consider = (at: number) => {
    const f = road.frameAt(edge, at);
    const dx = x - f.x;
    const dz = z - f.z;
    const dist = dx * dx + dz * dz;
    if (dist < best) {
      best = dist;
      s = at;
    }
  };
  consider(lo);
  for (let i = Math.ceil(lo / e.spacing); i * e.spacing < hi; i++) consider(i * e.spacing);
  consider(hi);
  for (let i = 0; i < 24; i++) {
    const f = road.frameAt(edge, s);
    const dx = x - f.x;
    const dz = z - f.z;
    const d = -dx * f.tz + dz * f.tx;
    const next = clamp(s + (dx * f.tx + dz * f.tz) * sRateFactor(f.kappa, d), lo, hi);
    if (Math.abs(next - s) < 1e-10) break;
    s = next;
  }
  const f = road.frameAt(edge, s);
  return { edge, s, d: -(x - f.x) * f.tz + (z - f.z) * f.tx };
}

/**
 * One whole-edge candidate scan per cluster, outside the particle/constraint solve. A remote
 * candidate is authoritative only on actual pavement contact. Otherwise search at most the
 * motion budget plus 4 m of body/constraint allowance on this edge and its near-end neighbors.
 */
export function projectCluster(
  road: RoadNetwork,
  anchor: StationAnchor,
  points: readonly Point[],
  dt: number,
  transfer = true,
): StationAnchor {
  const n = points.length || 1;
  const x = points.reduce((sum, p) => sum + p.x, 0) / n;
  const z = points.reduce((sum, p) => sum + p.z, 0) / n;
  const f = road.frameAt(anchor.edge, anchor.s);
  const travel = points.reduce((best, p) => Math.max(best, Math.sqrt(p.vx * p.vx + p.vz * p.vz) * dt), 0);
  const range = 4 + travel * sRateFactor(f.kappa, anchor.d);
  const lo = anchor.s - range;
  const hi = anchor.s + range;
  const candidate = transfer ? road.project(x, z, anchor.edge) : undefined;
  // Where the road's own projection is already continuous, keep its exact numbers: the bounded
  // search only replaces it where it would jump, so other tumbles and seeded races are unchanged.
  if (candidate && candidate.edge === anchor.edge && candidate.s >= lo && candidate.s <= hi)
    return { edge: candidate.edge, s: candidate.s, d: candidate.d };
  let local = near(road, anchor.edge, x, z, lo, hi);
  const distance = (p: StationAnchor) => {
    const w = road.toWorld(p.edge, p.s, 0, 0);
    const dx = x - w.x;
    const dz = z - w.z;
    return dx * dx + dz * dz;
  };
  let best = distance(local);
  for (const neighbor of road.neighbours(anchor.edge, anchor.s, range)) {
    const a = (lo - neighbor.sOffset) * neighbor.sSign;
    const b = (hi - neighbor.sOffset) * neighbor.sSign;
    const p = near(road, neighbor.edge, x, z, Math.min(a, b), Math.max(a, b));
    const d2 = distance(p);
    if (d2 < best) {
      best = d2;
      local = p;
    }
  }
  if (!candidate) return local;
  const spacing = road.edges[candidate.edge]!.spacing;
  const remote = near(road, candidate.edge, x, z, candidate.s - spacing, candidate.s + spacing);
  // Check the particles themselves, not the centre's height above an arbitrary reference plane.
  for (const q of points) {
    const p = near(road, remote.edge, q.x, q.z, remote.s - 2, remote.s + 2);
    const band = drivableBand(road, p.edge, p.s);
    if (p.d < band.lo || p.d > band.hi || gapAt(road, p.edge, p.s, p.d)) continue;
    const w = road.toWorld(p.edge, p.s, p.d, 0);
    const dx = q.x - w.x;
    const dz = q.z - w.z;
    if (dx * dx + dz * dz > 0.05 * 0.05) continue;
    if (Math.abs(q.y - road.surfaceHeight(p.edge, p.s, p.d)) <= 0.05) return remote;
  }
  return local;
}
