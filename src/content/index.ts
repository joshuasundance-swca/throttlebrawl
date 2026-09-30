// content: pack loading, validation and the frozen registry (docs/architecture.md, "Content
// registry"). The content lane (content-1) owns this folder after app-1; schema/ is a contract.
export { loadBasePack, basePackFiles } from './base-pack';
export { assetIndex, buildRegistry, ContentError, contentHashes, lookup } from './registry';
export type { ContentRegistry, LoadOptions, PackFile, PackIndexRow } from './registry';
export type {
  BarkSet,
  Bike,
  Crew,
  EventModifier,
  HudLayout,
  PackManifest,
  RaceEvent,
  Region,
  Rider,
  RoadFile,
  RoadNetworkFile,
  RouteFile,
  Station,
  TrafficType,
  TuningPreset,
  Weapon,
} from './schema';
