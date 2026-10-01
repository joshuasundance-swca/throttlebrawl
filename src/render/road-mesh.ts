// The road as meshes (M1 render-1): surfaces from the road profiles, markings, posts, bridge rails,
// deck fascias and pylons, the ramp's warning stripes and the sea. Geometry is merged per material
// within each square chunk of the world (M2; docs/architecture.md, "Performance budgets": merged
// static geometry per chunk), so the draw calls per chunk stay flat however many edges pass through
// it, and the renderer culls the chunks the camera cannot see: a frame's road cost does not grow
// with the length of the road.
// Playtest 1c adds tagged land beside the road with its scenery (scenery.ts), instanced from the
// Blender models when they have loaded, and the ramp-truck model lined up with the sim's ramp.
import {
  BoxGeometry,
  Euler,
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
import type { SceneryModel, SceneryModels } from './models';
import {
  boatBob,
  isTropical,
  LAND_TOP_M,
  SCENERY_KINDS,
  scatterEdge,
  themeAt,
  type SceneryKind,
  type ScenerySpot,
  type SideTheme,
} from './scenery';

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
  /** Ramp trucks drawn from the Blender model (the rest are the code-made stand-in). */
  rampTruckModels: number;
  /** Metres of road side with tagged land beside it (playtest 1c: scenery stands on land only). */
  sceneryLandM: number;
  /** Scenery placed, by kind (playtest 1c). */
  scenery: Readonly<Record<SceneryKind, number>>;
  /** Scenery kinds drawn from the Blender models (the rest are code-made stand-ins). */
  sceneryModels: readonly SceneryKind[];
}

export interface RoadScene {
  group: Group;
  stats: RoadSceneStats;
  /** Every scenery spot placed (for tests and the debug overlay). */
  spots: readonly ScenerySpot[];
  /**
   * Per frame: hides scenery batches farther than `drawM` from the camera and bobs the boats.
   * Returns the scenery instances left visible.
   */
  update(cameraX: number, cameraZ: number, t: number, drawM: number): number;
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
  /** Roadside scenery density: 1 = the default spacing, 0 = none (`render.roadsideDensity`). */
  roadsideDensity?: number;
  /** The race's seed: the scenery scatter derives from it (playtest 1c item 2). Default 1. */
  seed?: number;
  /** The Blender models that have loaded; a kind left out draws its code-made stand-in. */
  models?: SceneryModels;
}

/** Features no scenery stands in (with room for the model). */
const KEEP_CLEAR = new Set(['billboard', 'boostPad', 'rampTruck', 'roadsideZone', 'copSpawn']);
/** At least this much room between a feature and any scenery (a palm's crown spreads past its trunk), m. */
const FEATURE_CLEAR_M = 3;
/**
 * Tagged land (playtest 1c): a strip at the road's height from the verge out to this many metres,
 * then a shelf down into the sea. Wide enough for a bait shack back from the road. [default]
 */
export const SCENERY_LAND_M = 24;
/** The shelf from the land's edge down to the sea floor, m. */
const SCENERY_SHELF_M = 4;
/** Scenery batches are grouped in squares this size, so far ones can be hidden. [default] */
export const SCENERY_CHUNK_M = 256;

/** Code-made stand-ins, drawn until a model loads (or if it fails). No mounds: they stand on land. */
function standIn(kind: SceneryKind): BufferGeometry {
  const parts: Record<SceneryKind, BoxPart[]> = {
    palm: [
      { size: [0.28, 2.4, 0.28], at: [0.1, 1.2, 0], color: '#8a6a45', rotX: 0.05 },
      { size: [0.24, 2.4, 0.24], at: [0.35, 3.4, 0.1], color: '#7d5f3d', rotX: -0.12 },
      { size: [3.2, 0.25, 0.9], at: [0.5, 4.7, 0.1], color: '#3f8f4a', rotY: 0.4 },
      { size: [0.9, 0.25, 3.2], at: [0.5, 4.75, 0.1], color: '#357d40', rotY: 0.4 },
    ],
    mangrove: [
      { size: [2.2, 1.4, 2.2], at: [0, 0.7, 0], color: '#6e5a48' },
      { size: [3.6, 1.5, 3.2], at: [0, 2.2, 0], color: '#4f8a3c' },
    ],
    shack: [
      { size: [4.6, 2.2, 3], at: [0, 2, -0.5], color: '#86b9b0' },
      { size: [5.2, 0.2, 4.4], at: [0, 3.2, 0], color: '#b9bdbb' },
      { size: [4.6, 0.85, 3], at: [0, 0.42, -0.5], color: '#6d6052' },
    ],
    pole: [
      { size: [0.3, 10.5, 0.3], at: [0, 5.25, 0], color: '#6b5a47' },
      { size: [2.4, 0.2, 0.2], at: [-0.1, 10, 0], color: '#6b5a47' },
    ],
    skiff: [{ size: [1.8, 0.6, 5.2], at: [0, 0.15, 0], color: '#e8e2d2' }],
    boat: [
      { size: [2.5, 0.9, 7.6], at: [0, 0.3, 0], color: '#e2d9c1' },
      { size: [1, 1.2, 1.4], at: [0, 1.2, -0.2], color: '#3a4048' },
    ],
  };
  return mergeBoxes(parts[kind]);
}

/** Which model draws each scenery kind. */
const MODEL_OF: Readonly<Record<SceneryKind, keyof SceneryModels>> = {
  palm: 'palms',
  mangrove: 'mangroves',
  shack: 'baitShack',
  pole: 'powerPole',
  skiff: 'skiff',
  boat: 'boat',
};

/**
 * Where the ramp-truck model goes (playtest 1c item 4): its ramp foot at the feature's s0, its lip
 * `rampLengthM` along the road at `lipHeightM` above it, and its ramp surface exactly as wide as the
 * feature, so the ramp a rider sees is the ramp the sim gives riders (sim/riders/features.ts). The
 * model's +Z runs along +s, +Y is the road's up and +X its left. At the defaults (13.7 degrees,
 * 11.5 m, 2.8 m) the run and the lip are the model's own; across, its 2.5 m ramp fits the feature.
 */
export function rampTruckMatrix(
  road: RoadNetwork,
  edge: number,
  f: FeatureSpan,
  ramp: SceneryModel['ramp'],
): Matrix4 {
  const run = Math.max(1, num(f.params?.['rampLengthM'], RAMP_TRUCK_DEFAULTS.rampLengthM));
  const lip = Math.max(0.3, num(f.params?.['lipHeightM'], RAMP_TRUCK_DEFAULTS.lipHeightM));
  const width = Math.abs(f.d1 - f.d0);
  const dMid = (f.d0 + f.d1) / 2;
  const at = (s: number, d: number, h: number) => {
    const p = road.toWorld(edge, s, d, h);
    return new Vector3(p.x, p.y, p.z);
  };
  const foot = at(f.s0, dMid, 0);
  const fwd = at(f.s0 + run, dMid, 0)
    .sub(foot)
    .normalize();
  const up = at(f.s0, dMid, 1).sub(foot);
  up.addScaledVector(fwd, -up.dot(fwd)).normalize();
  const left = new Vector3().crossVectors(up, fwd).normalize();
  const sx = width / (ramp?.widthM ?? 2.5);
  const sy = lip / (ramp?.lipM ?? RAMP_TRUCK_DEFAULTS.lipHeightM);
  const sz = run / (ramp?.runM ?? RAMP_TRUCK_DEFAULTS.rampLengthM);
  return new Matrix4()
    .makeBasis(left.multiplyScalar(sx), up.multiplyScalar(sy), fwd.multiplyScalar(sz))
    .setPosition(foot);
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
  const spots: ScenerySpot[] = [];
  const truckParts: BoxPart[] = [];
  const truckMatrices: Matrix4[] = [];
  const truckModel = opts.models?.truck;
  let boostPads = 0;
  let rampTrucks = 0;
  let sceneryLandM = 0;
  const density = Math.max(0, opts.roadsideDensity ?? 1);
  const seed = opts.seed ?? 1;
  const tropical = isTropical(road.edges.map((e) => dressingOf(e, dressing).tags));
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
    // Tagged land and its scenery (playtest 1c items 2 to 4). Where a side's scenery tags say land,
    // a strip of ground runs from the verge out to SCENERY_LAND_M at the road's height, then
    // shelves into the sea; it narrows, or stops, where another road would lie under it. Nothing
    // grows on a bridge, beside a rail or on the water. The scatter then places the models on that
    // land by theme and by the race's seed, and boats on the water sides.
    const tags = dress.tags;
    const untagged = !tags || tags.length === 0;
    const sideName = (side: -1 | 1) => (side < 0 ? 'left' : 'right');
    const railsOf = { [-1]: barriersFor(road, e, dress, 'left'), [1]: barriersFor(road, e, dress, 'right') };
    const theme = (side: -1 | 1, s: number): SideTheme => themeAt(tags, sideName(side), s);
    const outerOf = (side: -1 | 1) => (side < 0 ? -outerL : outerR);
    const otherRoadAt = (s: number, d: number, margin: number) => {
      const p = w(e.index, s, d, 0);
      return locator.covered(p.x, p.z, e.index, (o) => [
        o.dMin - VERGE_M - margin,
        o.dMax + VERGE_M + margin,
      ]);
    };
    const step = ss.length > 1 ? e.length / (ss.length - 1) : e.length;
    const reachOf: Record<-1 | 1, number[]> = { [-1]: [], [1]: [] };
    for (const side of [-1, 1] as const) {
      const outer = outerOf(side);
      const reach = reachOf[side];
      for (const s of ss) {
        const th = theme(side, s);
        const land =
          th !== 'none' &&
          th !== 'water' &&
          !railsOf[side].some((b) => s >= b.s0 - 5 && s <= b.s1 + 5) &&
          !(untagged && w(e.index, s, 0, 0).y >= ELEVATED_M);
        let r = 0;
        if (land) {
          for (const width of [SCENERY_LAND_M, 14, 6]) {
            const d = outer + width + SCENERY_SHELF_M;
            if (!otherRoadAt(s, side * d, 1) && !otherRoadAt(s, side * (outer + width / 2), 1)) {
              r = width;
              break;
            }
          }
        }
        reach.push(r);
      }
      const ground = strip('land');
      ground.breakStrip();
      ss.forEach((s, i) => {
        const r = reach[i] ?? 0;
        if (r <= 0) {
          ground.breakStrip();
          return;
        }
        if (i > 0) sceneryLandM += step;
        const near = w(e.index, s, side * outer, LAND_TOP_M);
        const edge = w(e.index, s, side * (outer + r), LAND_TOP_M);
        // Pairs in increasing d, so the faces point up.
        if (side < 0) ground.pair(edge, near);
        else ground.pair(near, edge);
      });
      ground.breakStrip();
      const shelf = strip('land');
      shelf.breakStrip();
      ss.forEach((s, i) => {
        const r = reach[i] ?? 0;
        if (r <= 0) {
          shelf.breakStrip();
          return;
        }
        const edge = w(e.index, s, side * (outer + r), LAND_TOP_M);
        const low = { ...w(e.index, s, side * (outer + r + SCENERY_SHELF_M), 0), y: -0.4 };
        if (side < 0) shelf.pair(low, edge);
        else shelf.pair(edge, low);
      });
      shelf.breakStrip();
    }
    spots.push(
      ...scatterEdge({
        seed,
        edge: e.index,
        length: e.length,
        density,
        tropical,
        outer: outerOf,
        theme,
        landReach: (side, s) => reachOf[side][Math.round(s / step)] ?? 0,
        clear: (s, d, radius) =>
          !(dress.features ?? []).some(
            (f) =>
              KEEP_CLEAR.has(f.kind) &&
              s >= Math.min(f.s0, f.s1) - Math.max(radius, FEATURE_CLEAR_M) &&
              s <= Math.max(f.s0, f.s1) + Math.max(radius, FEATURE_CLEAR_M) &&
              d >= Math.min(f.d0, f.d1) - Math.max(radius, FEATURE_CLEAR_M) &&
              d <= Math.max(f.d0, f.d1) + Math.max(radius, FEATURE_CLEAR_M),
          ) && !otherRoadAt(s, d, radius),
        openWater: (s, d) => {
          const p = w(e.index, s, d, 0);
          return locator.at(p.x, p.z, e.index).length === 0;
        },
        world: (s, d, h) => w(e.index, s, d, h),
      }),
    );
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
        // The Blender truck once it has loaded (playtest 1c item 4), the code-made boxes until then.
        if (truckModel) truckMatrices.push(rampTruckMatrix(road, e.index, f, truckModel.ramp));
        else truckParts.push(...rampTruckParts(road, e.index, f));
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
  const shared = new Set<BufferGeometry>();
  const truckGeo = truckModel?.variants[0];
  if (truckGeo) {
    shared.add(truckGeo);
    for (const tm of truckMatrices) {
      const truck = new Mesh(truckGeo, look.material('vehicle', { vertexColors: true }));
      truck.name = 'road-rampTrucks';
      truck.matrixAutoUpdate = false;
      truck.matrix.copy(tm);
      triangles += trisOf(truckGeo);
      group.add(truck);
      meshes++;
    }
  }

  // Scenery (playtest 1c): one InstancedMesh per model variant per SCENERY_CHUNK_M square, so the
  // renderer can hide the far squares and the camera's frustum culls the rest.
  const scenery = new Group();
  scenery.name = 'road-scenery';
  group.add(scenery);
  const batches: SceneryBatch[] = [];
  const counts = Object.fromEntries(SCENERY_KINDS.map((k) => [k, 0])) as Record<SceneryKind, number>;
  const fromModels: SceneryKind[] = [];
  const turn = new Quaternion();
  const upAxis = new Vector3(0, 1, 0);
  for (const kind of SCENERY_KINDS) {
    const mine = spots.filter((s) => s.kind === kind);
    counts[kind] = mine.length;
    const model = opts.models?.[MODEL_OF[kind]];
    if (model) fromModels.push(kind);
    if (!mine.length) continue;
    const geos = model ? model.variants : [standIn(kind)];
    if (model) for (const g of geos) shared.add(g);
    const material = look.material('prop', { vertexColors: true, doubleSided: model?.doubleSided ?? false });
    const groups = new Map<string, ScenerySpot[]>();
    for (const s of mine) {
      const v = Math.min(geos.length - 1, s.variant);
      const key = `${v}|${Math.floor(s.p.x / SCENERY_CHUNK_M)},${Math.floor(s.p.z / SCENERY_CHUNK_M)}`;
      const list = groups.get(key);
      if (list) list.push(s);
      else groups.set(key, [s]);
    }
    for (const [key, list] of groups) {
      const geo = geos[Number(key.split('|')[0])] ?? geos[0];
      if (!geo) continue;
      const mesh = new InstancedMesh(geo, material, list.length);
      list.forEach((s, i) =>
        mesh.setMatrixAt(
          i,
          m.compose(
            new Vector3(s.p.x, s.p.y, s.p.z),
            turn.setFromAxisAngle(upAxis, s.turn),
            new Vector3(s.size, s.size, s.size),
          ),
        ),
      );
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.name = `road-${kind}s`;
      triangles += trisOf(geo) * list.length;
      scenery.add(mesh);
      meshes++;
      const cx = list.reduce((a, s) => a + s.p.x, 0) / list.length;
      const cz = list.reduce((a, s) => a + s.p.z, 0) / list.length;
      const radius = Math.max(...list.map((s) => Math.hypot(s.p.x - cx, s.p.z - cz))) + 10;
      batches.push({ mesh, spots: list, cx, cz, radius, boats: kind === 'skiff' || kind === 'boat' });
    }
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
      rampTruckModels: truckGeo ? truckMatrices.length : 0,
      sceneryLandM,
      scenery: counts,
      sceneryModels: fromModels,
    },
    spots,
    update(cameraX, cameraZ, t, drawM) {
      let shown = 0;
      for (const b of batches) {
        const visible = Math.hypot(b.cx - cameraX, b.cz - cameraZ) - b.radius < drawM;
        b.mesh.visible = visible;
        if (!visible) continue;
        shown += b.spots.length;
        if (!b.boats) continue;
        b.spots.forEach((s, i) => {
          const bob = boatBob(t, s.phase);
          bobEuler.set(bob.pitch, s.turn, bob.roll, 'YXZ');
          b.mesh.setMatrixAt(
            i,
            m.compose(bobAt.set(s.p.x, bob.rise, s.p.z), turn.setFromEuler(bobEuler), one),
          );
        });
        b.mesh.instanceMatrix.needsUpdate = true;
      }
      return shown;
    },
    dispose() {
      // Instanced chunks share one geometry per kind: dispose each once. The models' geometries
      // belong to the renderer's model cache and outlive this scene.
      const seen = new Set<BufferGeometry>(shared);
      group.traverse((o) => {
        if (o instanceof Mesh && !seen.has(o.geometry as BufferGeometry)) {
          seen.add(o.geometry as BufferGeometry);
          (o.geometry as BufferGeometry).dispose();
        }
      });
    },
  };
}

interface SceneryBatch {
  mesh: InstancedMesh;
  spots: readonly ScenerySpot[];
  /** The batch's centre and radius on the ground, for the draw-distance cut. */
  cx: number;
  cz: number;
  radius: number;
  boats: boolean;
}

const bobEuler = new Euler();
const bobAt = new Vector3();

/** Triangles in a geometry, indexed or not. */
function trisOf(g: BufferGeometry): number {
  return (g.index?.count ?? g.getAttribute('position').count) / 3;
}
