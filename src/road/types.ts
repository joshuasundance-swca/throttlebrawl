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

export interface BakedJunction {
  id: string;
  x: number;
  y: number;
  z: number;
  ends: readonly BakedJunctionEnd[];
  connectors: readonly unknown[];
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
