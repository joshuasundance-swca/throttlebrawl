// road: the road network model and its queries (docs/architecture.md, "Road network"). DOM-free
// and deterministic, like the sim. The road lane (road-1, road-2) owns this folder after app-1.
export { createRoadNetwork, curvedRoadRates, sRateFactor } from './network';
export type {
  AdvanceResult,
  CurvedRates,
  Edge,
  EdgeLink,
  RoadFrame,
  RoadNeighbour,
  RoadNetwork,
  RoadPos,
  SplitZoneInfo,
  WorldPoint,
} from './network';
export {
  chooseSetPieces,
  SEEDED_SET_PIECE_KINDS,
  setPieceActive,
  setPieceSlot,
  setPieceSlots,
} from './setpieces';
export { createRouteProgress } from './route';
export type { RouteCheckpoint, RouteProgress, RouteShortcut } from './route';
export { FIXTURE_LANES, fixtureBranchNetwork, fixtureBranchTrack, fixtureNetwork } from './fixture';
export type { BranchFixtureOptions, FixtureEdgeSpec } from './fixture';
export { lintRoad, lintRoadNetwork, ROAD_LINT } from './validate';
export type { RoadFileLabel, RoadLintInput, RoadLintIssue, RoadLintRule } from './validate';
export { buildBranchCurve, buildCentreline, compileTrack, humpProfile, rampProfile } from './compile';
export type {
  BranchSource,
  CompiledTrack,
  HumpSource,
  RampSource,
  RoadSource,
  RouteSource,
  TrackSource,
} from './compile';
export { RAMP_TRUCK_DEFAULTS, rampTruckShape, readConnector } from './types';
export type {
  BakedBarrier,
  BakedConnector,
  BakedConnectorEnd,
  BakedFeature,
  BakedJunction,
  BakedJunctionEnd,
  BakedLaneSection,
  BakedNetwork,
  BakedNetworkBundle,
  BakedRoad,
  BakedRoute,
  BakedSamples,
  BakedSplitZone,
  BakedTag,
  FeatureKind,
} from './types';
