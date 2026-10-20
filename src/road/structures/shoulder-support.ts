import { keptSamples, type Point3Like } from '../../core';
import { DRAWN_VERGE_M } from '../furniture';
import type { Edge, RoadNetwork } from '../network';
import { clearGroundReach } from '../land-topology';
import { installPlainShoulderSupport, ROAD_SURFACE_SIMPLIFY, SHOULDER_LAP_M } from '../surface-sampling';

// Shared with the solid road drawing. Coverage is tested against the actual simplified triangles,
// not against a widened road-coordinate band: tight curves leave exposed wedges in that band.

type Pair = readonly [Point3Like, Point3Like];
interface Plan {
  ss: number[];
  left: Pair[];
  right: Pair[];
  kept: number[];
}
const plans = new WeakMap<RoadNetwork, Map<number, Plan | null>>();
interface Station {
  edge: number;
  i: number;
}
interface Nearby {
  cells: Map<string, Station[]>;
  reach: number;
}
const nearby = new WeakMap<RoadNetwork, Nearby>();
const CELL_M = 16;

function neighborsOf(road: RoadNetwork): Nearby {
  const known = nearby.get(road);
  if (known) return known;
  const cells = new Map<string, Station[]>();
  let reach = 0;
  for (const edge of road.edges) {
    reach = Math.max(reach, -edge.dMin, edge.dMax, edge.spacing);
    for (let i = 0; i < edge.count; i++) {
      const key = `${Math.floor(edge.x[i]! / CELL_M)},${Math.floor(edge.z[i]! / CELL_M)}`;
      let row = cells.get(key);
      if (!row) cells.set(key, (row = []));
      row.push({ edge: edge.index, i });
    }
  }
  const result = { cells, reach: reach + CELL_M / 2 + 0.25 };
  nearby.set(road, result);
  return result;
}

/** Refuse the special case when another road can clip a shoulder. This is a one-time plan check. */
function clipsShoulder(road: RoadNetwork, edge: Edge, s: number, d: number): boolean {
  const p = road.toWorld(edge.index, s, d, -0.02);
  const { cells, reach } = neighborsOf(road);
  const nearest = new Map<number, { i: number; distance: number }>();
  for (let x = Math.floor((p.x - reach) / CELL_M); x <= Math.floor((p.x + reach) / CELL_M); x++)
    for (let z = Math.floor((p.z - reach) / CELL_M); z <= Math.floor((p.z + reach) / CELL_M); z++)
      for (const station of cells.get(`${x},${z}`) ?? []) {
        const other = road.edges[station.edge]!;
        if (other.index === edge.index || other.isTrafficOnly) continue;
        const dx = p.x - other.x[station.i]!;
        const dz = p.z - other.z[station.i]!;
        const distance = dx * dx + dz * dz;
        const previous = nearest.get(other.index);
        if (!previous || distance < previous.distance) nearest.set(other.index, { i: station.i, distance });
      }
  for (const [index, { i: best }] of nearest) {
    const other = road.edges[index]!;
    let at = best * other.spacing;
    let across = 0;
    for (let i = 0; i < 3; i++) {
      const f = road.frameAt(other.index, Math.max(0, Math.min(other.length, at)));
      const dx = p.x - f.x;
      const dz = p.z - f.z;
      across = -dx * f.tz + dz * f.tx;
      at = Math.max(0, Math.min(other.length, at)) + dx * f.tx + dz * f.tz;
    }
    if (at < -0.25 || at > other.length + 0.25) continue;
    at = Math.max(0, Math.min(other.length, at));
    let lo = Infinity;
    let hi = -Infinity;
    for (const lane of road.lanesAt(other.index, at)) {
      lo = Math.min(lo, lane.dCenterM - lane.widthM / 2);
      hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
    }
    if (across > lo - 0.25 && across < hi + 0.25 && p.y - road.surfaceHeight(other.index, at, across) > 0.05)
      return true;
  }
  return false;
}

function planOf(road: RoadNetwork, edge: Edge): Plan | null {
  let cache = plans.get(road);
  if (!cache) plans.set(road, (cache = new Map<number, Plan | null>()));
  if (cache.has(edge.index)) return cache.get(edge.index)!;
  // Clipped, split, median and gapped roads keep their existing support path. No approximate
  // reconstruction of those surfaces is introduced by this plain-road seam repair.
  if (
    !road.terrain ||
    edge.isTrafficOnly ||
    road.splitZones().length ||
    edge.features.some((f) => f.kind === 'gap') ||
    edge.sections.some((section) => section.median || section.lanes.some((lane) => lane.kind === 'shortcut'))
  ) {
    cache.set(edge.index, null);
    return null;
  }
  const n = Math.max(1, Math.round(edge.length / 2)); // road-mesh's source rows, not baked profile spacing
  const ss: number[] = [];
  const left: Pair[] = [];
  const right: Pair[] = [];
  const all: Point3Like[][] = [];
  for (let i = 0; i <= n; i++) {
    const s = (edge.length * i) / n;
    let lo = Infinity;
    let hi = -Infinity;
    for (const lane of road.lanesAt(edge.index, s)) {
      if (lane.kind !== 'drive') continue;
      lo = Math.min(lo, lane.dCenterM - lane.widthM / 2);
      hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
    }
    if (!(lo < hi)) {
      cache.set(edge.index, null);
      return null;
    }
    const outerL = edge.dMin - DRAWN_VERGE_M - SHOULDER_LAP_M;
    const outerR = edge.dMax + DRAWN_VERGE_M + SHOULDER_LAP_M;
    for (const [near, far] of [
      [lo, outerL],
      [hi, outerR],
    ] as const)
      if (clearGroundReach(near, far, 0.25, (d) => clipsShoulder(road, edge, s, d)) !== far) {
        cache.set(edge.index, null);
        return null;
      }
    const p = (d: number, h: number) => road.toWorld(edge.index, s, d, h);
    const a: Pair = [p(outerL, -0.02), p(lo, -0.02)];
    const b: Pair = [p(hi, -0.02), p(outerR, -0.02)];
    ss.push(s);
    left.push(a);
    right.push(b);
    // All solid rows participate together in the renderer's simplification. Markings do not.
    all.push([p(lo, 0), p(hi, 0), ...a, ...b]);
  }
  const kept = keptSamples(all, ROAD_SURFACE_SIMPLIFY.tolM, ROAD_SURFACE_SIMPLIFY.maxSpanM);
  // The actual vertex buffer uses Float32. Simplification operates before that conversion.
  for (const row of [...left, ...right])
    for (const p of row) {
      p.x = Math.fround(p.x);
      p.y = Math.fround(p.y);
      p.z = Math.fround(p.z);
    }
  const result = { ss, left, right, kept };
  cache.set(edge.index, result);
  return result;
}

function inTriangle(x: number, z: number, a: Point3Like, b: Point3Like, c: Point3Like): boolean {
  const bx = b.x - a.x,
    bz = b.z - a.z,
    cx = c.x - a.x,
    cz = c.z - a.z;
  const det = bx * cz - bz * cx;
  if (det === 0) return false;
  const dx = x - a.x,
    dz = z - a.z;
  const u = (dx * cz - dz * cx) / det;
  const v = (bx * dz - bz * dx) / det;
  return u >= 0 && v >= 0 && u + v <= 1;
}

/** Exact sampled shoulder support for a plain authored road. Cached once; at most six triangle tests. */
function onPlainShoulder(road: RoadNetwork, edge: Edge, s: number, d: number): boolean {
  const plan = planOf(road, edge);
  if (!plan) return false;
  const frame = road.frameAt(edge.index, s);
  const x = frame.x - frame.tz * d,
    z = frame.z + frame.tx * d;
  const { kept, ss } = plan;
  let lo = 0,
    hi = kept.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ss[kept[mid]!]! <= s) lo = mid;
    else hi = mid - 1;
  }
  const rows = d < 0 ? plan.left : plan.right;
  for (let i = Math.max(0, lo - 1); i < Math.min(kept.length - 1, lo + 2); i++) {
    const a = rows[kept[i]!]!,
      b = rows[kept[i + 1]!]!;
    if (inTriangle(x, z, a[0], a[1], b[0]) || inTriangle(x, z, a[1], b[1], b[0])) return true;
  }
  return false;
}

function prewarm(road: RoadNetwork): void {
  for (const edge of road.edges) planOf(road, edge);
}

installPlainShoulderSupport(onPlainShoulder, prewarm);
