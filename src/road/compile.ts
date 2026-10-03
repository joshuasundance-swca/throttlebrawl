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
// Elevation is a base height plus smooth humps and ramp lips over each road's own s, and grade is
// its exact derivative.
//
// Branches (M1 road-2): a main-road piece marked `connector` is a junction's connector road. A
// branch leaves the `to` end of the road before one such piece and rejoins the `from` end of the
// road after another. Its curve is a smooth turn, a straight and a smooth turn, solved (Newton, on
// the turn angle and the straight's length) to start and end offset beside the main road with the
// main road's heading. Its first and last roads are the two junctions' connector roads, and the
// compiler writes each junction's lane-level table: main-through rows for every drive lane (both
// directions) and one row into and out of the branch, the first with the split zone.
import { atan2, cos, sin, type LaneInfo, type RoadSurface, type RouteBranchKind } from '../core';
import type { BakedBarrier, BakedFeature, BakedTag } from './types';

/**
 * A ramp lip baked into the elevation (docs/content-packs.md, "Features"): a kicker rising
 * `heightM` over `lengthM` with a steepening slope (y = h·u²), then a back that drops to the base
 * over `backM`. The compiler adds the matching `ramp` feature across the road's width.
 */
export interface RampSource {
  id: string;
  /** Where the kicker starts, in the road's own s. */
  s0: number;
  lengthM: number;
  heightM: number;
  backM: number;
}

/** A smooth hump: zero value and slope at both ends, peak `heightM` at `centreM`. */
export interface HumpSource {
  centreM: number;
  lengthM: number;
  heightM: number;
}

/**
 * A raised deck (run W-U, the pitch deck's #12: up the ferry's ramp, across its deck and off the far
 * ramp): the road rises `heightM` over `upM` from `s0` on a smooth S (zero slope and curvature at
 * both ends of the rise), stays level for `lengthM`, then comes down over `downM` the same way. No lip,
 * so nothing launches off it but the crest rule's own physics (a fast bike floats off the top of
 * the far ramp).
 */
export interface DeckSource {
  s0: number;
  upM: number;
  lengthM: number;
  downM: number;
  heightM: number;
}

export interface RoadSource {
  id: string;
  name: string;
  /** Length cut from the main curve. The last road takes whatever is left. */
  lengthM?: number;
  speedLimitMps: number;
  surface: RoadSurface;
  /** A junction's connector road (on the main list: between the two roads it joins). */
  connector?: boolean;
  /**
   * This road's own lanes, in place of the track's (or the branch's): a multi-lane highway stretch
   * (W-R; interview, 2026-10-02: "multi-lane highways (4-6 lanes, lane splitting)"). Lanes carry over
   * a pass-through join by id, so a highway keeps the track's inner lanes where it meets a two-lane
   * road; traffic merges out of the lanes that end there (sim/traffic).
   */
  lanes?: readonly LaneInfo[];
  /**
   * Where this road's lanes change along it (a highway gaining a lane each way at a time, W-R): lane
   * sections in s order, the first at s 0. In place of `lanes` and the track's lanes.
   */
  laneSections?: readonly { s0: number; lanes: readonly LaneInfo[] }[];
  humps: readonly HumpSource[];
  ramps?: readonly RampSource[];
  /** Raised decks (a ferry's): a smooth rise, a level deck, a smooth fall. */
  decks?: readonly DeckSource[];
  /** Tag ranges; an s1 of 'end' means the road's end. */
  tags: readonly (Omit<BakedTag, 's1'> & { s1: number | 'end' })[];
  features: readonly BakedFeature[];
  barriers: readonly (Omit<BakedBarrier, 's1'> & { s1: number | 'end' })[];
}

export interface RouteSource {
  id: string;
  /** The route's display name (the race-setup picker shows it); none on the older tracks. */
  name?: string;
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
  /** Side roads that split off the main road and rejoin it (road-2's ramp shortcut). */
  branches?: readonly BranchSource[];
  /**
   * The routes on this network, in order (road-3: one per race length). Each runs along the main
   * road from its start road to its finish road; it allows those roads, the connectors between
   * them, and every branch that leaves and rejoins inside that stretch.
   */
  routes: readonly RouteSource[];
}

/** A branch off the main road: it splits at one connector junction and rejoins at another. */
export interface BranchSource {
  /**
   * The main road whose `to` end the branch leaves (the next main road must be a connector), the
   * lateral offset on that road where the branch centreline starts, the main lane its row names,
   * and the split zone: the last `lengthM` of the road, between d0 and d1. Run W-U (the Keys'
   * secret island, found from a marked shortcut): the road may instead be a road of an EARLIER
   * branch in the list, whose next road there is a connector (a branch off a branch).
   */
  leave: {
    road: string;
    offsetM: number;
    lane: string;
    zone: { lengthM: number; d0: number; d1: number };
  };
  /**
   * The main road whose `from` end the branch rejoins (the previous main road must be a connector),
   * or, for a branch off a branch, a road of that same earlier branch past its leave.
   */
  join: { road: string; offsetM: number; lane: string };
  /** Lengths of the smooth turns at the branch's two ends, metres. */
  turnsM: readonly [number, number];
  /**
   * Points the branch passes through on its way, in order (run W-U): world x and z, the heading
   * there in degrees (0 north, 90 east) and the length of the smooth turns either side of it. The
   * curve is a turn, a straight and a turn between each pair of points, so a branch with a via point
   * may bow out past the chord of a bend (a loop out to an island). None: one turn, straight, turn.
   */
  via?: readonly { x: number; z: number; headingDeg: number; turnM: number }[];
  lanes: readonly LaneInfo[];
  /**
   * Roads cut from the branch curve, in order; the first and last are the junctions' connector
   * roads. Every road but the last needs `lengthM`; the last takes what is left. A middle road
   * marked `connector` (run W-U) is a junction where a later branch leaves or rejoins this one:
   * the roads either side of it meet there, with a through row for each of the branch's lanes.
   */
  roads: readonly RoadSource[];
  /**
   * The branch as the routes name it (W-R; interview, 2026-10-02: "junction choices in races"):
   * every route that allows it lists it in `branches` with these, and its roads.
   */
  named?: { id: string; kind?: RouteBranchKind; marked?: boolean; sign?: string };
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

/** Height of the ramps at s, and its slope (docs on RampSource). */
export function rampProfile(ramps: readonly RampSource[], s: number): [number, number] {
  let y = 0;
  let g = 0;
  for (const r of ramps) {
    const lip = r.s0 + r.lengthM;
    if (s > r.s0 && s <= lip) {
      const u = (s - r.s0) / r.lengthM;
      y += r.heightM * u * u;
      g += (2 * r.heightM * u) / r.lengthM;
    } else if (s > lip && s < lip + r.backM) {
      const v = 1 - (s - lip) / r.backM;
      y += r.heightM * v * v;
      g -= (2 * r.heightM * v) / r.backM;
    }
  }
  return [y, g];
}

/** The ramp feature a RampSource marks: its whole range, across the road's lanes. */
function rampFeature(r: RampSource, lanes: readonly LaneInfo[]): BakedFeature {
  let d0 = 0;
  let d1 = 0;
  for (const l of lanes) {
    d0 = Math.min(d0, l.dCenterM - l.widthM / 2);
    d1 = Math.max(d1, l.dCenterM + l.widthM / 2);
  }
  return { kind: 'ramp', id: r.id, s0: r.s0, s1: r.s0 + r.lengthM + r.backM, d0, d1 };
}

/** The smoothstep integral 10t³ − 15t⁴ + 6t⁵ (0→1 with zero slope and curvature at both ends). */
const easeTurn = (t: number): number => t * t * t * (10 - 15 * t + 6 * t * t);
/** Its derivative, 30t²(1 − t)², which integrates to 1 over 0..1. */
const easeRate = (t: number): number => 30 * t * t * (1 - t) * (1 - t);

/** Height of the decks at s, and its slope (docs on DeckSource). */
export function deckProfile(decks: readonly DeckSource[], s: number): [number, number] {
  let y = 0;
  let g = 0;
  for (const k of decks) {
    const top = k.s0 + k.upM;
    const off = top + k.lengthM;
    if (s <= k.s0 || s >= off + k.downM) continue;
    if (s < top) {
      const t = (s - k.s0) / k.upM;
      y += k.heightM * easeTurn(t);
      g += (k.heightM * easeRate(t)) / k.upM;
    } else if (s <= off) y += k.heightM;
    else {
      const t = (s - off) / k.downM;
      y += k.heightM * (1 - easeTurn(t));
      g -= (k.heightM * easeRate(t)) / k.downM;
    }
  }
  return [y, g];
}

interface BranchShape {
  h0: number;
  phi1: number;
  phi2: number;
  l1: number;
  ls: number;
  l2: number;
}

function headingAt(b: BranchShape, u: number): number {
  if (u <= b.l1) return b.h0 + b.phi1 * easeTurn(u / b.l1);
  if (u <= b.l1 + b.ls) return b.h0 + b.phi1;
  const t = (u - b.l1 - b.ls) / b.l2;
  return b.h0 + b.phi1 + b.phi2 * easeTurn(t > 1 ? 1 : t);
}

function kappaAt(b: BranchShape, u: number): number {
  if (u <= b.l1) return (b.phi1 / b.l1) * easeRate(u / b.l1);
  if (u <= b.l1 + b.ls) return 0;
  const t = (u - b.l1 - b.ls) / b.l2;
  return (b.phi2 / b.l2) * easeRate(t > 1 ? 1 : t);
}

/** Integrates a branch shape from (x0, z0) in n midpoint steps; returns the end point. */
function integrateBranch(b: BranchShape, x0: number, z0: number, n: number): [number, number] {
  const du = (b.l1 + b.ls + b.l2) / n;
  let x = x0;
  let z = z0;
  for (let k = 0; k < n; k++) {
    const h = headingAt(b, (k + 0.5) * du);
    x += sin(h) * du;
    z -= cos(h) * du;
  }
  return [x, z];
}

/**
 * The branch curve from (x0, z0) heading h0 to (x1, z1) heading h1: a smooth turn of l1 metres, a
 * straight, and a smooth turn of l2 metres. Newton solves the first turn's angle and the
 * straight's length so the end lands on the target; the second turn takes the rest of the heading.
 */
export function buildBranchCurve(
  x0: number,
  z0: number,
  h0: number,
  x1: number,
  z1: number,
  h1: number,
  l1: number,
  l2: number,
): Centreline {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const chord = Math.sqrt(dx * dx + dz * dz);
  let hc = atan2(dx, -dz);
  while (hc - h0 > 3.141592653589793) hc -= 6.283185307179586;
  while (hc - h0 < -3.141592653589793) hc += 6.283185307179586;
  const n = Math.max(8, Math.round(chord / FINE_STEP));
  const shape = (phi1: number, ls: number): BranchShape => ({ h0, phi1, phi2: h1 - h0 - phi1, l1, ls, l2 });
  let phi1 = hc - h0;
  let ls = chord - (l1 + l2) / 2;
  for (let iter = 0; iter < 40; iter++) {
    const [ex, ez] = integrateBranch(shape(phi1, ls), x0, z0, n);
    const rx = ex - x1;
    const rz = ez - z1;
    if (rx * rx + rz * rz < 1e-18) break;
    const ep = 1e-7;
    const el = 1e-5;
    const [px, pz] = integrateBranch(shape(phi1 + ep, ls), x0, z0, n);
    const [lx, lz] = integrateBranch(shape(phi1, ls + el), x0, z0, n);
    const a = (px - ex) / ep;
    const c = (pz - ez) / ep;
    const bb = (lx - ex) / el;
    const d = (lz - ez) / el;
    const det = a * d - bb * c;
    if (det === 0) throw new Error('branch: the turn and straight cannot reach the target');
    phi1 -= (d * rx - bb * rz) / det;
    ls -= (-c * rx + a * rz) / det;
  }
  if (!(ls > 0)) throw new Error(`branch: no room for a straight (${ls} m); shorten the turns`);
  const b = shape(phi1, ls);
  const [ex, ez] = integrateBranch(b, x0, z0, n);
  const miss = Math.sqrt((ex - x1) * (ex - x1) + (ez - z1) * (ez - z1));
  if (miss > 1e-3) throw new Error(`branch: the curve misses its target by ${miss} m`);
  const length = l1 + ls + l2;
  const du = length / n;
  const x: number[] = [x0];
  const z: number[] = [z0];
  const heading: number[] = [h0];
  const kappa: number[] = [kappaAt(b, 0)];
  for (let k = 1; k <= n; k++) {
    const h = headingAt(b, (k - 0.5) * du);
    x.push((x[k - 1] as number) + sin(h) * du);
    z.push((z[k - 1] as number) - cos(h) * du);
    heading.push(headingAt(b, k * du));
    kappa.push(kappaAt(b, k * du));
  }
  return { step: du, length, x, z, heading, kappa };
}

/**
 * A branch through via points (run W-U): one turn-straight-turn curve between each pair of points,
 * joined end to end (each via point's heading is both curves' heading there, and every turn eases
 * to zero curvature at its ends, so the joins are smooth), then resampled at one even step.
 */
export function buildBranchPath(
  points: readonly { x: number; z: number; h: number }[],
  turns: readonly (readonly [number, number])[],
): Centreline {
  const parts: Centreline[] = [];
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k] as { x: number; z: number; h: number };
    const b = points[k + 1] as { x: number; z: number; h: number };
    const t = turns[k] as readonly [number, number];
    parts.push(buildBranchCurve(a.x, a.z, a.h, b.x, b.z, b.h, t[0], t[1]));
  }
  if (parts.length === 1) return parts[0] as Centreline;
  const length = parts.reduce((sum, p) => sum + p.length, 0);
  const n = Math.max(8, Math.round(length / FINE_STEP));
  const du = length / n;
  const out: Centreline = { step: du, length, x: [], z: [], heading: [], kappa: [] };
  let k = 0;
  let before = 0;
  for (let i = 0; i <= n; i++) {
    const u = i === n ? length : i * du;
    while (k < parts.length - 1 && u > before + (parts[k] as Centreline).length) {
      before += (parts[k] as Centreline).length;
      k++;
    }
    const p = parts[k] as Centreline;
    const local = Math.min(p.length, Math.max(0, u - before));
    out.x.push(sampleAt(p.x, p.step, local));
    out.z.push(sampleAt(p.z, p.step, local));
    out.heading.push(sampleAt(p.heading, p.step, local));
    out.kappa.push(sampleAt(p.kappa, p.step, local));
  }
  return out;
}

const DEG = 3.141592653589793 / 180;

const provenance = (createdAt: string) => ({
  origin: 'agent',
  author: 'agent',
  createdAt,
  tool: { name: 'tools/road/bake.mjs', version: '1.1.0' },
  sources: [] as string[],
});

export interface CompiledTrack {
  network: Record<string, unknown> & { id: string };
  roads: (Record<string, unknown> & { id: string })[];
  routes: (Record<string, unknown> & { id: string })[];
}

interface Cut {
  road: RoadSource;
  line: Centreline;
  start: number;
  length: number;
  lanes: readonly LaneInfo[];
  from: string;
  to: string;
}

/**
 * Cuts a curve into consecutive roads. One road may leave out `lengthM` and take whatever the
 * others leave; if every road but the last gives one, the last takes the rest.
 */
function cutCurve(line: Centreline, roads: readonly RoadSource[], lanes: readonly LaneInfo[]): Cut[] {
  const open = roads.filter((r) => r.lengthM === undefined);
  const fixed = roads.reduce((sum, r) => sum + (r.lengthM ?? 0), 0);
  const cuts: Cut[] = [];
  let at = 0;
  roads.forEach((road, i) => {
    const isLast = i === roads.length - 1;
    const takesRest = open.length === 0 ? isLast : road.lengthM === undefined;
    const length =
      open.length === 0 && isLast ? line.length - at : takesRest ? line.length - fixed : (road.lengthM ?? 0);
    if (open.length > 1) throw new Error(`only one road may leave out lengthM (${road.id})`);
    if (!(length > 0) || at + length > line.length + 1e-9) {
      throw new Error(`road ${road.id}: length ${length} does not fit the ${line.length} m curve`);
    }
    const own = road.laneSections?.[0]?.lanes ?? road.lanes ?? lanes;
    cuts.push({ road, line, start: at, length, lanes: own, from: '', to: '' });
    at += length;
  });
  return cuts;
}

/**
 * A branch must rejoin in a lane that runs the route's way (run W-U's live check, mustFix 1: the
 * Keys' Mangrove Boardwalk rejoined in the oncoming lane, d -3, and riders came off it head-on into
 * traffic). Every chain runs its route along increasing s, so the join's lane must be a drive or
 * shortcut lane of direction +1 on the road it rejoins, and the middle of the branch's own travel
 * lanes must land inside it. tools/road/branch-rejoins.test.ts checks the baked landing on every
 * live network, map-data ones included.
 */
function checkRejoin(br: BranchSource, roadId: string, lanes: readonly LaneInfo[]): void {
  const id = br.roads[0]?.id;
  const lane = lanes.find((l) => l.id === br.join.lane);
  const travel = (l: LaneInfo) => l.direction === 1 && (l.kind === 'drive' || l.kind === 'shortcut');
  if (!lane) throw new Error(`branch ${id}: it rejoins ${roadId} in lane ${br.join.lane}, which it lacks`);
  if (!travel(lane)) {
    throw new Error(
      `branch ${id}: it rejoins ${roadId} in lane ${lane.id}, which is oncoming or not a travel lane`,
    );
  }
  const own = br.lanes.filter(travel);
  const lo = Math.min(...own.map((l) => l.dCenterM - l.widthM / 2));
  const hi = Math.max(...own.map((l) => l.dCenterM + l.widthM / 2));
  const mid = br.join.offsetM + (own.length > 0 ? (lo + hi) / 2 : 0);
  const inside = (l: LaneInfo) => mid >= l.dCenterM - l.widthM / 2 && mid <= l.dCenterM + l.widthM / 2;
  if (!inside(lane)) {
    const oncoming = lanes.find((l) => l.direction === -1 && l.kind === 'drive' && inside(l));
    throw new Error(
      `branch ${id}: it rejoins ${roadId} at d ${mid}, outside lane ${lane.id}` +
        (oncoming ? `, in the oncoming lane ${oncoming.id}` : ''),
    );
  }
}

/** Compiles a track into the three kinds of baked files, as plain JSON-ready objects. */
export function compileTrack(src: TrackSource): CompiledTrack {
  const line = buildCentreline(src);
  const netId = src.network.id;
  const main = cutCurve(line, src.roads, src.lanes);
  if (main.length === 0) throw new Error('a track needs at least one road');

  type JunctionOut = {
    id: string;
    x: number;
    y: number;
    z: number;
    ends: { road: string; end: 'from' | 'to' }[];
    connectors: Record<string, unknown>[];
  };
  const junctions: JunctionOut[] = [];
  const point = (l: Centreline, s: number) => ({
    x: r4(sampleAt(l.x, l.step, s)),
    y: r4(src.baseElevationM),
    z: r4(sampleAt(l.z, l.step, s)),
  });
  const newJunction = (at: { x: number; y: number; z: number }): JunctionOut => {
    const j = { id: `j-${netId}-${junctions.length}`, ...at, ends: [], connectors: [] };
    junctions.push(j);
    return j;
  };
  // Main-road junctions, in order: a connector piece and the roads either side share one junction
  // (at the piece's middle); every other boundary is a pass-through join. Humps and ramps are zero
  // at road ends, so every junction sits at the base elevation.
  const junctionOfConnector = new Map<number, JunctionOut>();
  const first = main[0] as Cut;
  const start = newJunction(point(line, 0));
  start.ends.push({ road: first.road.id, end: 'from' });
  first.from = start.id;
  for (let i = 0; i < main.length; i++) {
    const cut = main[i] as Cut;
    const next = main[i + 1];
    if (cut.road.connector) {
      const before = main[i - 1];
      if (!before || !next || before.road.connector || next.road.connector) {
        throw new Error(`connector ${cut.road.id} must sit between two ordinary roads`);
      }
      const j = newJunction(point(line, cut.start + cut.length / 2));
      junctionOfConnector.set(i, j);
      before.to = j.id;
      cut.from = j.id;
      cut.to = j.id;
      next.from = j.id;
      j.ends.push({ road: before.road.id, end: 'to' }, { road: next.road.id, end: 'from' });
      for (const lane of cut.lanes) {
        if (lane.kind !== 'drive') continue;
        j.connectors.push({
          id: `cx-${cut.road.id}-${lane.id.toLowerCase()}`,
          road: cut.road.id,
          from: { road: before.road.id, end: 'to', lane: lane.id },
          to: { road: next.road.id, end: 'from', lane: lane.id },
        });
      }
      continue;
    }
    if (next && !next.road.connector) {
      const j = newJunction(point(line, cut.start + cut.length));
      j.ends.push({ road: cut.road.id, end: 'to' }, { road: next.road.id, end: 'from' });
      cut.to = j.id;
      next.from = j.id;
    }
  }
  const lastCut = main[main.length - 1] as Cut;
  const endJ = newJunction(point(line, lastCut.start + lastCut.length));
  endJ.ends.push({ road: lastCut.road.id, end: 'to' });
  lastCut.to = endJ.id;

  // Branches: the curve, its roads, and their rows in the two junctions' tables.
  const branchCuts: Cut[] = [];
  /** Each branch's roads, with the main-road indices it leaves after and rejoins at. */
  const branchSpans: { leave: number; join: number; ids: string[]; named?: BranchSource['named'] }[] = [];
  const offsetPoint = (l: Centreline, s: number, offset: number): [number, number, number] => {
    const h = sampleAt(l.heading, l.step, s);
    // The right of heading h (0 = north, + toward east) is (cos h, sin h) in (x, z).
    return [sampleAt(l.x, l.step, s) + offset * cos(h), sampleAt(l.z, l.step, s) + offset * sin(h), h];
  };
  // Each road's chain (the main road, or a branch's roads), its place there and the chain's
  // connector junctions by index, so a later branch can leave or rejoin a branch (run W-U).
  type Chain = {
    cuts: Cut[];
    junctions: Map<number, JunctionOut>;
    span: (typeof branchSpans)[number] | null;
  };
  const chainOf = new Map<string, { chain: Chain; i: number }>();
  const mainChain: Chain = { cuts: main, junctions: junctionOfConnector, span: null };
  main.forEach((c, i) => chainOf.set(c.road.id, { chain: mainChain, i }));
  for (const br of src.branches ?? []) {
    const at = chainOf.get(br.leave.road);
    const to = chainOf.get(br.join.road);
    const chain = at?.chain;
    const ai = at?.i ?? -1;
    const bi = to?.i ?? -1;
    const a = chain?.cuts[ai];
    const b = chain?.cuts[bi];
    const jSplit = chain?.junctions.get(ai + 1);
    const jMerge = chain?.junctions.get(bi - 1);
    if (!chain || to?.chain !== chain || !a || !b || !jSplit || !jMerge || bi <= ai) {
      throw new Error(
        `branch ${br.roads[0]?.id}: leave and join need a connector piece after and before them`,
      );
    }
    if (br.roads.length < 3) throw new Error('a branch needs a connector, a road and a connector');
    if (chain.span && br.named)
      throw new Error(`branch ${br.roads[0]?.id}: a branch off a branch is not named`);
    checkRejoin(br, b.road.id, b.lanes);
    const [x0, z0, h0] = offsetPoint(a.line, a.start + a.length, br.leave.offsetM);
    const [x1, z1, h1] = offsetPoint(b.line, b.start, br.join.offsetM);
    const via = br.via ?? [];
    const curve =
      via.length === 0
        ? buildBranchCurve(x0, z0, h0, x1, z1, h1, br.turnsM[0], br.turnsM[1])
        : buildBranchPath(
            [
              { x: x0, z: z0, h: h0 },
              ...via.map((v) => ({ x: v.x, z: v.z, h: v.headingDeg * DEG })),
              { x: x1, z: z1, h: h1 },
            ],
            via
              .map((v, k) => [k === 0 ? br.turnsM[0] : (via[k - 1]?.turnM ?? 0), v.turnM] as const)
              .concat([[via[via.length - 1]?.turnM ?? 0, br.turnsM[1]]]),
          );
    const cuts = cutCurve(curve, br.roads, br.lanes);
    const kIn = cuts[0] as Cut;
    const kOut = cuts[cuts.length - 1] as Cut;
    const firstRoad = cuts[1] as Cut;
    const lastRoad = cuts[cuts.length - 2] as Cut;
    const lane = (br.lanes.find((l) => l.kind === 'shortcut') ?? br.lanes[0])?.id ?? '';
    kIn.from = jSplit.id;
    kIn.to = jSplit.id;
    firstRoad.from = jSplit.id;
    kOut.from = jMerge.id;
    kOut.to = jMerge.id;
    lastRoad.to = jMerge.id;
    const own = new Map<number, JunctionOut>();
    for (let i = 1; i < cuts.length - 2; i++) {
      const c = cuts[i] as Cut;
      const n = cuts[i + 1] as Cut;
      if (c.road.connector) continue;
      if (n.road.connector) {
        // A connector piece inside the branch (run W-U): a junction where a later branch leaves or
        // rejoins this one, with a through row per lane.
        const m = cuts[i + 2];
        if (i + 2 > cuts.length - 2 || !m || m.road.connector) {
          throw new Error(`connector ${n.road.id} must sit between two ordinary roads`);
        }
        const j = newJunction(point(curve, n.start + n.length / 2));
        own.set(i + 1, j);
        c.to = j.id;
        n.from = j.id;
        n.to = j.id;
        m.from = j.id;
        j.ends.push({ road: c.road.id, end: 'to' }, { road: m.road.id, end: 'from' });
        for (const l of n.lanes) {
          if (l.kind !== 'drive' && l.kind !== 'shortcut') continue;
          j.connectors.push({
            id: `cx-${n.road.id}-${l.id.toLowerCase()}`,
            road: n.road.id,
            from: { road: c.road.id, end: 'to', lane: l.id },
            to: { road: m.road.id, end: 'from', lane: l.id },
          });
        }
        continue;
      }
      const j = newJunction(point(curve, c.start + c.length));
      j.ends.push({ road: c.road.id, end: 'to' }, { road: n.road.id, end: 'from' });
      c.to = j.id;
      n.from = j.id;
    }
    jSplit.ends.push({ road: firstRoad.road.id, end: 'from' });
    jSplit.connectors.push({
      id: `cx-${kIn.road.id}`,
      road: kIn.road.id,
      from: { road: a.road.id, end: 'to', lane: br.leave.lane },
      to: { road: firstRoad.road.id, end: 'from', lane },
      splitZone: {
        s0: r4(a.length - br.leave.zone.lengthM),
        s1: a.length,
        d0: br.leave.zone.d0,
        d1: br.leave.zone.d1,
      },
    });
    jMerge.ends.push({ road: lastRoad.road.id, end: 'to' });
    jMerge.connectors.push({
      id: `cx-${kOut.road.id}`,
      road: kOut.road.id,
      from: { road: lastRoad.road.id, end: 'to', lane },
      to: { road: b.road.id, end: 'from', lane: br.join.lane },
    });
    branchCuts.push(...cuts);
    const ids = cuts.map((c) => c.road.id);
    let span = chain.span;
    if (span) {
      // A branch off a branch is part of it: a route allows it with its parent, under its name.
      span.ids.push(...ids);
    } else {
      span = { leave: ai, join: bi, ids, ...(br.named ? { named: br.named } : {}) };
      branchSpans.push(span);
    }
    const branchChain: Chain = { cuts, junctions: own, span };
    cuts.forEach((c, i) => chainOf.set(c.road.id, { chain: branchChain, i }));
  }

  const roads = [...main, ...branchCuts].map((cut) => {
    const { road, line: l, start, length } = cut;
    const intervals = Math.max(1, Math.round(length / src.spacingM));
    const spacing = length / intervals;
    // A ramp's lip lands on a sample, so the sampled surface keeps its full height and its kink.
    const ramps = (road.ramps ?? []).map((r) => {
      const lip = Math.round((r.s0 + r.lengthM) / spacing) * spacing;
      return { ...r, s0: r4(lip - r.lengthM) };
    });
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
      const [ry, rg] = rampProfile(ramps, sLocal);
      const [ky, kg] = deckProfile(road.decks ?? [], sLocal);
      cols.x.push(r4(sampleAt(l.x, l.step, s)));
      cols.y.push(r4(src.baseElevationM + hy + ry + ky));
      cols.z.push(r4(sampleAt(l.z, l.step, s)));
      cols.kappa.push(sig7(sampleAt(l.kappa, l.step, s)));
      cols.grade.push(sig7(hg + rg + kg));
      cols.bankRad.push(0);
    }
    const end = (v: number | 'end'): number => (v === 'end' ? length : v);
    const features = [...road.features, ...ramps.map((r) => rampFeature(r, cut.lanes))];
    return {
      type: 'road',
      id: road.id,
      name: road.name,
      realName: null,
      network: netId,
      from: cut.from,
      to: cut.to,
      lengthM: length,
      sampleSpacingM: spacing,
      speedLimitMps: road.speedLimitMps,
      surface: road.surface,
      laneSections: road.laneSections
        ? road.laneSections.map((sec) => ({ s0: sec.s0, lanes: sec.lanes.map((l) => ({ ...l })) }))
        : [{ s0: 0, lanes: cut.lanes.map((l) => ({ ...l })) }],
      tags: road.tags.map((t) => ({ ...t, s1: end(t.s1) })),
      features,
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
    roads: roads.map((r) => r.id),
    junctions: junctions.map((j) => ({ ...j, control: 'none' })),
    provenance: provenance(src.createdAt),
    meta: { status: 'live', notes: src.network.notes },
  };

  const routes = src.routes.map((r) => {
    const indexOf = (id: string): number => {
      const i = main.findIndex((k) => k.road.id === id && !k.road.connector);
      if (i < 0) throw new Error(`route ${r.id}: no main road ${id}`);
      return i;
    };
    const first = indexOf(r.start.road);
    const last = indexOf(r.finish.road);
    if (last < first) throw new Error(`route ${r.id}: the finish road comes before the start road`);
    const span = main.slice(first, last + 1);
    const allowed = new Set(span.map((c) => c.road.id));
    for (const b of branchSpans) {
      if (b.leave >= first && b.join <= last) for (const id of b.ids) allowed.add(id);
    }
    const finishCut = main[last] as Cut;
    const finishS = r.finish.s < 0 ? finishCut.length + r.finish.s : r.finish.s;
    // The named branches this route allows (W-R junction choices), in branch order.
    const branches = branchSpans
      .filter((b) => b.named && b.leave >= first && b.join <= last)
      .map((b) => ({ ...b.named, roads: b.ids }));
    return {
      type: 'route',
      id: r.id,
      ...(r.name ? { name: r.name } : {}),
      network: netId,
      start: r.start,
      finish: { road: r.finish.road, s: r4(finishS) },
      mainPath: span.filter((c) => !c.road.connector).map((c) => c.road.id),
      // In the network's road order, so the full route lists every road as before.
      allowedRoads: roads.map((x) => x.id).filter((id) => allowed.has(id)),
      checkpoints: r.checkpoints,
      ...(branches.length > 0 ? { branches } : {}),
      closed: false,
      startGrid: r.startGrid,
      meta: { status: 'live' },
    };
  });
  return { network, roads, routes };
}
