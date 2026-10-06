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
export {
  deriveVerge,
  laneEdges,
  lanesPerDirection,
  MAX_LANES_PER_DIRECTION,
  resolveCrossSection,
  resolveVerge,
  VERGE_BY_TAG,
} from './cross-section';
export type { CrossSection, ResolvedVerge, VergeSide, VergeSource } from './cross-section';
export { BRIDGE_TAPER_SLOPE, bridgedAt } from './bridge-taper';
export type { TaperedVerge } from './bridge-taper';
export { gapAt, gapById, gapFarSide, jumpableWallAt, nearestOnEdges } from './gap';
export { createRouteProgress } from './route';
export type { RouteBranch, RouteCheckpoint, RouteProgress, RouteShortcut } from './route';
export {
  FIXTURE_LANES,
  fixtureBranchNetwork,
  fixtureBranchTrack,
  fixtureNetwork,
  highwayLanes,
} from './fixture';
export type { BranchFixtureOptions, FixtureEdgeSpec } from './fixture';
export { lintRoad, lintRoadNetwork, ROAD_LINT } from './validate';
export type { RoadFileLabel, RoadLintInput, RoadLintIssue, RoadLintRule } from './validate';
export {
  buildBranchCurve,
  buildCentreline,
  compileTrack,
  deckProfile,
  humpProfile,
  rampProfile,
} from './compile';
export type {
  BranchSource,
  CompiledTrack,
  DeckSource,
  HumpSource,
  RampSource,
  RoadSource,
  RouteSource,
  TrackSource,
} from './compile';
export {
  GAP_DEFAULTS,
  GAP_RESPAWNS,
  gapParams,
  LANDMARK_DEFAULTS,
  landmarkParams,
  RAMP_TRUCK_DEFAULTS,
  rampTruckShape,
  readConnector,
} from './types';
export type {
  BakedBarrier,
  BakedConnector,
  BakedConnectorEnd,
  BakedFeature,
  BakedJunction,
  BakedJunctionEnd,
  BakedLaneSection,
  BakedMedian,
  BakedNetwork,
  BakedNetworkBundle,
  BakedRoad,
  BakedRoute,
  BakedRouteBranch,
  BakedSamples,
  BakedSplitZone,
  BakedTag,
  BakedVerge,
  FeatureKind,
  GapParams,
  GapRespawn,
  LandmarkParams,
} from './types';
export { LAND_TAGS, onSide, scatterHash, THEME_ORDER, themeAt } from './themes';
export type { LandTheme, SideTag, SideTheme } from './themes';
export {
  DRAWN_VERGE_M,
  FURNITURE,
  FURNITURE_KINDS,
  kitOfNetwork,
  OLDTOWN_SIDEWALK_RULES,
  onRidableBand,
  planStreetFurniture,
  SF_SIDEWALK_RULES,
} from './furniture';
export type {
  FurnitureClass,
  FurnitureFoot,
  FurnitureKind,
  FurnitureLayer,
  FurniturePlan,
  FurnitureShape,
  FurnitureSpec,
  FurnitureTurn,
  StreetFurniture,
} from './furniture';
