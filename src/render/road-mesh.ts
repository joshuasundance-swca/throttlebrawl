// The road as meshes (M1 render-1): surfaces from the road profiles, markings, posts, bridge rails,
// deck fascias and pylons, the ramp's warning stripes and the sea. Geometry is merged per material
// within each square chunk of the world (M2; docs/architecture.md, "Performance budgets": merged
// static geometry per chunk), so the draw calls per chunk stay flat however many edges pass through
// it, and the renderer culls the chunks the camera cannot see: a frame's road cost does not grow
// with the length of the road.
import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import type { Edge, RoadNetwork } from '../road';
import type { LaneInfo } from '../sim/api';
import { ChunkedStrips, mergeBoxes, type BoxPart, type Point3 } from './geometry';
import { EdgeLocator } from './overlap';
import type { LookStyle, MaterialKind } from './look';

/** Surface higher than this above sea level (world y = 0) counts as a bridge deck. */
export const ELEVATED_M = 2.5;
/** Metres of shoulder beyond the outermost lane, drawn as verge. */
const VERGE_M = 0.6;
const STEP_M = 2;
/**
 * Land under roadside zones (playtest 1b). The zone's side reaches its far edge plus a pedestrian's
 * dive (sim peds: 3.5 m) and some body width; the far side reaches where a crossing pedestrian
 * stops (about 2.6 m past the drivable edge) plus a dive. [default]
 */
const LAND_DIVE_M = 4.5;
const LAND_FAR_M = 7;
/** Metres over which a land strip tapers into the verge past each end of its zone. */
const LAND_TAPER_M = 8;
/** Land sits 4 cm under the verge (-0.02) and any overlapping road, so none of them flicker. */
const LAND_LIFT_M = -0.06;
/** Boost pads sit above the lane markings (0.03) and the ramp stripes (0.04). */
const BOOST_LIFT_M = 0.045;

export interface BarrierSpan {
  s0: number;
  s1: number;
  side: string;
  kind: string;
  heightM?: number;
}
export interface FeatureSpan {
  kind: string;
  s0: number;
  s1: number;
  d0: number;
  d1: number;
  /** A `billboard` slot's own id, and the region item or pool it shows (boards.ts). */
  id?: string | undefined;
  item?: string | undefined;
  pool?: string | undefined;
  /** Kind-specific numbers (a `rampTruck`'s `lipHeightM` and `rampLengthM`, a `boostPad`'s boost). */
  params?: Readonly<Record<string, unknown>> | undefined;
}
export interface TagSpan {
  s0: number;
  s1: number;
  side?: string;
  tag: string;
}
/** Per-road set dressing, structurally a subset of a road file (docs/content-packs.md). */
export interface EdgeDressing {
  barriers?: readonly BarrierSpan[] | undefined;
  features?: readonly FeatureSpan[] | undefined;
  tags?: readonly TagSpan[] | undefined;
}
/** Set dressing keyed by road id. Road files satisfy EdgeDressing, so app/ can pass them as-is. */
export type RoadDressing = Readonly<Record<string, EdgeDressing>>;

/**
 * The side of a road chunk, metres [default]: the architecture doc's visual-chunk grid. Smaller
 * culls more triangles but costs more draw calls. Measured on the real track from 20 chase-camera
 * spots with the far plane at the fog's end: 256 m chunks drew at most 72 road meshes and 37k
 * triangles, 512 m at most 48 and 41k. One mesh per material for the whole network drew every triangle
 * (64,832 on this track) from everywhere, and grows with the road.
 */
export const ROAD_CHUNK_M = 512;

/** The chunk a world point falls in. */
export function chunkKey(x: number, z: number): string {
  return `${Math.floor(x / ROAD_CHUNK_M)},${Math.floor(z / ROAD_CHUNK_M)}`;
}

export interface RoadSceneStats {
  meshes: number;
  /** Chunks with any static road geometry. */
  chunks: number;
  triangles: number;
  railM: number;
  rampStripes: number;
  pylons: number;
  /** Metres of road with a land strip beside it (roadside zones; walkways on railed sides excluded). */
  landM: number;
  /** Boost pads and ramp trucks drawn (playtest 1b quick wins). */
  boostPads: number;
  rampTrucks: number;
}

export interface RoadScene {
  group: Group;
  stats: RoadSceneStats;
  dispose(): void;
}

interface LaneSpans {
  drive: [number, number] | null;
  shortcut: [number, number] | null;
  /** Lines between adjacent drive lanes; `opposite` when the two lanes run opposite ways. */
  dividers: { d: number; opposite: boolean }[];
}

export function laneSpans(lanes: readonly LaneInfo[]): LaneSpans {
  const span = (kind: LaneInfo['kind']): [number, number] | null => {
    const ls = lanes.filter((l) => l.kind === kind);
    if (!ls.length) return null;
    return [
      Math.min(...ls.map((l) => l.dCenterM - l.widthM / 2)),
      Math.max(...ls.map((l) => l.dCenterM + l.widthM / 2)),
    ];
  };
  const drive = lanes.filter((l) => l.kind === 'drive').sort((a, b) => a.dCenterM - b.dCenterM);
  const dividers: LaneSpans['dividers'] = [];
  for (let i = 1; i < drive.length; i++) {
    const a = drive[i - 1];
    const b = drive[i];
    if (!a || !b) continue;
    dividers.push({
      d: (a.dCenterM + a.widthM / 2 + b.dCenterM - b.widthM / 2) / 2,
      opposite: a.direction !== b.direction,
    });
  }
  return { drive: span('drive'), shortcut: span('shortcut'), dividers };
}

/** Dressing for an edge: the explicit record, else fields the road module may carry on the edge. */
function dressingOf(edge: Edge, dressing: RoadDressing | undefined): EdgeDressing {
  const explicit = dressing?.[edge.id];
  if (explicit) return explicit;
  const carried = edge as Edge & EdgeDressing;
  return { barriers: carried.barriers, features: carried.features, tags: carried.tags };
}

function samplesOf(edge: Edge): number[] {
  const n = Math.max(1, Math.round(edge.length / STEP_M));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push((edge.length * i) / n);
  return out;
}

function sideHas(side: string | undefined, want: 'left' | 'right'): boolean {
  return side === undefined || side === 'both' || side === want;
}

/** Barrier spans for one side: explicit barriers, else bridge tags, else the elevation rule. */
function barriersFor(
  road: RoadNetwork,
  edge: Edge,
  dress: EdgeDressing,
  side: 'left' | 'right',
): BarrierSpan[] {
  if (dress.barriers) return dress.barriers.filter((b) => sideHas(b.side, side));
  const bridges = (dress.tags ?? []).filter((t) => t.tag === 'bridge' && sideHas(t.side, side));
  if (bridges.length) return bridges.map((t) => ({ s0: t.s0, s1: t.s1, side, kind: 'rail', heightM: 1 }));
  // No data: rail the stretches that stand clear of the water.
  const spans: BarrierSpan[] = [];
  let start = -1;
  const ss = samplesOf(edge);
  for (const s of ss) {
    const high = road.toWorld(edge.index, s, 0, 0).y >= ELEVATED_M;
    if (high && start < 0) start = s;
    if (!high && start >= 0) {
      spans.push({ s0: start, s1: s, side, kind: 'rail', heightM: 1 });
      start = -1;
    }
  }
  if (start >= 0) spans.push({ s0: start, s1: edge.length, side, kind: 'rail', heightM: 1 });
  return spans;
}

/** The shortcut surface sits this far above the main road, so the two never flicker where they overlap. */
export const SHORTCUT_LIFT_M = 0.05;
/** Lift of the painted split zone over the main road (under the lane markings at 0.03). */
const ZONE_LIFT_M = 0.015;
/** Width of a painted line, m. */
const LINE_M = 0.15;
/** How far down the shortcut the split zone's inner edge keeps bounding it, m. */
const GORE_REACH_M = 150;

/** The drawn span of an edge, verges included: what hides a surface drawn under it. */
function outerSpan(e: Edge): readonly [number, number] {
  return [e.dMin - VERGE_M, e.dMax + VERGE_M];
}

function hasShortcut(e: Edge): boolean {
  return e.sections.some((sec) => sec.lanes.some((l) => l.kind === 'shortcut'));
}

/** Across a join, the next edge's d = σ·d + dShift, where σ = −1 when the join flips orientation. */
function flipAt(leaving: 'from' | 'to', entersAt: 'from' | 'to'): number {
  return leaving === entersAt ? -1 : 1;
}

/**
 * Where a split zone's inner edge runs on the edges downstream of it, in each edge's own d: the
 * line between "stays on the main road" and "takes the shortcut" at the split, carried down the
 * shortcut while the two overlap. Keyed by edge index.
 */
function goreLines(road: RoadNetwork): Map<number, number> {
  const out = new Map<number, number>();
  for (const z of road.splitZones()) {
    const from = road.edges[z.edge];
    if (!from) continue;
    const link = (z.end === 'to' ? from.nextLinks : from.prevLinks).find((l) => l.edge === z.toEdge);
    if (!link) continue;
    const inner = Math.abs(z.d0) < Math.abs(z.d1) ? z.d0 : z.d1;
    let g = flipAt(z.end, link.entersAt) * inner + (link.dShift ?? 0);
    let edge = road.edges[link.edge];
    let enteredAt = link.entersAt;
    let travelled = 0;
    while (edge && travelled < GORE_REACH_M && !out.has(edge.index)) {
      out.set(edge.index, g);
      travelled += edge.length;
      const leaving = enteredAt === 'from' ? 'to' : 'from';
      const next = leaving === 'to' ? edge.next : edge.prev;
      if (!next) break;
      g = flipAt(leaving, next.entersAt) * g + (next.dShift ?? 0);
      edge = road.edges[next.edge];
      enteredAt = next.entersAt;
    }
  }
  return out;
}

/** Layers that share a material kind but are separate meshes, so tests (and looks) can tell them apart. */
type Layer = MaterialKind | 'splitZone' | 'splitMark' | 'boostPad' | 'boostMark';
const LAYER_KIND: Partial<Record<Layer, MaterialKind>> = {
  splitZone: 'shortcut',
  splitMark: 'marking',
  boostPad: 'boost',
  boostMark: 'marking',
};
const kindOf = (layer: Layer): MaterialKind => LAYER_KIND[layer] ?? (layer as MaterialKind);

/** The ramp truck's defaults, as the road lane's contract gives them (docs/content-packs.md). */
export const RAMP_TRUCK_DEFAULTS = { lipHeightM: 2.8, rampLengthM: 11.5 } as const;

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/**
 * A placeholder car-carrier tow truck whose rear deck is a jump ramp (playtest 1b), as boxes in
 * road space. The light deck rises from the road at s0 to the lip over the ramp length, then runs
 * flat at the lip to the front bumper at s1: exactly the deck the sim gives riders. Two cars ride
 * on the lower level under the flat deck, the cab sits under its front end.
 */
function rampTruckParts(road: RoadNetwork, edge: number, f: FeatureSpan): BoxPart[] {
  const lip = Math.max(0.3, num(f.params?.['lipHeightM'], RAMP_TRUCK_DEFAULTS.lipHeightM));
  const rampLen = Math.max(1, num(f.params?.['rampLengthM'], RAMP_TRUCK_DEFAULTS.rampLengthM));
  const len = Math.max(rampLen + 1, f.s1 - f.s0);
  const width = Math.abs(f.d1 - f.d0);
  const dMid = (f.d0 + f.d1) / 2;
  const heading = (u: number) => {
    const fr = road.frameAt(edge, f.s0 + u);
    return Math.atan2(-fr.tx, -fr.tz);
  };
  const DECK = '#efe6c8';
  const FRAME = '#4a4f57';
  const DARK = '#1f2226';
  const T = 0.1;
  const parts: BoxPart[] = [];
  /** A box centred at u along the truck, w across (right positive), h above the road. */
  const box = (u: number, w: number, h: number, size: [number, number, number], color: string, rotX = 0) => {
    const p = road.toWorld(edge, f.s0 + u, dMid + w, h);
    parts.push({ size: [size[0], size[1], size[2]], at: [p.x, p.y, p.z], color, rotX, rotY: heading(u) });
  };
  const pitch = Math.atan2(lip, rampLen);
  // The ramp: its top surface runs from the road at s0 up to the lip.
  box(
    rampLen / 2,
    0,
    lip / 2 - T / 2 / Math.cos(pitch),
    [width - 0.2, T, Math.hypot(rampLen, lip)],
    DECK,
    pitch,
  );
  // The flat deck from the ramp's top to the front.
  box((rampLen + len) / 2, 0, lip - T / 2, [width - 0.2, T, len - rampLen], DECK);
  // Frame: girders under the flat deck's edges, posts down to the chassis, the chassis and wheels.
  // Nothing pokes through the ramp: the chassis and wheels start where the ramp is 1.1 m up.
  const tall = Math.min(len - 1, (rampLen * 1.1) / lip);
  for (const w of [-1, 1]) {
    box((rampLen + len) / 2, w * (width / 2 - 0.2), lip - 0.45, [0.14, 0.6, len - rampLen], FRAME);
    for (const u of [rampLen * 0.6, rampLen, (rampLen + len) / 2, len - 3]) {
      if (u > len - 0.5 || u < tall) continue;
      const top = u < rampLen ? (lip * u) / rampLen : lip;
      box(u, w * (width / 2 - 0.25), (1 + top - T) / 2, [0.16, Math.max(0.1, top - T - 1), 0.16], FRAME);
    }
    for (const u of [tall + 0.6, tall + 2, len - 5, len - 1.6]) {
      if (u >= tall && u < len) box(u, w * (width / 2 - 0.35), 0.45, [0.5, 0.9, 0.9], DARK);
    }
  }
  box((tall + len) / 2, 0, 0.75, [Math.min(1.4, width - 0.8), 0.5, len - tall], DARK);
  // The cab under the front of the deck, and two cars on the lower level.
  const cabLen = Math.min(2.6, len - rampLen);
  const cabTop = Math.max(1, lip - T - 0.15);
  box(
    len - cabLen / 2,
    0,
    0.4 + (cabTop - 0.4) / 2,
    [Math.min(2.4, width - 0.2), cabTop - 0.4, cabLen],
    '#c8412e',
  );
  box(
    len - cabLen - 0.05,
    0,
    0.4 + (cabTop - 0.4) * 0.35,
    [Math.min(2.3, width - 0.3), 0.6, 0.12],
    '#bfe3f0',
  );
  const room = len - cabLen - rampLen;
  const carTop = Math.min(2.2, lip - T - 0.2);
  const carColors = ['#3b6fd1', '#e0c23a'];
  for (let i = 0; i < 2; i++) {
    const carLen = Math.min(3.8, room / 2 - 0.2);
    if (carLen < 1.5 || carTop < 1.5) break;
    const u = rampLen + (room * (i + 0.5)) / 2;
    box(u, 0, (1 + carTop) / 2, [Math.min(1.7, width - 0.6), carTop - 1, carLen], carColors[i] ?? '#888888');
  }
  return parts;
}

interface Clip {
  lo: number;
  hi: number;
  vergeL: boolean;
  vergeR: boolean;
  goreL: boolean;
  goreR: boolean;
}

export interface RoadSceneOptions {
  /** Roadside palms: 1 = one per PALM_SPACING_M a side, 0 = none (`render.roadsideDensity`). */
  roadsideDensity?: number;
}

/** Metres between roadside palms on one side at density 1. [default] */
const PALM_SPACING_M = 20;
/** Palms stand this far past the verge, plus up to PALM_SPREAD_M more. [default] */
const PALM_OFFSET_M = 2.2;
const PALM_SPREAD_M = 5;
/** Features a palm never stands in. */
const KEEP_CLEAR = new Set(['billboard', 'boostPad', 'rampTruck']);

/** A placeholder palm on its own little sand mound (so it can stand in the shallows). */
function palmGeometry() {
  const parts: BoxPart[] = [
    { size: [2.6, 1.2, 2.6], at: [0, -0.55, 0], color: '#d8c08c' },
    { size: [0.28, 2.4, 0.28], at: [0.1, 1.2, 0], color: '#8a6a45', rotX: 0.05 },
    { size: [0.24, 2.4, 0.24], at: [0.35, 3.4, 0.1], color: '#7d5f3d', rotX: -0.12 },
    { size: [3.2, 0.25, 0.9], at: [0.5, 4.7, 0.1], color: '#3f8f4a', rotY: 0.4 },
    { size: [0.9, 0.25, 3.2], at: [0.5, 4.75, 0.1], color: '#357d40', rotY: 0.4 },
  ];
  return mergeBoxes(parts);
}

/** A small deterministic hash to 0..1 (placement jitter; presentation only). */
function hash01(a: number, b: number, c: number): number {
  let h = Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(Math.round(b * 16) + 0x27d4eb2f, 0xc2b2ae35);
  h ^= Math.imul(c + 0x165667b1, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

export function buildRoadScene(
  road: RoadNetwork,
  look: LookStyle,
  dressing?: RoadDressing,
  opts: RoadSceneOptions = {},
): RoadScene {
  const acc: Partial<Record<Layer, ChunkedStrips>> = {};
  const strip = (kind: Layer): ChunkedStrips => (acc[kind] ??= new ChunkedStrips(chunkKey));
  const w = (edge: number, s: number, d: number, h: number): Point3 => road.toWorld(edge, s, d, h);
  const locator = new EdgeLocator(road);
  const gores = goreLines(road);
  const zones = road.splitZones();
  /** Whether a main (non-shortcut) road draws its surface under a point of edge e. */
  const underMain = (e: Edge, s: number, d: number): boolean => {
    const p = w(e.index, s, d, 0);
    return locator.covered(p.x, p.z, e.index, outerSpan, (o) => !hasShortcut(o));
  };
  /** Whether another road's lanes (drive or shortcut) run under a point of edge e. */
  const onOtherLanes = (e: Edge, s: number, d: number): boolean => {
    const p = w(e.index, s, d, 0);
    return locator.covered(p.x, p.z, e.index, (o, os) => {
      const l = laneSpans(road.lanesAt(o.index, os));
      return l.drive ?? l.shortcut;
    });
  };
  const postSpots: Point3[] = [];
  const railPostSpots: { p: Point3; h: number }[] = [];
  const pylonSpots: { p: Point3; h: number }[] = [];
  const palmSpots: { p: Point3; turn: number; size: number }[] = [];
  const truckParts: BoxPart[] = [];
  let boostPads = 0;
  let rampTrucks = 0;
  const density = Math.max(0, opts.roadsideDensity ?? 1);
  let railM = 0;
  let rampStripes = 0;
  let landM = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const e of road.edges) {
    const dress = dressingOf(e, dressing);
    const ss = samplesOf(e);
    const outerL = e.dMin - VERGE_M;
    const outerR = e.dMax + VERGE_M;
    const shortcutEdge = hasShortcut(e);
    const gore = gores.get(e.index);
    const lift = shortcutEdge ? SHORTCUT_LIFT_M : 0;
    for (const kind of ['road', 'shortcut', 'shoulder', 'marking', 'markingCenter', 'deck'] as const) {
      strip(kind).breakStrip();
    }
    // A shortcut that overlaps a main road is clipped to the part beside it or, near a split, to
    // the split zone's inner edge, so what is drawn on top matches where the sim sends a rider (at
    // the split, d inside the zone takes the shortcut). Its verges go where they would lie under
    // the main road.
    const clips: Clip[] = ss.map((s) => {
      const l = laneSpans(road.lanesAt(e.index, s));
      const span = l.drive ?? l.shortcut ?? ([0, 0] as [number, number]);
      const c: Clip = { lo: span[0], hi: span[1], vergeL: true, vergeR: true, goreL: false, goreR: false };
      if (!shortcutEdge) return c;
      if (underMain(e, s, outerL)) {
        c.vergeL = false;
        let free = span[0];
        while (free < span[1] && underMain(e, s, free)) free += 0.1;
        if (gore !== undefined && gore > span[0] && gore < free) {
          c.lo = gore;
          c.goreL = true;
        } else c.lo = Math.min(free, span[1]);
      }
      if (underMain(e, s, outerR)) {
        c.vergeR = false;
        let free = span[1];
        while (free > c.lo && underMain(e, s, free)) free -= 0.1;
        if (gore !== undefined && gore < span[1] && gore > free) {
          c.hi = gore;
          c.goreR = true;
        } else c.hi = Math.max(free, c.lo);
      }
      return c;
    });
    const zonesHere = zones.filter((z) => z.edge === e.index);
    const inZone = (s: number, d: number) =>
      zonesHere.some(
        (z) => s >= z.s0 && s <= z.s1 && d >= Math.min(z.d0, z.d1) - 0.3 && d <= Math.max(z.d0, z.d1) + 0.3,
      );
    // Surfaces and solid edge lines, sample by sample, pausing where a span is absent. The edge
    // line breaks across a split zone: that is where a rider may leave.
    const lanesSpan = (l: LaneSpans): [number, number] => l.drive ?? l.shortcut ?? [0, 0];
    const surfaces: {
      kind: MaterialKind;
      span: (l: LaneSpans, c: Clip) => [number, number] | null;
      lift: number;
      skip?: (s: number, span: [number, number]) => boolean;
    }[] = [
      { kind: 'road', span: (l) => l.drive, lift: 0 },
      { kind: 'shortcut', span: (l, c) => (l.shortcut ? [c.lo, c.hi] : null), lift },
      { kind: 'shoulder', span: (l, c) => (c.vergeL ? [outerL, lanesSpan(l)[0]] : null), lift: -0.02 },
      { kind: 'shoulder', span: (l, c) => (c.vergeR ? [lanesSpan(l)[1], outerR] : null), lift: -0.02 },
      {
        kind: 'marking',
        span: (l) => (l.drive ? [l.drive[0] + 0.1, l.drive[0] + 0.25] : null),
        lift: 0.03,
        skip: (s, span) => inZone(s, span[0]),
      },
      {
        kind: 'marking',
        span: (l) => (l.drive ? [l.drive[1] - 0.25, l.drive[1] - 0.1] : null),
        lift: 0.03,
        skip: (s, span) => inZone(s, span[1]),
      },
    ];
    for (const surf of surfaces) {
      const a = strip(surf.kind);
      a.breakStrip();
      ss.forEach((s, i) => {
        const c = clips[i];
        const span = c ? surf.span(laneSpans(road.lanesAt(e.index, s)), c) : null;
        if (!span || span[1] - span[0] < 0.01 || surf.skip?.(s, span)) {
          a.breakStrip();
          return;
        }
        a.pair(w(e.index, s, span[0], surf.lift), w(e.index, s, span[1], surf.lift));
      });
      a.breakStrip();
    }
    // The gore line: where the split zone's inner edge bounds the shortcut, a solid white line.
    for (const left of [true, false]) {
      const m = strip('splitMark');
      m.breakStrip();
      ss.forEach((s, i) => {
        const c = clips[i];
        if (!c || !(left ? c.goreL : c.goreR)) {
          m.breakStrip();
          return;
        }
        const d = left ? c.lo : c.hi;
        m.pair(w(e.index, s, d, lift + 0.03), w(e.index, s, d + (left ? LINE_M : -LINE_M), lift + 0.03));
      });
      m.breakStrip();
    }
    // The split zone: where a rider must be to take the shortcut, painted in the shortcut's colour,
    // with its inner edge as a solid line and chevrons pointing the way off.
    for (const z of zonesHere) {
      const lo = Math.min(z.d0, z.d1);
      const hi = Math.max(z.d0, z.d1);
      const inner = Math.abs(z.d0) < Math.abs(z.d1) ? z.d0 : z.d1;
      const out = inner === lo ? 1 : -1;
      const s0 = Math.max(0, z.s0);
      const s1 = Math.min(e.length, z.s1);
      if (s1 <= s0) continue;
      const fill = strip('splitZone');
      const mark = strip('splitMark');
      fill.breakStrip();
      mark.breakStrip();
      for (let s = s0; ; s = Math.min(s1, s + STEP_M)) {
        fill.pair(w(e.index, s, lo, ZONE_LIFT_M), w(e.index, s, hi, ZONE_LIFT_M));
        if (s >= s1) break;
      }
      fill.breakStrip();
      for (let s = s0; ; s = Math.min(s1, s + STEP_M)) {
        mark.pair(w(e.index, s, inner, 0.03), w(e.index, s, inner + out * LINE_M, 0.03));
        if (s >= s1) break;
      }
      mark.breakStrip();
      // Chevrons: two bars meeting at a point toward the split.
      const toward = z.end === 'to' ? 1 : -1;
      const mid = (lo + hi) / 2;
      const half = (hi - lo) * 0.3;
      const n = Math.max(1, Math.round((s1 - s0) / 10));
      for (let k = 0; k < n; k++) {
        const sc = s0 + ((k + 0.5) * (s1 - s0)) / n;
        const tip = { s: sc + toward * 1.5, d: mid };
        for (const tail of [
          { s: sc - toward * 1.5, d: mid - half },
          { s: sc - toward * 1.5, d: mid + half },
        ]) {
          const ds = tip.s - tail.s;
          const dd = tip.d - tail.d;
          const len = Math.hypot(ds, dd) || 1;
          const ns = (-dd / len) * LINE_M;
          const nd = (ds / len) * LINE_M;
          mark.quad(
            w(e.index, tail.s, tail.d, 0.03),
            w(e.index, tail.s + ns, tail.d + nd, 0.03),
            w(e.index, tip.s, tip.d, 0.03),
            w(e.index, tip.s + ns, tip.d + nd, 0.03),
          );
        }
      }
    }
    // Land under the roadside zones (playtest 1b: pedestrians stood in the water). The sim stands
    // pedestrians anywhere across a zone, crosses some to the far side and dives them clear, all
    // at road height, so each zone gets a strip of land out past its far edge plus a dive, and the
    // far side gets one too unless a rail stops anyone crossing. Beside a railed road it is a
    // walkway (a fishing catwalk on the bridge). Each strip tapers into the verge at both ends and
    // shelves down into the water along its outer edge.
    for (const f of (dress.features ?? []).filter((x) => x.kind === 'roadsideZone')) {
      const zoneSide = f.d0 + f.d1 < 0 ? -1 : 1;
      const far = Math.max(Math.abs(f.d0), Math.abs(f.d1));
      for (const side of [-1, 1] as const) {
        const railed = barriersFor(road, e, dress, side < 0 ? 'left' : 'right').some(
          (b) => b.s0 < f.s1 && b.s1 > f.s0,
        );
        if (side !== zoneSide && railed) continue;
        const inner = side < 0 ? -outerL : outerR;
        const reach = Math.max(inner, side === zoneSide ? far + LAND_DIVE_M : e.dMax + LAND_FAR_M);
        const a = Math.max(0, f.s0 - LAND_TAPER_M);
        const b = Math.min(e.length, f.s1 + LAND_TAPER_M);
        const rows: { near: Point3; edge: Point3; low: Point3 }[] = [];
        for (let s = a; ; s = Math.min(b, s + STEP_M)) {
          const outside = s < f.s0 ? f.s0 - s : s > f.s1 ? s - f.s1 : 0;
          const width = inner + (reach - inner) * Math.max(0, 1 - outside / LAND_TAPER_M);
          const edge = w(e.index, s, side * width, LAND_LIFT_M);
          rows.push({
            near: w(e.index, s, side * inner, LAND_LIFT_M),
            edge,
            low: railed ? { ...edge, y: edge.y - 0.5 } : { ...w(e.index, s, side * (width + 2), 0), y: -0.4 },
          });
          if (s >= b) break;
        }
        // Pairs run in increasing d, so the faces point up (and out, on the shelf).
        const ground = strip(railed ? 'deck' : 'land');
        for (const [inside, outside] of [
          ['near', 'edge'],
          ['edge', 'low'],
        ] as const) {
          ground.breakStrip();
          for (const r of rows) {
            if (side < 0) ground.pair(r[outside], r[inside]);
            else ground.pair(r[inside], r[outside]);
          }
          ground.breakStrip();
        }
        if (!railed) landM += b - a;
      }
    }
    // Deck fascia on bridges, an embankment down to the water elsewhere, on both sides.
    for (const [d, out] of [
      [outerL, -1],
      [outerR, 1],
    ] as const) {
      const deck = strip('deck');
      deck.breakStrip();
      for (const s of ss) {
        const top = w(e.index, s, d, -0.02);
        const bottom =
          top.y >= ELEVATED_M
            ? { x: top.x, y: top.y - 1, z: top.z }
            : { ...w(e.index, s, d + out * 2, 0), y: -0.4 };
        if (out < 0) deck.pair(bottom, top);
        else deck.pair(top, bottom);
      }
      deck.breakStrip();
    }
    // Centre and lane dashes: 3 m on, 9 m off; yellow between opposite directions.
    for (let s = 2; s + 3 < e.length; s += 12) {
      for (const div of laneSpans(road.lanesAt(e.index, s)).dividers) {
        strip(div.opposite ? 'markingCenter' : 'marking').quad(
          w(e.index, s, div.d - 0.08, 0.03),
          w(e.index, s, div.d + 0.08, 0.03),
          w(e.index, s + 3, div.d - 0.08, 0.03),
          w(e.index, s + 3, div.d + 0.08, 0.03),
        );
      }
    }
    // Delineator posts every 25 m on the verge: a sense of speed. Pylons under the deck every 24 m.
    for (let s = 0; s < e.length; s += 25) {
      if (road.toWorld(e.index, s, 0, 0).y >= ELEVATED_M) continue; // the rails do this job on bridges
      for (const d of [outerL + 0.25, outerR - 0.25]) {
        // Where two roads overlap, a post on one road's verge can stand in the other's lane.
        if (!onOtherLanes(e, s, d)) postSpots.push(w(e.index, s, d, 0.55));
      }
    }
    for (let s = 12; s < e.length; s += 24) {
      for (const d of [e.dMin + 0.8, e.dMax - 0.8]) {
        const p = w(e.index, s, d, 0);
        if (p.y >= ELEVATED_M) pylonSpots.push({ p: { x: p.x, y: -0.5, z: p.z }, h: p.y - 1 + 0.5 });
      }
    }
    // Roadside palms (playtest 1 item 10: things close by the road, for a sense of speed). Each
    // stands a few metres past the verge on its own sand mound, jittered along and across; none on
    // a deck or beside a rail, and none on or next to another road.
    if (density > 0) {
      const spacing = PALM_SPACING_M / density;
      for (const side of [-1, 1] as const) {
        const rails = barriersFor(road, e, dress, side < 0 ? 'left' : 'right');
        const outer = side < 0 ? -outerL : outerR;
        for (let k = 0; ; k++) {
          const s = (k + 0.2 + 0.6 * hash01(e.index, k, side)) * spacing;
          if (s > e.length) break;
          if (road.toWorld(e.index, s, 0, 0).y >= ELEVATED_M) continue;
          if (rails.some((b) => s >= b.s0 - 5 && s <= b.s1 + 5)) continue;
          const d = side * (outer + PALM_OFFSET_M + PALM_SPREAD_M * hash01(e.index, k, side + 7));
          // Nor inside a sign, a pad or a ramp truck (with room for the mound and the crown).
          if (
            (dress.features ?? []).some(
              (f) =>
                KEEP_CLEAR.has(f.kind) &&
                s >= Math.min(f.s0, f.s1) - 3 &&
                s <= Math.max(f.s0, f.s1) + 3 &&
                d >= Math.min(f.d0, f.d1) - 3 &&
                d <= Math.max(f.d0, f.d1) + 3,
            )
          )
            continue;
          const p = w(e.index, s, d, LAND_LIFT_M);
          if (locator.covered(p.x, p.z, e.index, (o) => [o.dMin - VERGE_M - 2, o.dMax + VERGE_M + 2]))
            continue;
          palmSpots.push({
            p,
            turn: hash01(e.index, k, side + 13) * Math.PI * 2,
            size: 0.8 + 0.4 * hash01(k, s, side),
          });
        }
      }
    }
    // Rails (a band on posts) and walls, from the dressing or the elevation rule.
    for (const [side, d] of [
      ['left', outerL + 0.05],
      ['right', outerR - 0.05],
    ] as const) {
      for (const b of barriersFor(road, e, dress, side)) {
        const s0 = Math.max(0, b.s0);
        const s1 = Math.min(e.length, b.s1);
        if (s1 <= s0) continue;
        const h = b.heightM ?? 1;
        const bottom = b.kind === 'wall' ? 0 : h - 0.3;
        const rail = strip('rail');
        rail.breakStrip();
        for (let s = s0; ; s = Math.min(s1, s + STEP_M)) {
          rail.pair(w(e.index, s, d, h), w(e.index, s, d, bottom));
          if (s >= s1) break;
        }
        rail.breakStrip();
        railM += s1 - s0;
        if (b.kind !== 'wall') {
          for (let s = s0; s <= s1; s += 3) railPostSpots.push({ p: w(e.index, s, d, 0), h });
        }
      }
    }
    // The ramp: orange stripes over `ramp` features, or over steep shortcut stretches with no data.
    const ramps: FeatureSpan[] = (dress.features ?? []).filter((f) => f.kind === 'ramp');
    if (!ramps.length) {
      let start = -1;
      for (let i = 0; i < e.count; i++) {
        const s = Math.min(e.length, i * e.spacing);
        const steep = (e.grade[i] ?? 0) > 0.08 && laneSpans(road.lanesAt(e.index, s)).shortcut !== null;
        if (steep && start < 0) start = s;
        if ((!steep || i === e.count - 1) && start >= 0) {
          const span = laneSpans(road.lanesAt(e.index, start)).shortcut ?? [0, 0];
          ramps.push({ kind: 'ramp', s0: start, s1: s, d0: span[0], d1: span[1] });
          start = -1;
        }
      }
    }
    for (const r of ramps) {
      for (let s = r.s0; s + 0.5 <= r.s1; s += 1) {
        strip('rampMark').quad(
          w(e.index, s, r.d0, lift + 0.04),
          w(e.index, s, r.d1, lift + 0.04),
          w(e.index, s + 0.5, r.d0, lift + 0.04),
          w(e.index, s + 0.5, r.d1, lift + 0.04),
        );
        rampStripes++;
      }
    }
    // Quick wins (playtest 1b): boost pads glow on the road with chevrons pointing along +s, and
    // ramp trucks are placeholder boxes (their parts are merged into one mesh below).
    for (const f of dress.features ?? []) {
      if (f.kind === 'boostPad') {
        const s0 = Math.max(0, Math.min(f.s0, f.s1));
        const s1 = Math.min(e.length, Math.max(f.s0, f.s1));
        const lo = Math.min(f.d0, f.d1);
        const hi = Math.max(f.d0, f.d1);
        if (s1 <= s0) continue;
        const pad = strip('boostPad');
        pad.breakStrip();
        for (let s = s0; ; s = Math.min(s1, s + 1)) {
          pad.pair(w(e.index, s, lo, lift + BOOST_LIFT_M), w(e.index, s, hi, lift + BOOST_LIFT_M));
          if (s >= s1) break;
        }
        pad.breakStrip();
        const mark = strip('boostMark');
        const mid = (lo + hi) / 2;
        const half = (hi - lo) * 0.3;
        for (let s = s0 + 0.5; s + 1.2 <= s1; s += 1.6) {
          for (const side of [-1, 1]) {
            // One arm of a chevron, from the back corner to the tip ahead.
            const tail = { s, d: mid + side * half };
            const tip = { s: s + 1.2, d: mid };
            const ds = tip.s - tail.s;
            const dd = tip.d - tail.d;
            const l = Math.hypot(ds, dd) || 1;
            const ns = (-dd / l) * 0.18;
            const nd = (ds / l) * 0.18;
            const h = lift + BOOST_LIFT_M + 0.015;
            const a = w(e.index, tail.s, tail.d, h);
            const b = w(e.index, tail.s + ns, tail.d + nd, h);
            const c = w(e.index, tip.s, tip.d, h);
            const d = w(e.index, tip.s + ns, tip.d + nd, h);
            // Pairs in increasing d, so the faces point up.
            if (nd >= 0) mark.quad(a, b, c, d);
            else mark.quad(b, a, d, c);
          }
        }
        boostPads++;
      } else if (f.kind === 'rampTruck') {
        truckParts.push(...rampTruckParts(road, e.index, f));
        rampTrucks++;
      }
    }
    for (let i = 0; i < e.count; i++) {
      minX = Math.min(minX, e.x[i] ?? 0);
      maxX = Math.max(maxX, e.x[i] ?? 0);
      minZ = Math.min(minZ, e.z[i] ?? 0);
      maxZ = Math.max(maxZ, e.z[i] ?? 0);
    }
  }

  const group = new Group();
  group.name = 'road';
  let triangles = 0;
  let meshes = 0;
  /** The group of one chunk, made on first use (static road, merged per chunk so it can be culled). */
  const chunkGroups = new Map<string, Group>();
  const addMesh = (key: string, mesh: Mesh) => {
    let g = chunkGroups.get(key);
    if (!g) {
      g = new Group();
      g.name = `road-chunk-${key}`;
      chunkGroups.set(key, g);
      group.add(g);
    }
    g.add(mesh);
    meshes++;
  };
  const doubleSided = new Set<MaterialKind>(['rail', 'deck']);
  for (const [layer, a] of Object.entries(acc) as [Layer, ChunkedStrips][]) {
    const kind = kindOf(layer);
    for (const [key, part] of a.chunks) {
      if (part.isEmpty) continue;
      triangles += part.triangleCount;
      const mesh = new Mesh(part.build(), look.material(kind, { doubleSided: doubleSided.has(kind) }));
      mesh.name = `road-${layer}`;
      addMesh(key, mesh);
    }
  }
  const m = new Matrix4();
  const q = new Quaternion();
  const one = new Vector3(1, 1, 1);
  /** Instanced scenery, one InstancedMesh per chunk that has any, so it culls with its chunk. */
  const addInstanced = <T extends { p: Point3 }>(
    name: string,
    geo: BufferGeometry,
    material: Material,
    spots: readonly T[],
    matrixOf: (spot: T) => Matrix4,
  ) => {
    const byChunk = new Map<string, T[]>();
    for (const s of spots) {
      const key = chunkKey(s.p.x, s.p.z);
      const list = byChunk.get(key);
      if (list) list.push(s);
      else byChunk.set(key, [s]);
    }
    for (const [key, list] of byChunk) {
      const mesh = new InstancedMesh(geo, material, list.length);
      list.forEach((s, i) => mesh.setMatrixAt(i, matrixOf(s)));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.name = name;
      triangles += ((geo.index?.count ?? 0) / 3) * list.length;
      addMesh(key, mesh);
    }
  };
  const boxes = (
    name: string,
    geo: BoxGeometry,
    kind: MaterialKind,
    spots: readonly { p: Point3; h: number }[],
  ) =>
    addInstanced(name, geo, look.material(kind), spots, ({ p, h }) =>
      m.compose(new Vector3(p.x, p.y, p.z), q, one.clone().setY(h)),
    );
  boxes(
    'road-posts',
    new BoxGeometry(0.15, 1.1, 0.15),
    'post',
    postSpots.map((p) => ({ p, h: 1 })),
  );
  // Unit-height boxes standing on their base, stretched by the instance scale.
  boxes('road-rail-posts', new BoxGeometry(0.1, 1, 0.1).translate(0, 0.5, 0), 'rail', railPostSpots);
  boxes('road-pylons', new BoxGeometry(0.9, 1, 0.9).translate(0, 0.5, 0), 'deck', pylonSpots);
  if (truckParts.length) {
    // Few and small: one mesh for every truck on the network.
    const trucks = new Mesh(mergeBoxes(truckParts), look.material('vehicle', { vertexColors: true }));
    trucks.name = 'road-rampTrucks';
    triangles += (trucks.geometry.index?.count ?? 0) / 3;
    group.add(trucks);
    meshes++;
  }
  if (palmSpots.length) {
    const turn = new Quaternion();
    const up = new Vector3(0, 1, 0);
    addInstanced(
      'road-palms',
      palmGeometry(),
      look.material('prop', { vertexColors: true }),
      palmSpots,
      (s) =>
        m.compose(
          new Vector3(s.p.x, s.p.y, s.p.z),
          turn.setFromAxisAngle(up, s.turn),
          new Vector3(s.size, s.size, s.size),
        ),
    );
  }

  // The sea, at world y = 0 (sea level in the network frame).
  const water = new Mesh(new PlaneGeometry(maxX - minX + 3000, maxZ - minZ + 3000), look.material('water'));
  water.rotation.x = -Math.PI / 2;
  water.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  water.name = 'road-water';
  group.add(water);
  meshes++;
  triangles += 2;

  return {
    group,
    stats: {
      meshes,
      chunks: chunkGroups.size,
      triangles,
      railM,
      rampStripes,
      pylons: pylonSpots.length,
      landM,
      boostPads,
      rampTrucks,
    },
    dispose() {
      // Instanced chunks share one geometry per kind: dispose each once.
      const seen = new Set<BufferGeometry>();
      group.traverse((o) => {
        if (o instanceof Mesh && !seen.has(o.geometry as BufferGeometry)) {
          seen.add(o.geometry as BufferGeometry);
          (o.geometry as BufferGeometry).dispose();
        }
      });
    },
  };
}
