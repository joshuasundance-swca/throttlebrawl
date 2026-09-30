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
  WorldPoint,
} from './network';
export { createRouteProgress } from './route';
export type { RouteCheckpoint, RouteProgress } from './route';
export { FIXTURE_LANES, fixtureNetwork } from './fixture';
export type { FixtureEdgeSpec } from './fixture';
export { lintRoad, lintRoadNetwork, ROAD_LINT } from './validate';
export type { RoadFileLabel, RoadLintInput, RoadLintIssue, RoadLintRule } from './validate';
export { buildCentreline, compileTrack, humpProfile } from './compile';
export type { CompiledTrack, HumpSource, RoadSource, RouteSource, TrackSource } from './compile';
export type {
  BakedBarrier,
  BakedFeature,
  BakedJunction,
  BakedJunctionEnd,
  BakedLaneSection,
  BakedNetwork,
  BakedNetworkBundle,
  BakedRoad,
  BakedRoute,
  BakedSamples,
  BakedTag,
  FeatureKind,
} from './types';
