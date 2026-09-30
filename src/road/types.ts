// The baked road format as road/ reads it (docs/content-packs.md, "Road networks, roads and
// routes"). These are structural input types: content/'s parsed files satisfy them, so road/
// never imports content/. Optional fields carry `| undefined` for exactOptionalPropertyTypes.
import type { LaneInfo } from '../core';

export interface BakedLaneSection {
  s0: number;
  lanes: readonly LaneInfo[];
}

/** Feature kinds, exactly the architecture doc's list. */
export type FeatureKind =
  'ramp' | 'gap' | 'hazard' | 'roadsideZone' | 'copSpawn' | 'raceMarker' | 'billboard';

export interface BakedFeature {
  kind: string;
  id: string;
  s0: number;
  s1: number;
  d0: number;
  d1: number;
  params?: Readonly<Record<string, unknown>> | undefined;
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
}

/** Everything the road module needs to build one network. */
export interface BakedNetworkBundle {
  network: BakedNetwork;
  /** The network's roads, in any order; the network's `roads` list fixes the edge numbering. */
  roads: readonly BakedRoad[];
}
