// The content registry (docs/architecture.md, "Content registry"): packs are validated, merged and
// frozen into read-only tables keyed by qualified id (`base:rustbucket-400`). content/ is the only
// module that reads pack files. content-1 builds the real indexer, the lint, the reserved types and
// the real content hashes; app-1 ships the loader and the interfaces.
import type { z } from 'zod';
import { fnvString, FNV_OFFSET, hashHex, qualify, type AssetIndexEntry } from '../core';
import {
  ENTRY_SCHEMAS,
  packSchema,
  RESERVED_TYPES,
  type BarkSet,
  type Bike,
  type Crew,
  type EntryType,
  type EventModifier,
  type Station,
  type HudLayout,
  type PackManifest,
  type RaceEvent,
  type Region,
  type Rider,
  type RoadFile,
  type RoadNetworkFile,
  type RouteFile,
  type TrafficType,
  type TuningPreset,
  type Weapon,
} from './schema';

/** One raw pack file: its pack-relative path (`bikes/rustbucket-400.json`) and parsed JSON. */
export interface PackFile {
  path: string;
  json: unknown;
}

/** The generated pack index: every file with its type and id (content-1 adds bytes and hashes). */
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

function issues(file: string, err: z.ZodError): string {
  return err.issues.map((i) => `${file} /${i.path.join('/')}: ${i.message}`).join('\n');
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

export interface LoadOptions {
  /** Load `draft` entries too (dev and staging builds). */
  includeDrafts?: boolean;
}

/**
 * Validates one pack's files and freezes them into a registry. Every message names the file and
 * a JSON pointer. `vetoed` entries are skipped (the taste log stays in the file).
 */
export function buildRegistry(files: readonly PackFile[], options: LoadOptions = {}): ContentRegistry {
  const manifestFile = files.find((f) => f.path === 'pack.json');
  if (!manifestFile) throw new ContentError('pack.json is missing');
  const manifest = packSchema.safeParse(manifestFile.json);
  if (!manifest.success) throw new ContentError(issues('pack.json', manifest.error));
  const packId = manifest.data.id;
  if (manifest.data.formatVersion !== 1) {
    throw new ContentError(
      `pack ${packId} needs format ${manifest.data.formatVersion}; this game reads format 1`,
    );
  }

  const tables: Record<string, Record<string, unknown>> = {};
  for (const name of Object.values(TABLE_OF)) tables[name] = {};
  const index: PackIndexRow[] = [];
  const errors: string[] = [];

  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    if (file.path === 'pack.json') continue;
    const type = (file.json as { type?: unknown } | null)?.type;
    if (typeof type !== 'string' || !(type in ENTRY_SCHEMAS)) {
      errors.push(`${file.path} /type: unknown entry type ${String(type)}`);
      continue;
    }
    const parsed = ENTRY_SCHEMAS[type as EntryType].safeParse(file.json);
    if (!parsed.success) {
      errors.push(issues(file.path, parsed.error));
      continue;
    }
    const entry = parsed.data;
    // The filename equals the id; a region file is `regions/<id>/region.json`.
    const parts = file.path.replace(/\.json$/, '').split('/');
    const named = type === 'region' ? parts[parts.length - 2] : parts[parts.length - 1];
    if (named !== entry.id) errors.push(`${file.path} /id: filename must equal the id (${entry.id})`);
    index.push({ packId, path: file.path, type, id: entry.id });
    const status = entry.meta?.status ?? 'live';
    if (status === 'vetoed' || (status === 'draft' && !options.includeDrafts)) continue;
    if (RESERVED_TYPES.includes(type as EntryType)) {
      errors.push(`${file.path} /type: ${type} entries are reserved and not loaded yet`);
      continue;
    }
    const table = tables[TABLE_OF[type as LoadedType]];
    const key = qualify(packId, entry.id);
    if (table && key in table) errors.push(`${file.path} /id: duplicate ${type} id ${entry.id}`);
    else if (table) table[key] = entry;
  }
  if (errors.length) throw new ContentError(errors.join('\n'));

  return deepFreeze({ packs: [manifest.data], index, ...tables } as unknown as ContentRegistry);
}

/** Looks an entry up by bare or qualified id, throwing a readable error when it is missing. */
export function lookup<T>(table: Table<T>, id: string, packId = 'base'): T {
  const entry = table[qualify(packId, id)];
  if (!entry) throw new ContentError(`no entry ${qualify(packId, id)}`);
  return entry;
}

// Fields that never enter SimConfig (docs/content-packs.md, "Which fields count as sim-facing").
const PRESENTATION_FIELDS = new Set(['name', 'look', 'engineSound', 'paint', 'blurb', 'tags', 'meta']);
const SIM_TABLES: readonly (keyof ContentRegistry)[] = [
  'bikes',
  'riders',
  'weapons',
  'events',
  'networks',
  'roads',
  'routes',
  'trafficTypes',
];

function hashValue(h: number, value: unknown, skip: ReadonlySet<string> | null): number {
  if (Array.isArray(value)) {
    let out = fnvString(h, '[');
    for (const v of value) out = hashValue(out, v, null);
    return fnvString(out, ']');
  }
  if (value && typeof value === 'object') {
    let out = fnvString(h, '{');
    for (const key of Object.keys(value).sort()) {
      if (skip?.has(key)) continue;
      out = hashValue(fnvString(out, key), (value as Record<string, unknown>)[key], null);
    }
    return fnvString(out, '}');
  }
  return fnvString(h, JSON.stringify(value) ?? 'undefined');
}

/**
 * The sim content hash (sim-facing fields of sim-facing types) and the full content hash.
 * Interim bodies: content-1 replaces them with the per-type field lists from the schema folder.
 */
export function contentHashes(reg: ContentRegistry): { sim: string; full: string } {
  let sim = FNV_OFFSET;
  let full = FNV_OFFSET;
  const all = Object.keys(TABLE_OF).map((t) => TABLE_OF[t as LoadedType]);
  for (const name of [...new Set(all)].sort()) {
    const table = reg[name] as Table<unknown>;
    for (const id of Object.keys(table).sort()) {
      full = hashValue(fnvString(full, id), table[id], null);
      if (SIM_TABLES.includes(name)) sim = hashValue(fnvString(sim, id), table[id], PRESENTATION_FIELDS);
    }
  }
  return { sim: hashHex(sim), full: hashHex(full) };
}

/** The asset manifest rows this registry contributes (none until the first baked asset lands). */
export function assetIndex(_reg: ContentRegistry): readonly AssetIndexEntry[] {
  return [];
}
