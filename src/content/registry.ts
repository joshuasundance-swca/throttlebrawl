// The content registry (docs/architecture.md, "Content registry"): packs are validated, merged and
// frozen into read-only tables keyed by qualified id (`base:rustbucket-400`). content/ is the only
// module that reads pack files. Validation is parse.ts, the same validator packs:check runs.
import { qualify, type AssetIndexEntry } from '../core';
import { formatFinding } from './findings';
import { computeContentHashes, type ContentHashes } from './hashes';
import { parsePack, type PackFile } from './parse';
import {
  VETOABLE_ITEMS,
  type BarkSet,
  type Bike,
  type Crew,
  type EntryType,
  type EventModifier,
  type HudLayout,
  type PackManifest,
  type RaceEvent,
  type Region,
  type Rider,
  type RoadFile,
  type RoadNetworkFile,
  type RouteFile,
  type Station,
  type TrafficType,
  type TuningPreset,
  type Weapon,
} from './schema';

/** One row per entry file (vetoed ones included); the tool's pack.index.json adds bytes and hashes. */
export interface PackIndexRow {
  packId: string;
  path: string;
  type: string;
  id: string;
}

type Table<T> = Readonly<Record<string, T>>;

export interface ContentRegistry {
  readonly packs: readonly PackManifest[];
  readonly index: readonly PackIndexRow[];
  readonly bikes: Table<Bike>;
  readonly riders: Table<Rider>;
  readonly crews: Table<Crew>;
  readonly weapons: Table<Weapon>;
  readonly events: Table<RaceEvent>;
  readonly regions: Table<Region>;
  readonly networks: Table<RoadNetworkFile>;
  readonly roads: Table<RoadFile>;
  readonly routes: Table<RouteFile>;
  readonly trafficTypes: Table<TrafficType>;
  readonly barkSets: Table<BarkSet>;
  readonly hudLayouts: Table<HudLayout>;
  readonly tuningPresets: Table<TuningPreset>;
  /** Reserved: weird-event modifiers (M4 or the shelf). */
  readonly modifiers: Table<EventModifier>;
  /** Reserved: radio stations (later). */
  readonly stations: Table<Station>;
}

type LoadedType = Exclude<EntryType, 'patch'>;

const TABLE_OF: Record<LoadedType, keyof ContentRegistry> = {
  bike: 'bikes',
  rider: 'riders',
  crew: 'crews',
  weapon: 'weapons',
  event: 'events',
  region: 'regions',
  'road-network': 'networks',
  road: 'roads',
  route: 'routes',
  'traffic-type': 'trafficTypes',
  'bark-set': 'barkSets',
  'hud-layout': 'hudLayouts',
  'tuning-preset': 'tuningPresets',
  'event-modifier': 'modifiers',
  station: 'stations',
};

export class ContentError extends Error {}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

export interface LoadOptions {
  /** Load `draft` entries and items too (dev and staging builds). */
  includeDrafts?: boolean;
}

function loads(status: unknown, includeDrafts: boolean): boolean {
  return status === undefined || status === 'live' || (status === 'draft' && includeDrafts);
}

/**
 * Validates one pack's files and freezes them into a registry. Every message names the file and
 * a JSON pointer. `vetoed` entries and items are skipped (the taste log stays in the file), and
 * `draft` ones load only when asked.
 */
export function buildRegistry(files: readonly PackFile[], options: LoadOptions = {}): ContentRegistry {
  const drafts = options.includeDrafts ?? false;
  const { pack, findings } = parsePack(files);
  const errors = findings.filter((f) => f.level === 'error');
  if (!pack || errors.length) throw new ContentError(errors.map((f) => formatFinding(f)).join('\n'));

  const tables: Record<string, Record<string, unknown>> = {};
  for (const name of Object.values(TABLE_OF)) tables[name] = {};
  const index: PackIndexRow[] = [];
  for (const e of pack.entries) {
    index.push({ packId: pack.packId, path: e.path, type: e.type, id: e.id });
    if (!loads(e.status, drafts)) continue;
    const data = e.data;
    for (const list of VETOABLE_ITEMS[e.type] ?? []) {
      const items = data[list];
      if (Array.isArray(items)) {
        data[list] = items.filter((it) => loads((it as { status?: unknown } | null)?.status, drafts));
      }
    }
    const table = tables[TABLE_OF[e.type as LoadedType]];
    if (table) table[qualify(pack.packId, e.id)] = data;
  }
  return deepFreeze({ packs: [pack.manifest], index, ...tables } as unknown as ContentRegistry);
}

/** Looks an entry up by bare or qualified id, throwing a readable error when it is missing. */
export function lookup<T>(table: Table<T>, id: string, packId = 'base'): T {
  const entry = table[qualify(packId, id)];
  if (!entry) throw new ContentError(`no entry ${qualify(packId, id)}`);
  return entry;
}

/**
 * The sim content hash (the sim-facing fields listed per type in schema/) and the full content
 * hash (everything loaded), as 8 hex digits each. The sim hash goes into every replay key.
 */
export function contentHashes(reg: ContentRegistry): ContentHashes {
  const tables = new Map<EntryType, Table<unknown>>();
  for (const [type, name] of Object.entries(TABLE_OF)) {
    tables.set(type as EntryType, reg[name] as Table<unknown>);
  }
  return computeContentHashes({ manifests: reg.packs, tables });
}

/** The asset manifest rows this registry contributes (none until the first baked asset lands). */
export function assetIndex(_reg: ContentRegistry): readonly AssetIndexEntry[] {
  return [];
}
