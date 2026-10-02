// The baked road format as road/ reads it (docs/content-packs.md, "Road networks, roads and
// routes"). These are structural input types: content/'s parsed files satisfy them, so road/
// never imports content/. Optional fields carry `| undefined` for exactOptionalPropertyTypes.
import type { LaneInfo, MedianKind, RoadSurface, RouteBranchKind, VergeEdge, VergeSurface } from '../core';

/**
 * A verge band beside the road (W-Q cross-section; interview, 2026-10-02: "Anywhere with ground"):
 * `widthM` of `surface` past the outermost lane (its shoulder included), ending at an `edge`. A width
 * of 0 means the road's own edge is the edge (a bridge rail, a wall, the sea).
 */
export interface BakedVerge {
  widthM: number;
  surface: VergeSurface;
  edge: VergeEdge;
}

/** What divides the two directions (descriptive: the lanes' dCenterM already leave its gap). */
export interface BakedMedian {
  widthM: number;
  kind: MedianKind;
}

export interface BakedLaneSection {
  s0: number;
  lanes: readonly LaneInfo[];
  /** Optional median between the two directions. */
  median?: BakedMedian | undefined;
  /**
   * Optional verge bands per side. A side left out is derived from the road's tags and barriers at
   * each s (road/cross-section.ts, `deriveVerge`), so every existing road has ground beside it.
   */
  verges?: { left?: BakedVerge | undefined; right?: BakedVerge | undefined } | undefined;
}

/** Feature kinds, exactly the architecture doc's list. */
export type FeatureKind =
  | 'ramp'
  | 'gap'
  | 'hazard'
  | 'roadsideZone'
  | 'copSpawn'
  | 'raceMarker'
  | 'billboard'
  /**
   * A speed-boost pad (playtest 1b): a rider who rides over its s/d box gets a short boost.
   * `params.boostMps` (speed added, default 8) and `params.holdS` (how long, default 1.5).
   */
  | 'boostPad'
  /**
   * A parked car-carrier tow truck whose rear deck is a jump ramp (playtest 1b). s0 is the foot of
   * the ramp and s1 the truck's front; d0..d1 its width. The deck rises from the road at s0 to
   * `params.lipHeightM` (2.8) over `params.rampLengthM` (11.5, a 13.7° slope), then stays at the lip
   * height to s1. It faces riders travelling toward increasing s. Not baked into the road profile:
   * it covers only its own width.
   */
  | 'rampTruck';

export interface BakedFeature {
  kind: string;
  id: string;
  s0: number;
  s1: number;
  d0: number;
  d1: number;
  params?: Readonly<Record<string, unknown>> | undefined;
  /** A `billboard` slot's region item (a sign or billboard id), or the pool that fills it. */
  item?: string | undefined;
  pool?: 'signs' | 'billboards' | undefined;
}

/** A scenery tag over an s range (closed vocabulary in the content schema). */
export interface BakedTag {
  s0: number;
  s1: number;
  side: 'left' | 'right' | 'both';
  tag: string;
}

/** A rail or wall along one side of a road (docs/content-packs.md, "Barriers"). */
export interface BakedBarrier {
  s0: number;
  s1: number;
  side: 'left' | 'right' | 'both';
  kind: 'rail' | 'wall';
  heightM: number;
}

export interface BakedSamples {
  encoding: 'json-columns';
  columns: readonly string[];
  data: Readonly<Record<string, readonly number[]>>;
}

export interface BakedRoad {
  id: string;
  /** The network this road belongs to (checked by the road lint when present). */
  network?: string | undefined;
  from: string;
  to: string;
  lengthM: number;
  sampleSpacingM: number;
  /** What the lanes are made of; asphalt when absent. A dirt shortcut is a road with `dirt`. */
  surface?: RoadSurface | undefined;
  laneSections: readonly BakedLaneSection[];
  tags?: readonly BakedTag[] | undefined;
  features?: readonly BakedFeature[] | undefined;
  barriers?: readonly BakedBarrier[] | undefined;
  samples: BakedSamples;
}

export interface BakedJunctionEnd {
  road: string;
  end: 'from' | 'to';
}

/** One side of a connector row: a road end and a lane on that road. */
export interface BakedConnectorEnd {
  road: string;
  end: 'from' | 'to';
  lane: string;
}

/** Where on the `from` road a rider's lateral position picks this connector (no button press). */
export interface BakedSplitZone {
  s0: number;
  s1: number;
  d0: number;
  d1: number;
}

/**
 * One row of a junction's lane-level table (docs/content-packs.md, "Network file"): the `from`
 * road end meets the connector road's `from` end, the `to` road end meets its `to` end. A row
 * whose lanes run with direction −1 carries oncoming traffic back from `to` to `from`.
 */
export interface BakedConnector {
  id: string;
  road: string;
  from: BakedConnectorEnd;
  to: BakedConnectorEnd;
  splitZone?: BakedSplitZone | undefined;
}

export interface BakedJunction {
  id: string;
  x: number;
  y: number;
  z: number;
  ends: readonly BakedJunctionEnd[];
  /** Connector rows. Typed loosely, because parsed pack files may hold anything; see readConnector. */
  connectors: readonly unknown[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function readEnd(v: unknown): BakedConnectorEnd | null {
  if (!isRecord(v)) return null;
  const { road, end, lane } = v;
  if (typeof road !== 'string' || (end !== 'from' && end !== 'to') || typeof lane !== 'string') return null;
  return { road, end, lane };
}

/** A connector row read from untyped data, or null when it is malformed (the road lint says why). */
export function readConnector(v: unknown): BakedConnector | null {
  if (!isRecord(v)) return null;
  const from = readEnd(v['from']);
  const to = readEnd(v['to']);
  if (typeof v['id'] !== 'string' || typeof v['road'] !== 'string' || !from || !to) return null;
  const out: BakedConnector = { id: v['id'], road: v['road'], from, to };
  const z = v['splitZone'];
  if (z !== undefined) {
    if (!isRecord(z)) return null;
    const { s0, s1, d0, d1 } = z;
    if (typeof s0 !== 'number' || typeof s1 !== 'number' || typeof d0 !== 'number' || typeof d1 !== 'number')
      return null;
    out.splitZone = { s0, s1, d0, d1 };
  }
  return out;
}

export interface BakedNetwork {
  id: string;
  roads: readonly string[];
  junctions: readonly BakedJunction[];
}

export interface BakedRoute {
  id: string;
  network: string;
  start: { road: string; s: number; dir: 1 | -1 };
  finish: { road: string; s: number };
  mainPath: readonly string[];
  allowedRoads: readonly string[];
  checkpoints?: readonly { road: string; s: number }[] | undefined;
  closed: boolean;
  startGrid?: { rows: number; perRow: number; rowGapM: number } | undefined;
  /**
   * Named branches off the main path (W-Q; interview, 2026-10-02: "junction choices in races").
   * Optional: a split zone onto allowed roads that no entry names is still a branch, derived by
   * `createRouteProgress` (route.ts). An entry names one, gives it a stable id, and says what it is.
   */
  branches?: readonly BakedRouteBranch[] | undefined;
}

/**
 * One branch off a route's main path, as a route file names it. A rider picks it by position at
 * its split zone (no button), as every split in the network does.
 */
export interface BakedRouteBranch {
  /** Stable id within the route: the career records found shortcuts and secrets by it. */
  id: string;
  /** The branch's own roads, connectors included: every one in allowedRoads, none on the main path. */
  roads: readonly string[];
  /** Derived from what taking it saves when absent (`ROUTE_BRANCH_ALTERNATE_M`). */
  kind?: RouteBranchKind | undefined;
  /** Signed and drawn at the split (the default), or false for a secret found by riding it. */
  marked?: boolean | undefined;
  /** The deadpan sign at the split ("SANDBAR: NOT ADVISED."), when it has one. */
  sign?: string | undefined;
}

/** Everything the road module needs to build one network. */
export interface BakedNetworkBundle {
  network: BakedNetwork;
  /** The network's roads, in any order; the network's `roads` list fixes the edge numbering. */
  roads: readonly BakedRoad[];
}

/** A rampTruck's defaults, from the prop brief: 13.7° over an 11.5 m run to a 2.8 m lip. */
export const RAMP_TRUCK_DEFAULTS = { rampLengthM: 11.5, lipHeightM: 2.8 } as const;

/** A rampTruck's ramp: its run (m, from s0 to the lip) and its lip height above the road (m). */
export function rampTruckShape(f: BakedFeature): { run: number; lip: number } {
  const n = (key: string, fallback: number) => {
    const v = f.params?.[key];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return {
    run: n('rampLengthM', RAMP_TRUCK_DEFAULTS.rampLengthM),
    lip: n('lipHeightM', RAMP_TRUCK_DEFAULTS.lipHeightM),
  };
}
