// The road compiler (M1 road-1; docs/content-packs.md, "Road networks, roads and routes"): turns a
// hand-authored track (Catmull-Rom control points plus elevation humps) into the baked road
// format, the same files the GIS pipeline emits. It lives in road/ so it follows the determinism
// rules: every number comes from core/math and + - * / sqrt, so every engine bakes the same
// bytes. tools/road/bake.mjs runs it and writes the pack files.
//
// How a centreline is made:
//  1. a centripetal Catmull-Rom spline through the control points, sampled densely;
//  2. its heading, resampled at a fine step along arc length and smoothed with a moving average,
//     because curvature must come from a smoothed curve, never from the raw polyline;
//  3. curvature is the derivative of that smoothed heading, and positions are re-integrated from
//     it, so baked positions and curvature agree by construction (the lint checks they do);
//  4. the one main-road curve is cut into roads at the given lengths, so tangent and curvature
//     are continuous across the pass-through junctions.
// Elevation is a base height plus smooth humps over each road's own s (bridge humps; a ramp lip
// is road-2's), and grade is its exact derivative.
import { atan2, cos, sin, type LaneInfo } from '../core';
import type { BakedBarrier, BakedFeature, BakedTag } from './types';

/** A smooth hump: zero value and slope at both ends, peak `heightM` at `centreM`. */
export interface HumpSource {
  centreM: number;
  lengthM: number;
  heightM: number;
}

export interface RoadSource {
  id: string;
  name: string;
  /** Length cut from the main curve. The last road takes whatever is left. */
  lengthM?: number;
  speedLimitMps: number;
  surface: string;
  humps: readonly HumpSource[];
  /** Tag ranges; an s1 of 'end' means the road's end. */
  tags: readonly (Omit<BakedTag, 's1'> & { s1: number | 'end' })[];
  features: readonly BakedFeature[];
  barriers: readonly (Omit<BakedBarrier, 's1'> & { s1: number | 'end' })[];
}

export interface RouteSource {
  id: string;
  start: { road: string; s: number; dir: 1 | -1 };
  /** Finish s; a negative value counts back from the road's end. */
  finish: { road: string; s: number };
  checkpoints: readonly { road: string; s: number }[];
  startGrid: { rows: number; perRow: number; rowGapM: number };
}

export interface TrackSource {
  network: {
    id: string;
    name: string;
    region: string;
    crs: { kind: 'tmerc'; originLatDeg: number; originLonDeg: number; originElevM: number };
    notes: string;
  };
  createdAt: string;
  /** Control points [x, z] in the network frame (x east, z south), the whole main road in order. */
  points: readonly (readonly [number, number])[];
  baseElevationM: number;
  /** Nominal sample spacing (the format's 2 m default). */
  spacingM: number;
  /** Moving-average window for the heading, metres. */
  smoothingM: number;
  lanes: readonly LaneInfo[];
  roads: readonly RoadSource[];
  route: RouteSource;
}

const FINE_STEP = 0.5; // metres between fine heading samples
const DENSE_PER_SEGMENT = 400; // spline evaluations per control-point segment

const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;
/** Rounds to 7 significant digits without Math.log10: scale by powers of ten found by comparison. */
function sig7(v: number): number {
  if (v === 0) return 0;
  let scale = 1;
  const a = v < 0 ? -v : v;
  let m = a;
  while (m >= 1e7) {
    m /= 10;
    scale /= 10;
  }
  while (m < 1e6) {
    m *= 10;
    scale *= 10;
  }
  const out = Math.round(v * scale) / scale;
  return out === 0 ? 0 : out;
}

/** Centripetal Catmull-Rom (alpha 0.5) through points, densely sampled. */
function denseSpline(points: readonly (readonly [number, number])[]): { x: number[]; z: number[] } {
  if (points.length < 2) throw new Error('a track needs at least two control points');
  const first = points[0] as readonly [number, number];
  const second = points[1] as readonly [number, number];
  const last = points[points.length - 1] as readonly [number, number];
  const beforeLast = points[points.length - 2] as readonly [number, number];
  const p: (readonly [number, number])[] = [
    [2 * first[0] - second[0], 2 * first[1] - second[1]],
    ...points,
    [2 * last[0] - beforeLast[0], 2 * last[1] - beforeLast[1]],
  ];
  // Knot spacing: the square root of the chord length (centripetal), with sqrt only.
  const knot = (a: readonly [number, number], b: readonly [number, number]): number => {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const d = Math.sqrt(Math.sqrt(dx * dx + dz * dz));
    return d < 1e-9 ? 1e-9 : d;
  };
  const x: number[] = [first[0]];
  const z: number[] = [first[1]];
  for (let i = 1; i < p.length - 2; i++) {
    const p0 = p[i - 1] as readonly [number, number];
    const p1 = p[i] as readonly [number, number];
    const p2 = p[i + 1] as readonly [number, number];
    const p3 = p[i + 2] as readonly [number, number];
    const t0 = 0;
    const t1 = t0 + knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    for (let k = 1; k <= DENSE_PER_SEGMENT; k++) {
      const t = t1 + ((t2 - t1) * k) / DENSE_PER_SEGMENT;
      const out: number[] = [];
      for (let c = 0; c < 2; c++) {
        const a1 = ((t1 - t) * (p0[c] as number) + (t - t0) * (p1[c] as number)) / (t1 - t0);
        const a2 = ((t2 - t) * (p1[c] as number) + (t - t1) * (p2[c] as number)) / (t2 - t1);
        const a3 = ((t3 - t) * (p2[c] as number) + (t - t2) * (p3[c] as number)) / (t3 - t2);
        const b1 = ((t2 - t) * a1 + (t - t0) * a2) / (t2 - t0);
        const b2 = ((t3 - t) * a2 + (t - t1) * a3) / (t3 - t1);
        out.push(((t2 - t) * b1 + (t - t1) * b2) / (t2 - t1));
      }
      x.push(out[0] as number);
      z.push(out[1] as number);
    }
  }
  return { x, z };
}

/** Moving average with the ends held (so straight ends stay straight). */
function movingAverage(v: readonly number[], half: number): number[] {
  const n = v.length;
  const out = new Array<number>(n);
  const at = (i: number): number => v[i < 0 ? 0 : i >= n ? n - 1 : i] as number;
  let sum = 0;
  for (let i = -half; i <= half; i++) sum += at(i);
  for (let i = 0; i < n; i++) {
    out[i] = sum / (2 * half + 1);
    sum += at(i + half + 1) - at(i - half);
  }
  return out;
}

/** The smoothed main-road centreline at a fine step along arc length. */
export interface Centreline {
  step: number;
  length: number;
  x: number[];
  z: number[];
  heading: number[];
  kappa: number[];
}

export function buildCentreline(src: Pick<TrackSource, 'points' | 'smoothingM'>): Centreline {
  const dense = denseSpline(src.points);
  // Cumulative chord length and unwrapped heading (0 = north, positive toward east: a right turn).
  const cum: number[] = [0];
  const head: number[] = [];
  let prevHeading = 0;
  for (let i = 1; i < dense.x.length; i++) {
    const dx = (dense.x[i] as number) - (dense.x[i - 1] as number);
    const dz = (dense.z[i] as number) - (dense.z[i - 1] as number);
    cum.push((cum[i - 1] as number) + Math.sqrt(dx * dx + dz * dz));
    let h = atan2(dx, -dz);
    if (i > 1) {
      while (h - prevHeading > 3.141592653589793) h -= 6.283185307179586;
      while (h - prevHeading < -3.141592653589793) h += 6.283185307179586;
    }
    head.push(h);
    prevHeading = h;
  }
  // Heading of chord i sits at its midpoint.
  const mid = head.map((_h, i) => ((cum[i] as number) + (cum[i + 1] as number)) / 2);
  const total = cum[cum.length - 1] as number;
  const n = Math.floor(total / FINE_STEP);
  const fine: number[] = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const s = k * FINE_STEP;
    while (j < mid.length - 2 && (mid[j + 1] as number) < s) j++;
    const s0 = mid[j] as number;
    const s1 = mid[j + 1] ?? s0;
    const h0 = head[j] as number;
    const h1 = head[j + 1] ?? h0;
    const t = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    fine.push(h0 + (h1 - h0) * (t < 0 ? 0 : t > 1 ? 1 : t));
  }
  // Two passes of a box filter: a smooth, tent-shaped kernel.
  const half = Math.max(1, Math.round(src.smoothingM / FINE_STEP / 2));
  const heading = movingAverage(movingAverage(fine, half), half);
  const kappa = heading.map((_h, k) => {
    const a = heading[k === 0 ? 0 : k - 1] as number;
    const b = heading[k === heading.length - 1 ? k : k + 1] as number;
    const span = (k === 0 || k === heading.length - 1 ? 1 : 2) * FINE_STEP;
    return (b - a) / span;
  });
  const first = src.points[0] as readonly [number, number];
  const x: number[] = [first[0]];
  const z: number[] = [first[1]];
  for (let k = 1; k < heading.length; k++) {
    const m = ((heading[k - 1] as number) + (heading[k] as number)) / 2;
    x.push((x[k - 1] as number) + sin(m) * FINE_STEP);
    z.push((z[k - 1] as number) - cos(m) * FINE_STEP);
  }
  return { step: FINE_STEP, length: n * FINE_STEP, x, z, heading, kappa };
}

function sampleAt(arr: readonly number[], step: number, s: number): number {
  const u = s / step;
  let i = Math.floor(u);
  if (i >= arr.length - 1) i = arr.length - 2;
  if (i < 0) i = 0;
  const a = arr[i] as number;
  const b = arr[i + 1] as number;
  return a + (b - a) * (u - i);
}

/** Height of the humps at s, and its slope. The bump is 16u²(1−u)²: smooth, trig-free. */
export function humpProfile(humps: readonly HumpSource[], s: number): [number, number] {
  let y = 0;
  let g = 0;
  for (const h of humps) {
    const u = (s - (h.centreM - h.lengthM / 2)) / h.lengthM;
    if (u <= 0 || u >= 1) continue;
    const w = u * (1 - u);
    y += h.heightM * 16 * w * w;
    g += (h.heightM * 32 * w * (1 - 2 * u)) / h.lengthM;
  }
  return [y, g];
}

const provenance = (createdAt: string) => ({
  origin: 'agent',
  author: 'agent',
  createdAt,
  tool: { name: 'tools/road/bake.mjs', version: '1.0.0' },
  sources: [] as string[],
});

export interface CompiledTrack {
  network: Record<string, unknown> & { id: string };
  roads: (Record<string, unknown> & { id: string })[];
  route: Record<string, unknown> & { id: string };
}

/** Compiles a track into the three kinds of baked files, as plain JSON-ready objects. */
export function compileTrack(src: TrackSource): CompiledTrack {
  const line = buildCentreline(src);
  const netId = src.network.id;
  // Cut the main curve into roads.
  const cuts: { road: RoadSource; start: number; length: number }[] = [];
  let at = 0;
  src.roads.forEach((road, i) => {
    const isLast = i === src.roads.length - 1;
    const length = isLast ? line.length - at : (road.lengthM ?? 0);
    if (!(length > 0) || at + length > line.length + 1e-9) {
      throw new Error(`road ${road.id}: length ${length} does not fit the ${line.length} m curve`);
    }
    cuts.push({ road, start: at, length });
    at += length;
  });

  // Humps are zero at road ends, so every junction sits at the base elevation.
  const junctionAt = (s: number, n: number) => ({
    id: `j-${netId}-${n}`,
    x: r4(sampleAt(line.x, line.step, s)),
    y: r4(src.baseElevationM),
    z: r4(sampleAt(line.z, line.step, s)),
  });

  const junctions = cuts.map((c, n) => junctionAt(c.start, n));
  const endCut = cuts[cuts.length - 1];
  if (!endCut) throw new Error('a track needs at least one road');
  junctions.push(junctionAt(endCut.start + endCut.length, cuts.length));

  const roads = cuts.map(({ road, start, length }, n) => {
    const intervals = Math.max(1, Math.round(length / src.spacingM));
    const spacing = length / intervals;
    const cols = {
      x: [] as number[],
      y: [] as number[],
      z: [] as number[],
      kappa: [] as number[],
      grade: [] as number[],
      bankRad: [] as number[],
    };
    for (let i = 0; i <= intervals; i++) {
      const sLocal = i === intervals ? length : i * spacing;
      const s = start + sLocal;
      const [hy, hg] = humpProfile(road.humps, sLocal);
      cols.x.push(r4(sampleAt(line.x, line.step, s)));
      cols.y.push(r4(src.baseElevationM + hy));
      cols.z.push(r4(sampleAt(line.z, line.step, s)));
      cols.kappa.push(sig7(sampleAt(line.kappa, line.step, s)));
      cols.grade.push(sig7(hg));
      cols.bankRad.push(0);
    }
    const end = (v: number | 'end'): number => (v === 'end' ? length : v);
    return {
      type: 'road',
      id: road.id,
      name: road.name,
      realName: null,
      network: netId,
      from: `j-${netId}-${n}`,
      to: `j-${netId}-${n + 1}`,
      lengthM: length,
      sampleSpacingM: spacing,
      speedLimitMps: road.speedLimitMps,
      surface: road.surface,
      laneSections: [{ s0: 0, lanes: src.lanes }],
      tags: road.tags.map((t) => ({ ...t, s1: end(t.s1) })),
      features: road.features,
      barriers: road.barriers.map((b) => ({ ...b, s1: end(b.s1) })),
      samples: { encoding: 'json-columns', columns: Object.keys(cols), data: cols },
      provenance: provenance(src.createdAt),
      meta: {
        status: 'live',
        notes: `Hand-authored M1 track, compiled from Catmull-Rom control points by tools/road/bake.mjs (source: tools/road/tracks/${netId}.ts). Edit the source and re-bake; never edit these samples by hand.`,
      },
    };
  });

  const network = {
    type: 'road-network',
    id: netId,
    name: src.network.name,
    region: src.network.region,
    crs: src.network.crs,
    chunking: { kind: 'none' },
    roads: cuts.map((c) => c.road.id),
    junctions: junctions.map((j, i) => {
      const prev = cuts[i - 1];
      const next = cuts[i];
      return {
        ...j,
        ends: [
          ...(prev ? [{ road: prev.road.id, end: 'to' }] : []),
          ...(next ? [{ road: next.road.id, end: 'from' }] : []),
        ],
        connectors: [],
        control: 'none',
      };
    }),
    provenance: provenance(src.createdAt),
    meta: { status: 'live', notes: src.network.notes },
  };

  const lengthOf = (id: string): number => {
    const c = cuts.find((k) => k.road.id === id);
    if (!c) throw new Error(`route ${src.route.id}: no road ${id}`);
    return c.length;
  };
  const r = src.route;
  const finishS = r.finish.s < 0 ? lengthOf(r.finish.road) + r.finish.s : r.finish.s;
  const route = {
    type: 'route',
    id: r.id,
    network: netId,
    start: r.start,
    finish: { road: r.finish.road, s: r4(finishS) },
    mainPath: cuts.map((c) => c.road.id),
    allowedRoads: cuts.map((c) => c.road.id),
    checkpoints: r.checkpoints,
    closed: false,
    startGrid: r.startGrid,
    meta: { status: 'live' },
  };
  return { network, roads, route };
}
