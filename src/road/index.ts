// road: the road network model and its queries (docs/architecture.md, "Road network"). DOM-free
// and deterministic, like the sim. The road lane (road-1, road-2) owns this folder after app-1.
export { createRoadNetwork, sRateFactor } from './network';
export type { AdvanceResult, Edge, EdgeLink, RoadFrame, RoadNetwork, RoadPos, WorldPoint } from './network';
export { createRouteProgress } from './route';
export { FIXTURE_LANES, fixtureNetwork } from './fixture';
export type { FixtureEdgeSpec } from './fixture';
export type { RouteProgress } from './route';
export type {
  BakedFeature,
  BakedJunction,
  BakedJunctionEnd,
  BakedLaneSection,
  BakedNetwork,
  BakedNetworkBundle,
  BakedRoad,
  BakedRoute,
  BakedSamples,
} from './types';
