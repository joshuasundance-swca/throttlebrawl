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
  vergeTagAt,
} from './cross-section';
export type { CrossSection, ResolvedVerge, VergeSide, VergeSource } from './cross-section';
export { BRIDGE_TAPER_SLOPE, bridgedAt } from './bridge-taper';
export type { TaperedVerge } from './bridge-taper';
export {
  BUILDING_FRONT_TAGS,
  EDGE_TOP_BY_TAG,
  edgeTopAt,
  pastAt,
  WATER_LEVEL_M,
  waterLevelOf,
} from './beyond';
export type { Past } from './beyond';
export { gapAt, gapById, gapFarSide, nearestOnEdges } from './gap';
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
// The physical world (the maintainer, 2026-10-06; docs/architecture.md, "Physical world"): the structures'
// contract and the course query. Small and lazy-safe: the planners load in their own lazy chunk.
// A layer's layout (what render draws and its planner turns into solids) is in src/road/structures/, which
// this index does not re-export: a static import from here would pull the planners into the sim chunk and the
// first load. Render's lazy layers import them directly (scripts/module-map.mjs).
export {
  ensureStructures,
  footContains,
  modelFoot,
  modelSolid,
  planStructures,
  requireStructures,
  STRUCTURE_LAYERS,
  STRUCTURE_MODELS,
  structureLayersFor,
  structureModel,
  structuresAt,
  structuresOf,
  topAt,
} from './structures';
export type {
  Structure,
  StructureClass,
  StructureFoot,
  StructureLayerSpec,
  StructureModel,
  StructurePlan,
  StructurePlanner,
  StructureRoof,
  StructureSink,
  StructureSpec,
} from './structures';
export { COURSE_STEP_M, courseAt } from './course';
export type { CourseSpot } from './course';
// The car ferry's numbers (small: render's roofs and the places both read them, and so does its planner).
export { FERRY_DIM, FERRY_ROOF, ferrySections } from './ferry';
// The layers' layouts (what render draws, what the registry plans): in the planners' lazy chunk
// (`road-structures`, scripts/sim-chunk.mjs), loaded with the region, never in the first load. Render awaits one before it builds its layer (render/waterfront.ts,
// render/pnw-places.ts); the registry (`STRUCTURE_LAYERS`) loads the same module for the sim.
export const loadWaterfrontLayout = () => import('./structures/waterfront');
export const loadPnwPlacesLayout = () => import('./structures/pnw-places');
export type {
  BlockKind,
  Frontage,
  SolidDef as WaterfrontSolidDef,
  WaterfrontLayout,
  WfBackTower,
  WfBlock,
  WfEdge,
  WfFront,
  WfPlaced,
  WfStreet,
} from './structures/waterfront';
export type {
  PnwBanner,
  PnwBunting,
  PnwFerryPart,
  PnwPlacesLayout,
  PnwShop,
  PnwSideStreet,
  PnwSolidDef,
} from './structures/pnw-places';
