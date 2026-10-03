// The road as meshes (M1 render-1): surfaces from the road profiles, markings, posts, bridge rails,
// deck fascias and pylons, the ramp's warning stripes and the sea. Geometry is merged per material
// within each square chunk of the world (M2; docs/architecture.md, "Performance budgets": merged
// static geometry per chunk), so the draw calls per chunk stay flat however many edges pass through
// it, and the renderer culls the chunks the camera cannot see: a frame's road cost does not grow
// with the length of the road.
// Playtest 1c adds tagged land beside the road with its scenery (scenery.ts), instanced from the
// Blender models when they have loaded, and the ramp-truck model lined up with the sim's ramp.
// The region build-out (W-O, the maintainer, 2026-10-01: "better visuals and experience") gives a
// network that is not tropical (the Pacific Northwest, San Francisco) a terrain skirt: past its land
// strip the ground slopes down to a wide flat field instead of dropping into the sea, so a road on
// a hill never floats in the void. Delineator posts and pylons follow that ground, a forest
// network's bridges stand on timber trestle bents, and a `cable-line` road gets its cable slots.
import {
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
import { chooseSetPieces, SEEDED_SET_PIECE_KINDS, type Edge, type RoadNetwork } from '../road';
import type { LaneInfo } from '../sim/api';
import { ChunkedStrips, mergeBoxes, openBox, type BoxPart, type Point3 } from './geometry';
import { EdgeLocator } from './overlap';
import type { LookStyle, MaterialKind } from './look';
import type { SceneryModel, SceneryModels } from './models';
import { MergedScenery, SCENERY_LOD_M, type MergedSceneryCounts, type MergeItem } from './scenery-merge';
import {
  boatBob,
  isTropical,
  LAND_TOP_M,
  ridableBandPast,
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
  /**
   * The set pieces drawn for this seed (playtest 1c item 2): a slotted candidate only when the race
   * seed picked it, exactly as the sim's riders meet it (road/setpieces.ts).
   */
  setPieces: readonly DrawnSetPiece[];
  /** Metres of road side with tagged land beside it (playtest 1c: scenery stands on land only). */
  sceneryLandM: number;
  /** Scenery placed, by kind (playtest 1c). */
  scenery: Readonly<Record<SceneryKind, number>>;
  /** Scenery kinds drawn from the Blender models (the rest are code-made stand-ins). */
  sceneryModels: readonly SceneryKind[];
}

/** One drawn boost pad or ramp truck (structurally core's DrawnSetPiece). */
export interface DrawnSetPiece {
  id: string;
  kind: string;
  /** Its seeded slot, or null when it is always there. */
  slot: string | null;
  /** World position of the feature box's centre. */
  x: number;
  z: number;
}

/** A dressing feature's set-piece slot, as road/setpieces.ts reads a baked feature's. */
function slotOf(f: FeatureSpan): string | null {
  if (!SEEDED_SET_PIECE_KINDS.includes(f.kind)) return null;
  const v = f.params?.['slot'];
  return typeof v === 'string' && v !== '' ? v : null;
}

export interface RoadScene {
  group: Group;
  stats: RoadSceneStats;
  /** Every scenery spot placed (for tests and the debug overlay). */
  spots: readonly ScenerySpot[];
  /**
   * Per frame: hides scenery farther than `drawM` from the camera, draws the merged blocks past
   * `lodM` as their far stand-ins, builds up to `builds` blocks coming into range (default one),
   * and bobs the boats. Returns the scenery props left visible.
   */
  update(cameraX: number, cameraZ: number, t: number, drawM: number, lodM?: number, builds?: number): number;
  /** The merged still scenery as the last update drew it (run W-S). */
  merged(): MergedSceneryCounts;
  /**
   * Metres of drawn land past the verge at s on a side of an edge (0 = none), as this scene drew
   * it: the roadside layer (roadside.ts, run W-P) stands its clutter on it.
   */
  landReach(edge: number, side: -1 | 1, s: number): number;
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

/** A network's scenery tags as one set, and whether they say tropical (scenery.ts `isTropical`). */
export function networkTags(
  road: RoadNetwork,
  dressing: RoadDressing | undefined,
): { tropical: boolean; tags: Set<string> } {
  const lists = road.edges.map((e) => dressingOf(e, dressing).tags);
  return { tropical: isTropical(lists), tags: new Set(lists.flatMap((l) => (l ?? []).map((t) => t.tag))) };
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

/**
 * The parts of a span that are a bridge or a drop: where a bridge tag covers it or the road stands
 * clear of the ground. Drawn rails belong only there (interview, 2026-10-02, "rails only on bridges
 * and drops"); a rail span on level ground is not drawn.
 */
function railedParts(
  road: RoadNetwork,
  edge: Edge,
  side: 'left' | 'right',
  b: BarrierSpan,
  tags: readonly TagSpan[],
): BarrierSpan[] {
  const bridges = tags.filter((t) => t.tag === 'bridge' && sideHas(t.side, side));
  const onBridge = (s: number) => bridges.some((t) => s >= t.s0 && s <= t.s1);
  const onDrop = (s: number) => road.toWorld(edge.index, s, 0, 0).y >= ELEVATED_M;
  const out: BarrierSpan[] = [];
  let start = -1;
  const last = Math.min(edge.length, b.s1);
  for (let s = Math.max(0, b.s0); ; s = Math.min(last, s + 2)) {
    const yes = onBridge(s) || onDrop(s);
    if (yes && start < 0) start = s;
    if (!yes && start >= 0) {
      out.push({ ...b, s0: start, s1: s });
      start = -1;
    }
    if (s >= last) break;
  }
  if (start >= 0) out.push({ ...b, s0: start, s1: last });
  return out;
}

/** Barrier spans for one side: explicit barriers, else bridge tags, else the elevation rule. */
function barriersFor(
  road: RoadNetwork,
  edge: Edge,
  dress: EdgeDressing,
  side: 'left' | 'right',
): BarrierSpan[] {
  if (dress.barriers) {
    return dress.barriers
      .filter((b) => sideHas(b.side, side))
      .flatMap((b) => (b.kind === 'rail' ? railedParts(road, edge, side, b, dress.tags ?? []) : [b]));
  }
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
type Layer = MaterialKind | 'splitZone' | 'splitMark' | 'boostPad' | 'boostMark' | 'cableSlot';
const LAYER_KIND: Partial<Record<Layer, MaterialKind>> = {
  splitZone: 'shortcut',
  splitMark: 'marking',
  boostPad: 'boost',
  boostMark: 'marking',
  cableSlot: 'marking',
};
/** Layers drawn in their own colour rather than their kind's palette colour. */
const LAYER_COLOR: Partial<Record<Layer, string>> = { cableSlot: '#5b5e63' };
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
  /**
   * The race region's palette (render/look.ts LookEnv): `fogBank` lays fog banks offshore in that
   * colour. Region models arrive already repainted by it.
   */
  palette?: Readonly<Record<string, string>> | undefined;
  /**
   * Which roads get delineator posts (interview, 2026-10-02: "posts only on highways"). Default
   * `isHighway`. A test that needs posts on a real two-lane network passes `() => true`.
   */
  postRoads?: ((edge: Edge) => boolean) | undefined;
}

/** A road with this many drive lanes (both ways) or more is a highway: the 4-6 lane kind. [default] */
export const HIGHWAY_DRIVE_LANES = 4;

/** Whether a road is a highway: some stretch of it has at least HIGHWAY_DRIVE_LANES drive lanes. */
export function isHighway(edge: Edge): boolean {
  return edge.sections.some(
    (sec) => sec.lanes.filter((l) => l.kind === 'drive').length >= HIGHWAY_DRIVE_LANES,
  );
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
/** Land widths tried where another road leaves no room for a shelf, m. [default] */
const LAND_GAP_WIDTHS = [12, 9, 6, 4, 2.5, 1.5];
/** How far such land stops short of the other road's verge, m. [default] */
const LAND_GAP_MARGIN_M = 0.3;
/** On the inside of a turn, land and its shelf reach at most this share of the turn's radius. */
const LAND_FOLD = 0.85;
/** The terrain skirt's flat ground: its height over the sea, m. [default] */
export const GROUND_Y = 0.25;
/** The skirt's slope from the land strip down to the ground: metres out per metre down. [default] */
const SKIRT_RUN_PER_M = 2.2;
const SKIRT_RUN_M = [6, 90] as const;
/** The flat ground past the slope, m (shorter, or none, where another road or water is near). */
const SKIRT_FLAT_M = [70, 35, 12, 0] as const;
/** No skirt ground within this many metres of another road's water. [default] */
const SKIRT_WATER_CLEAR_M = 22;
/**
 * Another road is looked for under the skirt every this many metres across it, m. (Bundle 1: two
 * looks, at the slope's middle and foot, missed SF's Park Cut running between them in the valley
 * below the Fogline Climb, so the climb's slope buried the cut.) [default]
 */
const SKIRT_ROAD_PROBE_M = 8;
/** Likewise across the land strip (the cut also ran inside the climb's strip, at its edge). [default] */
const STRIP_ROAD_PROBE_M = 4;
/** A road this far or more below another's height is one its land would bury, m. [default] */
const BURIED_M = 1.5;
/** The skirt keeps one road sample in this many. [default] */
const SKIRT_EVERY = 3;
/** A far conifer's trunk and the drawn ground it needs round it, as (s, d-outward) offsets, m. */
const FAR_ROOTS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1.2, 0],
  [-1.2, 0],
  [0, 1.2],
  [0, -1.2],
];
/** Where a land end cap's curtain stops: under the sea, with the shelves' foot. */
const LAND_CAP_FOOT_Y = -0.4;
/** Two roads' land at a join is bridged only where it stands within this height of each other, m. */
const JOIN_LAND_DY_M = 0.5;
/** The land narrowing in one step by more than this gets a cap over the part that stops, m. */
const LAND_CAP_NARROW_M = 2;
/** A timber trestle's bents stand this far apart, and their feet this far under the sea. [default] */
const BENT_SPACING_M = 8;
const BENT_FOOT_Y = -1.5;
/** The trestle-bent model's authored height and cap width (tools/blender/props/trestle_bent.py). */
const BENT_MODEL_H = 10;
const BENT_MODEL_W = 12.8;
/** A cable car's slot rails: each sits this far either side of its lane's centre, m. */
const CABLE_RAIL_D = 0.55;
/** The slot's cover plates between the rails come this often, m. [default] */
const CABLE_COVER_EVERY_M = 12;
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
    conifer: [
      { size: [0.4, 4, 0.4], at: [0, 2, 0], color: '#5b4636' },
      { size: [4.4, 4, 4.4], at: [0, 5, 0], color: '#2f5a3a', rotY: 0.4 },
      { size: [2.8, 4, 2.8], at: [0, 8.5, 0], color: '#1f3d2b', rotY: 0.9 },
      { size: [1.2, 3, 1.2], at: [0, 11.5, 0], color: '#2f5a3a' },
    ],
    house: [
      { size: [6.4, 10.5, 11], at: [0, 5.25, -5.5], color: '#d8c3a8' },
      { size: [6.6, 0.5, 0.6], at: [0, 10.3, 0.1], color: '#f4efe4' },
    ],
    sawmill: [
      { size: [20, 8, 11], at: [-4, 4, -10.5], color: '#8d8473' },
      { size: [8, 13, 8], at: [13, 6.5, -10], color: '#3d3b39' },
    ],
    fogBank: [{ size: [60, 8, 24], at: [0, 4, 0], color: '#ffffff' }],
    // run W-Q: a sandbar with a palm (its origin 0.8 m under the waterline, as the models')
    islet: [
      { size: [16, 1.6, 12], at: [0, 0.8, 0], color: '#e8d6a6' },
      { size: [0.3, 5, 0.3], at: [-2, 4, 0], color: '#7a5d42' },
      { size: [3.6, 0.5, 3.6], at: [-2, 6.6, 0], color: '#3f8a43', rotY: 0.4 },
    ],
  };
  return mergeBoxes(parts[kind]);
}

/** Scenery kinds kept instanced: the boats bob every frame and the fog banks are unlit (run W-S). */
const INSTANCED_KINDS: ReadonlySet<SceneryKind> = new Set(['skiff', 'boat', 'fogBank']);

/** Which model draws each scenery kind. */
const MODEL_OF: Readonly<Record<SceneryKind, keyof SceneryModels>> = {
  palm: 'palms',
  mangrove: 'mangroves',
  shack: 'baitShack',
  pole: 'powerPole',
  skiff: 'skiff',
  boat: 'boat',
  conifer: 'conifers',
  house: 'rowHouses',
  sawmill: 'sawmill',
  fogBank: 'fogBanks',
  islet: 'keysIslets',
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
  /** Each edge's land reach per sample and side, and its sample step (RoadScene.landReach). */
  const landOf: { step: number; reach: Record<-1 | 1, number[]> }[] = [];
  /**
   * Each edge's land at its two end rows, per side: [level, reach] (see the end caps), the strip's
   * top at a reach, and the row's whole cross-section.
   */
  const landEnds: Record<
    -1 | 1,
    Record<'from' | 'to', readonly [number, number]> & {
      top: (end: 'from' | 'to', r: number) => Point3;
      profile: (end: 'from' | 'to') => Point3[];
    }
  >[] = [];
  /** End caps where an edge joins another road, drawn once every edge's land is known. */
  const joinCaps: {
    edge: Edge;
    side: -1 | 1;
    end: 'from' | 'to';
    cap: (level: number, reach: number) => void;
  }[] = [];
  const truckParts: BoxPart[] = [];
  const truckMatrices: Matrix4[] = [];
  const truckModel = opts.models?.truck;
  let boostPads = 0;
  let rampTrucks = 0;
  // The race seed picks one candidate per set-piece slot from the network's own features, the
  // same call the sim makes (sim/riders/features.ts), so the pad or truck drawn is the one that
  // boosts or launches.
  const picked = chooseSetPieces(road.edges, opts.seed ?? 1);
  const setPieces: DrawnSetPiece[] = [];
  let sceneryLandM = 0;
  const density = Math.max(0, opts.roadsideDensity ?? 1);
  const seed = opts.seed ?? 1;
  const tropical = isTropical(road.edges.map((e) => dressingOf(e, dressing).tags));
  // A network that is not tropical gets the terrain skirt; one with forest gets timber trestles.
  const terrain = !tropical;
  const timber =
    terrain && road.edges.some((e) => (dressingOf(e, dressing).tags ?? []).some((t) => t.tag === 'forest'));
  const bentModel = timber ? opts.models?.trestleBent : undefined;
  const bentMatrices: Matrix4[] = [];
  const nearWater = terrain ? waterGrid(road, dressing) : () => false;
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
    /**
     * Whether another road runs under (s, d) well below this road (BURIED_M or more), where this
     * road's land would bury it. A road at about this road's height (a merge, a junction) is not.
     */
    const lowerRoadAt = (s: number, d: number, margin: number) => {
      const p = w(e.index, s, d, 0);
      const top = w(e.index, s, 0, 0).y - BURIED_M;
      return locator.covered(p.x, p.z, e.index, (o, os) =>
        w(o.index, os, 0, 0).y < top ? [o.dMin - VERGE_M - margin, o.dMax + VERGE_M + margin] : null,
      );
    };
    /** No lower road under the land strip anywhere from d0 out to d1 (looked for every few metres). */
    const stripClear = (s: number, side: -1 | 1, d0: number, d1: number) => {
      for (let d = d0 + STRIP_ROAD_PROBE_M; d < d1; d += STRIP_ROAD_PROBE_M)
        if (lowerRoadAt(s, side * d, 1)) return false;
      return true;
    };
    const step = ss.length > 1 ? e.length / (ss.length - 1) : e.length;
    const reachOf: Record<-1 | 1, number[]> = { [-1]: [], [1]: [] };
    landOf[e.index] = { step, reach: reachOf };
    /** The terrain skirt per sample: its slope's run and its flat ground's width past the strip, m. */
    const skirtOf: Record<-1 | 1, ({ run: number; flat: number } | null)[]> = { [-1]: [], [1]: [] };
    /** The skirt's flat ground as drawn, per side: each row's foot and far edge, and the rows kept. */
    const flatOf: Record<-1 | 1, { rows: (readonly [Point3, Point3] | null)[]; kept: boolean[] }> = {
      [-1]: { rows: [], kept: [] },
      [1]: { rows: [], kept: [] },
    };
    /**
     * Whether (s, d) stands on the flat ground exactly as drawn (run W-O's skeptic: far conifers
     * stood over the water, where the kept rows' quads, not the per-row widths, end).
     */
    const onFlat = (side: -1 | 1, s: number, d: number): boolean => {
      const { rows, kept } = flatOf[side];
      let a = Math.max(0, Math.min(rows.length - 2, Math.floor(s / step)));
      let b = a + 1;
      while (a > 0 && rows[a] && !kept[a]) a--;
      while (b < rows.length - 1 && rows[b] && !kept[b]) b++;
      const ra = rows[a];
      const rb = rows[b];
      if (!ra || !rb) return false;
      for (let i = a + 1; i < b; i++) if (!rows[i]) return false;
      const p = w(e.index, s, d, 0);
      const [fa, xa] = ra;
      const [fb, xb] = rb;
      // The strip's two triangles per quad, as ChunkedStrips cuts them (pairs in increasing d).
      return side > 0
        ? inTriangle(p, fa, xa, fb) || inTriangle(p, xa, xb, fb)
        : inTriangle(p, xa, fa, xb) || inTriangle(p, fa, fb, xb);
    };
    /** The skirt at s past a strip of width r, or null where none fits (the shelf drops into the sea). */
    const skirtAt = (side: -1 | 1, s: number, r: number): { run: number; flat: number } | null => {
      const outer = outerOf(side);
      const height = w(e.index, s, side * (outer + r), LAND_TOP_M).y - GROUND_Y;
      const k = insideKappa(side, s);
      const room = k > 0 ? LAND_FOLD / k - outer - r - SCENERY_SHELF_M : Infinity;
      const run = Math.min(SKIRT_RUN_M[1], Math.max(SKIRT_RUN_M[0], height * SKIRT_RUN_PER_M));
      const free = (d: number) => {
        if (otherRoadAt(s, side * d, 2)) return false;
        const p = w(e.index, s, side * d, 0);
        return !nearWater(p.x, p.z, SKIRT_WATER_CLEAR_M);
      };
      /** No lower road under the skirt anywhere from d0 out to d1 (water is looked for by `free`). */
      const noRoad = (d0: number, d1: number) => {
        for (let d = d0 + SKIRT_ROAD_PROBE_M; d < d1; d += SKIRT_ROAD_PROBE_M)
          if (lowerRoadAt(s, side * d, 2)) return false;
        return true;
      };
      const foot = outer + r + run;
      if (run > room || !free(outer + r + run / 2) || !free(foot) || !noRoad(outer + r, foot)) return null;
      for (const flat of SKIRT_FLAT_M) {
        if (run + flat > room) continue;
        if (flat === 0 || (free(foot + flat / 2) && free(foot + flat) && noRoad(foot, foot + flat)))
          return { run, flat };
      }
      return null;
    };
    /** Samples whose land runs up to another road, so no shelf drops into the sea there. */
    const meetsOf: Record<-1 | 1, boolean[]> = { [-1]: [], [1]: [] };
    /** The sharpest turn toward a side within SCENERY_LAND_M of s (kappa > 0 turns right, +d). */
    const insideKappa = (side: -1 | 1, s: number): number => {
      let k = 0;
      for (let u = s - SCENERY_LAND_M; u <= s + SCENERY_LAND_M; u += STEP_M) {
        if (u < 0 || u > e.length) continue;
        k = Math.max(k, side * road.kappaAt(e.index, u));
      }
      return k;
    };
    for (const side of [-1, 1] as const) {
      const outer = outerOf(side);
      const reach = reachOf[side];
      const meets = meetsOf[side];
      for (const s of ss) {
        const th = theme(side, s);
        const land =
          th !== 'none' &&
          th !== 'water' &&
          !railsOf[side].some((b) => s >= b.s0 - 5 && s <= b.s1 + 5) &&
          !(untagged && w(e.index, s, 0, 0).y >= ELEVATED_M);
        let r = 0;
        if (land) {
          // On the inside of a tight turn a wide strip would fold over the turn's centre, and its
          // folded triangles face down, so the sea shows through (playtest 1c skeptic, SF's
          // switchbacks). The strip and its shelf stay inside LAND_FOLD of the turn's radius.
          const k = insideKappa(side, s);
          const room = k > 0 ? LAND_FOLD / k - outer - SCENERY_SHELF_M : Infinity;
          for (const width of [SCENERY_LAND_M, 14, 6]) {
            if (width > room) continue;
            const d = outer + width + SCENERY_SHELF_M;
            if (
              !otherRoadAt(s, side * d, 1) &&
              !otherRoadAt(s, side * (outer + width / 2), 1) &&
              stripClear(s, side, outer, d)
            ) {
              r = width;
              break;
            }
          }
          // Between two roads too close for a shelf (a merge, a shortcut beside the main road), the
          // land runs on to the other road's verge instead of stopping, so the gap between them is
          // ground, not a sea-coloured wedge (playtest 1c skeptic: "a sea-coloured wedge between the
          // main road and the merge road"). No shelf: the other road's own embankment meets it.
          if (r === 0) {
            for (const width of LAND_GAP_WIDTHS) {
              if (width > room) continue;
              if (
                !otherRoadAt(s, side * (outer + width), LAND_GAP_MARGIN_M) &&
                !otherRoadAt(s, side * (outer + width / 2), LAND_GAP_MARGIN_M)
              ) {
                r = width;
                meets[reach.length] = true;
                break;
              }
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
      // The terrain skirt (not on the Keys): from the strip's edge a slope down to flat ground just
      // over the sea, then a short shelf into it. It shortens, or falls back to the shelf alone,
      // where it would bury another road, cover another road's water or fold on a tight turn.
      const skirts = skirtOf[side];
      ss.forEach((s, i) => {
        const r = reach[i] ?? 0;
        skirts.push(terrain && r > 0 && !meetsOf[side][i] ? skirtAt(side, s, r) : null);
      });
      // The skirt is wide and plain, so it keeps every third sample (and every sample where a run
      // starts or ends): about half the land's triangles.
      const run = (rows: (readonly [Point3, Point3] | null)[], thin = true) => {
        const g = strip('land');
        const kept = keptRows(rows, thin);
        g.breakStrip();
        for (const [i, row] of rows.entries()) {
          if (!row) {
            g.breakStrip();
            continue;
          }
          if (!kept[i]) continue;
          // Pairs in increasing d, so the faces point up (and out, on a slope).
          if (side < 0) g.pair(row[1], row[0]);
          else g.pair(row[0], row[1]);
        }
        g.breakStrip();
      };
      const at = (s: number, d: number, y: number) => ({ ...w(e.index, s, side * d, 0), y });
      const top = (s: number, r: number) => w(e.index, s, side * (outer + r), LAND_TOP_M);
      // The slope keeps every third foot but every top: its top edge is the strip's own edge, vertex
      // for vertex. Thinned there too, its chords cut inside a bend's arc and left a sliver open
      // between the strip and the slope (the 1 to 2 px light seam on Twin Peaks, run W-S): each
      // thinned quad is a fan from its two feet to every top between them.
      const g = strip('land');
      const slope = ss.map((s, i): readonly [Point3, Point3] | null => {
        const k = skirts[i];
        const r = reach[i] ?? 0;
        return k ? [top(s, r), at(s, outer + r + k.run, GROUND_Y)] : null;
      });
      const keptSlope = keptRows(slope);
      for (let a = 0; a < slope.length; a++) {
        const ra = slope[a];
        if (!ra || !keptSlope[a]) continue;
        let b = a + 1;
        while (b < slope.length && slope[b] && !keptSlope[b]) b++;
        const rb = slope[b];
        if (!rb) continue;
        const mid = Math.floor((a + b) / 2);
        // Faces up (and out), as the strips' pairs in increasing d make them.
        const face = (t0: Point3, t1: Point3, foot: Point3) =>
          side > 0 ? g.tri(t0, foot, t1) : g.tri(t0, t1, foot);
        for (let j = a; j < b; j++) face(slope[j]![0], slope[j + 1]![0], j < mid ? ra[1] : rb[1]);
        const tm = slope[mid]![0];
        if (side > 0) g.tri(ra[1], rb[1], tm);
        else g.tri(ra[1], tm, rb[1]);
      }
      const flatRows = ss.map((s, i): readonly [Point3, Point3] | null => {
        const k = skirts[i];
        const foot = outer + (reach[i] ?? 0) + (k?.run ?? 0);
        return k && k.flat > 0 ? [at(s, foot, GROUND_Y), at(s, foot + k.flat, GROUND_Y)] : null;
      });
      flatOf[side] = { rows: flatRows, kept: keptRows(flatRows) };
      run(flatRows);
      // The shelf into the sea: at the far edge of the skirt, or at the strip's edge without one. The
      // two are separate runs: joined, a row with a skirt and the next without one made a sliver
      // from the skirt's far edge back to the strip's (run W-P; the caps below close the step).
      /** A row whose shelf hangs at the strip's edge (land, no skirt, not running to another road). */
      const edgeShelf = (i: number) => (reach[i] ?? 0) > 0 && !meetsOf[side][i] && !skirts[i];
      for (const skirted of [false, true]) {
        run(
          ss.map((s, i) => {
            const r = reach[i] ?? 0;
            const k = skirts[i];
            if (r <= 0 || meetsOf[side][i]) return null;
            // The edge shelf reaches one row into a skirted neighbour (hidden there under the
            // slope), so where the skirt comes and goes no gap opens under the strip's edge.
            const nextToEdge = edgeShelf(i - 1) || edgeShelf(i + 1);
            if (skirted ? !k : !(edgeShelf(i) || nextToEdge)) return null;
            if (!skirted) return [top(s, r), at(s, outer + r + SCENERY_SHELF_M, -0.4)];
            if (!k) return null;
            const far = outer + r + k.run + k.flat;
            return [at(s, far, GROUND_Y), at(s, far + SCENERY_SHELF_M, -0.4)];
          }),
          // The shelf at the strip's edge hangs from that edge, drawn every row: thinned, its chords
          // left slivers of sky under the strip on the hairpins.
          skirted,
        );
      }
      // End caps (run W-O's skeptic: "row houses stand on flat land plates that float, with sky and
      // bay under them, at the bridge ends"). Where the land stops partway along the road (a bridge,
      // a rail, a theme or another road) or at a dead end, its cross-section was open, so from the
      // bridge you saw under the plate and its slope to the sky. A curtain now hangs from that row's
      // profile, the road's half above it included, down under the sea. Where the strip narrows
      // sharply, or only the slope or the shelf stops, the part past the narrower land is closed the
      // same way.
      const level = (i: number) => {
        if ((reach[i] ?? 0) <= 0) return 0;
        if (meetsOf[side][i]) return 1;
        return skirts[i] ? 3 : 2;
      };
      const caps = strip('land');
      /** A curtain from each point down under the sea, both faces (it is seen from either side). */
      const curtain = (pts: readonly Point3[]) => {
        for (const flip of [false, true]) {
          caps.breakStrip();
          for (const p of pts) {
            const foot = { ...p, y: LAND_CAP_FOOT_Y };
            if (flip) caps.pair(foot, p);
            else caps.pair(p, foot);
          }
          caps.breakStrip();
        }
      };
      /** Row i's land in cross-section, from the verge outward: the strip, then its skirt or shelf. */
      const profileOf = (i: number): Point3[] => {
        const li = level(i);
        if (li === 0) return [];
        const s = ss[i] ?? 0;
        const r = reach[i] ?? 0;
        const k = skirts[i];
        const profile = [top(s, 0), top(s, r)];
        if (k) {
          profile.push(at(s, outer + r + k.run, GROUND_Y));
          if (k.flat > 0) profile.push(at(s, outer + r + k.run + k.flat, GROUND_Y));
          profile.push(at(s, outer + r + k.run + k.flat + SCENERY_SHELF_M, LAND_CAP_FOOT_Y));
        } else if (li === 2) profile.push(at(s, outer + r + SCENERY_SHELF_M, LAND_CAP_FOOT_Y));
        return profile;
      };
      /** Closes row i's land past what the neighbouring land (level lj, reach rj) covers. */
      const capAt = (i: number, lj: number, rj: number) => {
        const li = level(i);
        const r = reach[i] ?? 0;
        if (li === 0 || (lj >= li && rj >= r - LAND_CAP_NARROW_M)) return;
        const s = ss[i] ?? 0;
        const [near, ...rest] = profileOf(i);
        const head = lj === 0 ? [w(e.index, s, 0, LAND_TOP_M), near!] : rj < r ? [top(s, rj)] : [];
        curtain([...head, ...rest]);
      };
      const last = ss.length - 1;
      const rowOf = (end: 'from' | 'to') => (end === 'from' ? 0 : last);
      landEnds[e.index] ??= {} as (typeof landEnds)[number];
      landEnds[e.index]![side] = {
        from: [level(0), level(0) === 0 ? 0 : (reach[0] ?? 0)],
        to: [level(last), level(last) === 0 ? 0 : (reach[last] ?? 0)],
        top: (end, r) => top(ss[rowOf(end)] ?? 0, r),
        profile: (end) => profileOf(rowOf(end)),
      };
      for (let i = 0; i < ss.length; i++) {
        for (const j of [i - 1, i + 1]) {
          const atEnd = j < 0 || j >= ss.length;
          // An edge's end that joins another road is closed against that road's land at the join,
          // once every road's land is known (run W-P's roadside verifier: where Twin Peaks' Upper
          // Market joins Portola, Portola's land reached 10 m further out than Upper Market's, and
          // the sky showed under its ledge).
          if (atEnd && (j < 0 ? e.prevLinks : e.nextLinks).length > 0) {
            joinCaps.push({ edge: e, side, end: j < 0 ? 'from' : 'to', cap: (lj, rj) => capAt(i, lj, rj) });
            continue;
          }
          const lj = atEnd ? 0 : level(j);
          capAt(i, lj, lj === 0 ? 0 : (reach[j] ?? 0));
        }
      }
      // A strip that runs on to another road's verge has no shelf (the other road's own bank meets
      // it). On a hill the two can stand metres apart in height (the Gorge's stacked loops), so a
      // curtain drops from the strip's edge instead, and nothing shows under it.
      const meetsAt = (i: number) => (reach[i] ?? 0) > 0 && !!meetsOf[side][i];
      for (const flip of terrain ? [false, true] : []) {
        caps.breakStrip();
        ss.forEach((s, i) => {
          const r = reach[i] ?? 0;
          // One row past each end too, so it meets the shelf or slope beside it with no gap.
          if (r <= 0 || !(meetsAt(i) || meetsAt(i - 1) || meetsAt(i + 1))) {
            caps.breakStrip();
            return;
          }
          const p = top(s, r);
          const foot = { ...p, y: LAND_CAP_FOOT_Y };
          if (flip) caps.pair(foot, p);
          else caps.pair(p, foot);
        });
        caps.breakStrip();
      }
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
        band: (side, s) => ridableBandPast(road, e.index, side, s, outerOf(side)),
        sameBatch: (a, b) =>
          Math.floor(a.x / SCENERY_CHUNK_M) === Math.floor(b.x / SCENERY_CHUNK_M) &&
          Math.floor(a.z / SCENERY_CHUNK_M) === Math.floor(b.z / SCENERY_CHUNK_M),
        // The land between two samples is a strip quad: only as wide as its narrower end, and none
        // where either end has none (the strip breaks there).
        landReach: (side, s) => {
          const i = Math.max(0, Math.min(ss.length - 1, Math.floor(s / step)));
          const j = Math.min(ss.length - 1, i + 1);
          return Math.min(reachOf[side][i] ?? 0, reachOf[side][j] ?? 0);
        },
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
        skirt: terrain
          ? (side, s) => {
              const i = Math.max(0, Math.min(ss.length - 1, Math.round(s / step)));
              const k = skirtOf[side][i];
              if (!k || k.flat <= 0) return null;
              const from = (reachOf[side][i] ?? 0) + k.run;
              return { from, to: from + k.flat, y: GROUND_Y };
            }
          : undefined,
        onFarGround: terrain
          ? (side, s, d) => {
              if (!FAR_ROOTS.every(([ds, dd]) => onFlat(side, s + ds, d + side * dd))) return false;
              // Another stretch of this same road (a hairpin) can pass over the far ground too.
              const p = w(e.index, s, d, 0);
              return !locator.covered(p.x, p.z, -1, (o) => [o.dMin - VERGE_M - 2, o.dMax + VERGE_M + 2]);
            }
          : undefined,
        fogBanks: opts.palette?.['fogBank'] !== undefined,
      }),
    );
    // Deck fascia on bridges, an embankment down to the water elsewhere, on both sides.
    for (const [d, out] of [
      [outerL, -1],
      [outerR, 1],
    ] as const) {
      const deck = strip('deck');
      deck.breakStrip();
      for (const [i, s] of ss.entries()) {
        // A terrain network's land strip hides the fascia where it meets the verge: skip it there.
        if (terrain && (reachOf[out][i] ?? 0) > 0) {
          deck.breakStrip();
          continue;
        }
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
    // Delineator posts every 25 m on a highway's verge (only highways: the maintainer, interview,
    // 2026-10-02, "posts only on highways"), a sense of speed. On a terrain network they stand
    // wherever there is ground beside the road; elsewhere only off the bridges (the rails do it there).
    const groundAt = (side: -1 | 1, s: number) =>
      (reachOf[side][Math.max(0, Math.min(ss.length - 1, Math.round(s / step)))] ?? 0) > 0;
    const postsHere = (opts.postRoads ?? isHighway)(e);
    for (let s = 0; postsHere && s < e.length; s += 25) {
      const high = road.toWorld(e.index, s, 0, 0).y >= ELEVATED_M;
      for (const [side, d] of [
        [-1, outerL + 0.25],
        [1, outerR - 0.25],
      ] as const) {
        if (high && !(terrain && groundAt(side, s))) continue;
        // Where two roads overlap, a post on one road's verge can stand in the other's lane.
        if (!onOtherLanes(e, s, d)) postSpots.push(w(e.index, s, d, 0.55));
      }
    }
    // Pylons under a deck every 24 m (none where the terrain's ground stands on both sides), or a
    // forest network's timber trestle bents under its bridges, every few metres.
    const bridgeAt = (s: number) => (tags ?? []).some((t) => t.tag === 'bridge' && s >= t.s0 && s <= t.s1);
    if (bentModel) {
      for (let s = BENT_SPACING_M / 2; s < e.length; s += BENT_SPACING_M) {
        const deckY = road.toWorld(e.index, s, 0, 0).y;
        if (!bridgeAt(s) || deckY < 1) continue;
        bentMatrices.push(bentMatrix(road, e.index, s, outerL, outerR, deckY - 0.95));
      }
    }
    for (let s = 12; s < e.length; s += 24) {
      if (terrain && groundAt(-1, s) && groundAt(1, s)) continue;
      if (bentModel && bridgeAt(s)) continue;
      for (const d of [e.dMin + 0.8, e.dMax - 0.8]) {
        const p = w(e.index, s, d, 0);
        if (p.y >= ELEVATED_M) pylonSpots.push({ p: { x: p.x, y: -0.5, z: p.z }, h: p.y - 1 + 0.5 });
      }
    }
    // A cable-car line: two slot rails down the middle of each travel lane.
    for (const t of (tags ?? []).filter((x) => x.tag === 'cable-line')) {
      const s0 = Math.max(0, t.s0);
      const s1 = Math.min(e.length, t.s1);
      const lanes = road.lanesAt(e.index, (s0 + s1) / 2).filter((l) => l.kind === 'drive');
      for (const l of lanes) {
        for (const off of [-CABLE_RAIL_D, CABLE_RAIL_D]) {
          const slot = strip('cableSlot');
          slot.breakStrip();
          for (let u = s0; ; u = Math.min(s1, u + STEP_M)) {
            const d = l.dCenterM + off;
            slot.pair(w(e.index, u, d - 0.05, 0.028), w(e.index, u, d + 0.05, 0.028));
            if (u >= s1) break;
          }
          slot.breakStrip();
        }
        // Run W-P: the slot's cover plates between the rails, a beat of them under the wheels.
        for (let u = s0 + 6; u + 0.7 < s1; u += CABLE_COVER_EVERY_M) {
          const d = l.dCenterM;
          strip('cableSlot').quad(
            w(e.index, u, d - 0.38, 0.029),
            w(e.index, u, d + 0.38, 0.029),
            w(e.index, u + 0.7, d - 0.38, 0.029),
            w(e.index, u + 0.7, d + 0.38, 0.029),
          );
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
        // On a terrain network a wall is a concrete retaining wall, not the bridge's painted rail.
        const rail = strip(terrain && b.kind === 'wall' ? 'deck' : 'rail');
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
      if (f.kind !== 'boostPad' && f.kind !== 'rampTruck') continue;
      const slot = slotOf(f);
      if (slot !== null && !picked.has(f.id ?? '')) continue;
      const drawn = () => {
        const centre = w(e.index, (f.s0 + f.s1) / 2, (f.d0 + f.d1) / 2, 0);
        setPieces.push({ id: f.id ?? '', kind: f.kind, slot, x: centre.x, z: centre.z });
      };
      if (f.kind === 'boostPad') {
        const s0 = Math.max(0, Math.min(f.s0, f.s1));
        const s1 = Math.min(e.length, Math.max(f.s0, f.s1));
        const lo = Math.min(f.d0, f.d1);
        const hi = Math.max(f.d0, f.d1);
        if (s1 <= s0) continue;
        drawn();
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
      } else {
        drawn();
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
  // An edge's land at a junction is closed against the joined road's land on the same side there
  // (a join that flips direction swaps the sides): where some joined road's land goes on as far
  // out, nothing is needed; elsewhere the part past it gets a curtain, as at any narrowing.
  // The two end rows meet at the road's centre but fan apart on the outside of a turn, and the
  // sky showed through the wedge between them as a thin line (run W-P, Upper Market into Portola),
  // so the land between them is drawn too: the whole cross-section where both rows have the same
  // kind of land, else the strip to the narrower reach and a curtain down from its edge.
  const joinLand = strip('land');
  for (const { edge, side, end, cap } of joinCaps) {
    let best: readonly [number, number] = [0, 0];
    const mine = landEnds[edge.index]?.[side];
    for (const l of end === 'to' ? edge.nextLinks : edge.prevLinks) {
      const theirs = landEnds[l.edge]?.[(end === l.entersAt ? -side : side) as -1 | 1];
      const their = theirs?.[l.entersAt];
      if (their && (their[1] > best[1] || (their[1] === best[1] && their[0] > best[0]))) best = their;
      // Each join once, from the edge with the lower index.
      if (!mine || !theirs || !their || l.edge <= edge.index) continue;
      const pa = mine.profile(end);
      const pb = theirs.profile(l.entersAt);
      if (pa.length === 0 || pb.length === 0 || Math.abs(pa[0]!.y - pb[0]!.y) > JOIN_LAND_DY_M) continue;
      const same = mine[end][0] === their[0] && pa.length === pb.length;
      const r = Math.min(mine[end][1], their[1]);
      const a = same ? pa : [pa[0]!, mine.top(end, r)];
      const b = same ? pb : [pb[0]!, theirs.top(l.entersAt, r)];
      // In this edge's frame: the row with the lower s first, each quad's lower d first (faces up).
      const [first, second] = end === 'to' ? [a, b] : [b, a];
      for (let k = 0; k + 1 < first.length; k++) {
        const [lo, hi] = side > 0 ? [k, k + 1] : [k + 1, k];
        joinLand.quad(first[lo]!, first[hi]!, second[lo]!, second[hi]!);
      }
      if (same) continue;
      const ta = first[first.length - 1]!;
      const tb = second[second.length - 1]!;
      const fa = { ...ta, y: LAND_CAP_FOOT_Y };
      const fb = { ...tb, y: LAND_CAP_FOOT_Y };
      joinLand.quad(fa, ta, fb, tb);
      joinLand.quad(ta, fa, tb, fb);
    }
    cap(best[0], best[1]);
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
      const color = LAYER_COLOR[layer];
      const mesh = new Mesh(
        part.build(),
        look.material(kind, { doubleSided: doubleSided.has(kind), ...(color ? { color } : {}) }),
      );
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
    geo: BufferGeometry,
    kind: MaterialKind,
    spots: readonly { p: Point3; h: number }[],
  ) =>
    addInstanced(name, geo, look.material(kind), spots, ({ p, h }) =>
      m.compose(new Vector3(p.x, p.y, p.z), q, one.clone().setY(h)),
    );
  // Run W-S (the triangle headroom): no face nobody sees. A post's foot stands on the ground or the
  // deck; a pylon's foot is under the sea and its top under the deck, inside the fascias.
  boxes(
    'road-posts',
    openBox(0.15, 1.1, 0.15, ['ny']),
    'post',
    postSpots.map((p) => ({ p, h: 1 })),
  );
  // Unit-height boxes standing on their base, stretched by the instance scale.
  boxes('road-rail-posts', openBox(0.1, 1, 0.1, ['ny']).translate(0, 0.5, 0), 'rail', railPostSpots);
  boxes('road-pylons', openBox(0.9, 1, 0.9, ['ny', 'py']).translate(0, 0.5, 0), 'deck', pylonSpots);
  if (truckParts.length) {
    // Few and small: one mesh for every truck on the network.
    const trucks = new Mesh(mergeBoxes(truckParts), look.material('vehicle', { vertexColors: true }));
    trucks.name = 'road-rampTrucks';
    triangles += (trucks.geometry.index?.count ?? 0) / 3;
    group.add(trucks);
    meshes++;
  }
  const shared = new Set<BufferGeometry>();
  const bentGeo = bentModel?.variants[0];
  if (bentGeo && bentMatrices.length) {
    shared.add(bentGeo);
    addInstanced(
      'road-trestle',
      bentGeo,
      look.material('prop', { vertexColors: true }),
      bentMatrices.map((mx) => ({ p: { x: mx.elements[12], y: 0, z: mx.elements[14] }, mx })),
      (b) => b.mx,
    );
  }
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

  // Scenery (playtest 1c). The still props merge per block, a square of the world (scenery-merge.ts,
  // run W-S): one mesh per block, built near the camera, drawn as far stand-ins past the
  // level-of-detail distance. The boats bob and the fog banks are unlit, so those stay one InstancedMesh per model
  // variant per SCENERY_CHUNK_M square, which the renderer hides past the draw distance.
  const scenery = new Group();
  scenery.name = 'road-scenery';
  group.add(scenery);
  const batches: SceneryBatch[] = [];
  const mergeItems: MergeItem[] = [];
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
    // Fog banks are unlit, in the region's fog-bank colour, so they melt into the haze.
    const fogHex = opts.palette?.['fogBank'];
    const material =
      kind === 'fogBank'
        ? look.material('splash', { color: fogHex ?? '#e3e6e8' })
        : look.material('prop', { vertexColors: true, doubleSided: model?.doubleSided ?? false });
    if (!INSTANCED_KINDS.has(kind)) {
      for (const s of mine) {
        const geometry = geos[Math.min(geos.length - 1, s.variant)] ?? geos[0];
        if (geometry) mergeItems.push({ spot: s, geometry, material });
      }
      continue;
    }
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
      batches.push({
        mesh,
        spots: list,
        cx,
        cz,
        radius,
        boats: kind === 'skiff' || kind === 'boat',
        always: kind === 'fogBank',
      });
    }
  }
  const merged = new MergedScenery(
    mergeItems,
    look.material('prop', { vertexColors: true, doubleSided: true }),
  );
  scenery.add(merged.group);
  // Counted at full detail, as the instanced batches were (the meshes are built as the camera comes).
  triangles += merged.triangles;
  meshes += merged.count;

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
      setPieces,
      sceneryLandM,
      scenery: counts,
      sceneryModels: fromModels,
    },
    spots,
    landReach(edge, side, s) {
      const l = landOf[edge];
      if (!l) return 0;
      const n = l.reach[side].length;
      const i = Math.max(0, Math.min(n - 1, Math.floor(s / l.step)));
      return Math.min(l.reach[side][i] ?? 0, l.reach[side][Math.min(n - 1, i + 1)] ?? 0);
    },
    update(cameraX, cameraZ, t, drawM, lodM = SCENERY_LOD_M, builds = 1) {
      let shown = merged.update(cameraX, cameraZ, drawM, lodM, builds);
      for (const b of batches) {
        const visible = b.always || Math.hypot(b.cx - cameraX, b.cz - cameraZ) - b.radius < drawM;
        b.mesh.visible = visible;
        if (!visible) continue;
        if (!b.always) shown += b.spots.length;
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
    merged: () => merged.counts(),
    dispose() {
      merged.dispose();
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
  /** Fog banks: far by nature, so the scenery draw distance never hides them (the fog does). */
  always: boolean;
}

const bobEuler = new Euler();
const bobAt = new Vector3();

/** The rows a thinned skirt strip keeps: every third, and every row where a run starts or ends. */
function keptRows(rows: readonly (readonly [Point3, Point3] | null)[], thin = true): boolean[] {
  return rows.map(
    (row, i) =>
      !!row && !(thin && i % SKIRT_EVERY !== 0 && i < rows.length - 1 && !!rows[i - 1] && !!rows[i + 1]),
  );
}

/** Whether p lies in the triangle abc, seen from above (x and z). */
function inTriangle(p: Point3, a: Point3, b: Point3, c: Point3): boolean {
  const cross = (u: Point3, v: Point3) => (v.x - u.x) * (p.z - u.z) - (v.z - u.z) * (p.x - u.x);
  const d1 = cross(a, b);
  const d2 = cross(b, c);
  const d3 = cross(c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/** Triangles in a geometry, indexed or not. */
function trisOf(g: BufferGeometry): number {
  return (g.index?.count ?? g.getAttribute('position').count) / 3;
}

/**
 * Where a trestle bent goes: on the ground under the road's centre at s, across the road, as wide
 * as the deck and its verges and tall enough that its cap meets the deck's underside.
 */
function bentMatrix(
  road: RoadNetwork,
  edge: number,
  s: number,
  outerL: number,
  outerR: number,
  capY: number,
): Matrix4 {
  const mid = (outerL + outerR) / 2;
  const at = (u: number, d: number, h: number) => {
    const p = road.toWorld(edge, u, d, h);
    return new Vector3(p.x, p.y, p.z);
  };
  const c = at(s, mid, 0);
  const fwd = at(s + 1, mid, 0)
    .sub(c)
    .setY(0)
    .normalize();
  const up = new Vector3(0, 1, 0);
  const left = new Vector3().crossVectors(up, fwd).normalize();
  const sx = (outerR - outerL) / BENT_MODEL_W;
  const sy = Math.max(0.2, (capY - BENT_FOOT_Y) / BENT_MODEL_H);
  return new Matrix4()
    .makeBasis(left.multiplyScalar(sx), up.multiplyScalar(sy), fwd)
    .setPosition(c.x, BENT_FOOT_Y, c.z);
}

/**
 * Where water lies beside a network: points out on every water-tagged side, on a coarse grid, so the
 * terrain skirt of one road never covers the water beside another. Returns a test: is there water
 * within `r` metres of (x, z)?
 */
function waterGrid(
  road: RoadNetwork,
  dressing: RoadDressing | undefined,
): (x: number, z: number, r: number) => boolean {
  const CELL = 40;
  const grid = new Map<string, Point3[]>();
  for (const e of road.edges) {
    const tags = dressingOf(e, dressing).tags;
    if (!tags?.some((t) => t.tag.startsWith('water'))) continue;
    for (let s = 0; s <= e.length; s += 10) {
      for (const side of [-1, 1] as const) {
        if (themeAt(tags, side < 0 ? 'left' : 'right', s) !== 'water') continue;
        const outer = side < 0 ? -e.dMin + VERGE_M : e.dMax + VERGE_M;
        for (const across of [4, 20, 45, 80, 130]) {
          const p = road.toWorld(e.index, s, side * (outer + across), 0);
          const key = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`;
          const list = grid.get(key);
          if (list) list.push(p);
          else grid.set(key, [p]);
        }
      }
    }
  }
  return (x, z, r) => {
    const span = Math.ceil(r / CELL);
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    for (let i = -span; i <= span; i++) {
      for (let j = -span; j <= span; j++) {
        for (const p of grid.get(`${cx + i},${cz + j}`) ?? [])
          if (Math.hypot(p.x - x, p.z - z) < r) return true;
      }
    }
    return false;
  };
}
