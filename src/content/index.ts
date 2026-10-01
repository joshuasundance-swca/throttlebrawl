// content: pack loading, validation, the lint and the frozen registry (docs/architecture.md,
// "Content registry"; docs/content-packs.md, "Validation"). The content lane owns this folder;
// schema/ is a contract.
export { loadBasePack, basePackFiles } from './base-pack';
export {
  combineRegistries,
  createPackLibrary,
  groupPackFiles,
  isRoadDataPath,
  packClosure,
  packOf,
  packSubset,
  registryFromGlob,
} from './packs';
export type { PackLibrary, PackSources } from './packs';
export { assetIndex, buildRegistry, ContentError, contentHashes, lookup } from './registry';
export type { ContentRegistry, LoadOptions, PackIndexRow } from './registry';
export type { ContentHashes } from './hashes';
export { FORMAT_VERSION, isEntryFile, parsePack } from './parse';
export type { EntryStatus, PackFile, ParsedEntry, ParsedPack } from './parse';
export { BUILT_IN_RULES, lintPacks, stealTicks } from './lint';
export type { LintContext, LintOptions, PackRule } from './lint';
export { formatFinding, pointer } from './findings';
export type { Finding } from './findings';
export { buildPackIndex } from './pack-index';
export type { PackIndex, PackIndexFile, PackIndexInput } from './pack-index';
export {
  BARK_FACTS,
  BARK_OPS,
  BARK_TRIGGERS,
  barkFact,
  BIKE_CLASSES,
  EVENT_KINDS,
  MODIFIER_KINDS,
  TIMES_OF_DAY,
} from './schema';
export type { BarkFactDecl, BarkOp, BarkTrigger } from './schema';
export type {
  BarkSet,
  Bike,
  Crew,
  EntryType,
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
